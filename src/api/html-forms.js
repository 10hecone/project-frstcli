"use strict";

/*
 * Lecture minimale des formulaires d'une page HTML, sans dépendance.
 * Sert à la connexion WHMCS : on repère le formulaire qui contient un champ
 * mot de passe, on reprend ses champs cachés (jeton CSRF...) et on le soumet.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Une balise ouvrante, en tolérant un ">" à l'intérieur d'une valeur entre guillemets.
const TAG_BODY = `(?:"[^"]*"|'[^']*'|[^'">])*`;

function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === "#") {
            const hex = entity[1].toLowerCase() === "x";
            const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);

            try {
                return String.fromCodePoint(code);
            } catch {
                return match;
            }
        }

        return ENTITIES[entity.toLowerCase()] ?? match;
    });
}

function stripNoise(html) {
    return String(html)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
}

function textOf(html) {
    return decodeEntities(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseAttributes(tag) {
    const attrs = {};
    const body = String(tag).replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
    const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

    let match;

    while ((match = pattern.exec(body))) {
        const name = match[1].toLowerCase();

        if (!(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }

    return attrs;
}

function resolveUrl(target, base) {
    try {
        return new URL(target || "", base).toString();
    } catch {
        return String(base);
    }
}

/** Renvoie [{ action, method, fields, buttons, text }] pour chaque <form> de la page. */
function parseForms(html, baseUrl) {
    const source = stripNoise(html);
    const forms = [];
    const formPattern = new RegExp(`(<form\\b${TAG_BODY}>)([\\s\\S]*?)<\\/form\\s*>`, "gi");
    const inputPattern = new RegExp(`<input\\b${TAG_BODY}>`, "gi");
    const buttonPattern = new RegExp(`(<button\\b${TAG_BODY}>)([\\s\\S]*?)<\\/button\\s*>`, "gi");

    let match;

    while ((match = formPattern.exec(source))) {
        const attrs = parseAttributes(match[1]);
        const inner = match[2];

        const fields = (inner.match(inputPattern) ?? []).map(tag => {
            const a = parseAttributes(tag);

            return {
                name: a.name ?? "",
                id: a.id ?? "",
                type: (a.type ?? "text").toLowerCase(),
                value: a.value ?? "",
                checked: "checked" in a,
                disabled: "disabled" in a
            };
        });

        const buttons = [...inner.matchAll(buttonPattern)].map(button => {
            const a = parseAttributes(button[1]);

            return {
                name: a.name ?? "",
                value: a.value ?? "",
                type: (a.type ?? "submit").toLowerCase(),
                label: textOf(button[2])
            };
        });

        forms.push({
            action: resolveUrl(attrs.action, baseUrl),
            method: (attrs.method ?? "get").toUpperCase(),
            fields,
            buttons,
            text: textOf(inner)
        });
    }

    return forms;
}

const VISIBLE_TEXT_TYPES = new Set(["text", "email", "tel", ""]);

/** Formulaire de connexion : un champ mot de passe et un champ identifiant visible. */
function findLoginForm(forms) {
    for (const form of forms) {
        const password = form.fields.find(f => f.type === "password" && f.name);
        const candidates = form.fields.filter(f => VISIBLE_TEXT_TYPES.has(f.type) && f.name && !f.disabled);

        if (!password || !candidates.length) continue;

        const username =
            candidates.find(f => /user|mail|login|ident/i.test(`${f.name} ${f.id}`)) ?? candidates[0];

        return { form, username, password };
    }

    return null;
}

/** Corps à envoyer : champs cachés et préremplis, identifiant, mot de passe, bouton de validation. */
function buildLoginBody({ form, username, password }, { email, secret }) {
    const body = new URLSearchParams();

    for (const field of form.fields) {
        if (!field.name || field.disabled) continue;
        if (field === username || field === password) continue;
        if (["password", "submit", "button", "image", "file", "reset"].includes(field.type)) continue;
        if (["checkbox", "radio"].includes(field.type) && !field.checked) continue;

        body.append(field.name, field.type === "checkbox" && field.value === "" ? "on" : field.value);
    }

    body.set(username.name, email);
    body.set(password.name, secret);

    addSubmitter(body, form);

    return body;
}

function addSubmitter(body, form) {
    const submitInput = form.fields.find(f => f.type === "submit" && f.name);
    const submitButton = form.buttons.find(b => b.type === "submit" && b.name);
    const submitter = submitInput ?? submitButton;

    if (submitter) body.set(submitter.name, submitter.value);
}

const CONSENT_LABEL = /autoris|authori[sz]e|approve|allow|accepter|accept/i;

/** Page d'autorisation OAuth : champs cachés et un bouton qui accepte (pas de saisie). */
function findConsentForm(forms) {
    for (const form of forms) {
        const hasInput = form.fields.some(
            f => VISIBLE_TEXT_TYPES.has(f.type) && f.name && !f.disabled || f.type === "password"
        );

        if (hasInput) continue;

        const submitters = [
            ...form.fields.filter(f => f.type === "submit").map(f => ({ name: f.name, value: f.value, label: f.value })),
            ...form.buttons.filter(b => b.type === "submit").map(b => ({ name: b.name, value: b.value, label: b.label }))
        ];

        const accept = submitters.find(s => CONSENT_LABEL.test(`${s.name} ${s.value} ${s.label}`));

        if (accept) return { form, accept };
    }

    return null;
}

function buildConsentBody({ form, accept }) {
    const body = new URLSearchParams();

    for (const field of form.fields) {
        if (!field.name || field.disabled) continue;
        if (["submit", "button", "image", "file", "reset", "password"].includes(field.type)) continue;
        if (["checkbox", "radio"].includes(field.type) && !field.checked) continue;

        body.append(field.name, field.value);
    }

    if (accept.name) body.set(accept.name, accept.value);

    return body;
}

function pageTitle(html) {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));

    return match ? textOf(match[1]).slice(0, 80) : "";
}

/** Message d'erreur affiché par la page (alerte WHMCS), tronqué. */
function extractAlert(html) {
    const match =
        /<div\b[^>]*class=["'][^"']*\b(?:alert-danger|alert-error|login-error|errorbox)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
            .exec(stripNoise(html));

    return match ? textOf(match[1]).slice(0, 200) : "";
}

function hasCaptchaWidget(html) {
    return /class=["'][^"']*\b(?:g-recaptcha|h-captcha|cf-turnstile)\b/i.test(stripNoise(html));
}

function looksLikeTwoFactor(html) {
    return /double authentification|authentification (?:à|a) deux|two-?factor|\b2fa\b|code de v[ée]rification|authenticator|totp/i
        .test(textOf(stripNoise(html)));
}

function looksLikeChallenge(status, headers, html) {
    if (headers?.get?.("cf-mitigated") === "challenge") return true;

    return [403, 429, 503].includes(status) && /just a moment|cf-chl|attention required|cloudflare/i.test(String(html));
}

module.exports = {
    parseForms,
    findLoginForm,
    buildLoginBody,
    findConsentForm,
    buildConsentBody,
    extractAlert,
    pageTitle,
    hasCaptchaWidget,
    looksLikeTwoFactor,
    looksLikeChallenge,
    decodeEntities
};
