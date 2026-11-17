"use strict";

/**
 * Condensé d'une sortie TAP (node --test) : seuls les échecs et le bilan sont utiles au
 * modèle. Les tests réussis (« ok N », blocs YAML de durée, « # Subtest: ») représentent
 * l'essentiel de la sortie et coûtent des milliers de tokens à chaque `npm test`.
 * Lu ligne par ligne au fil du flux : la sortie complète n'est jamais gardée en mémoire.
 */

const MAX_PREAMBLE_CHARS = 2000;  // lignes avant « TAP version » (pretest, build…)
const MAX_FAILURES_CHARS = 12000; // détail des échecs
const SUMMARY_RE = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /;
const RESULT_RE = /^\s*(not ok|ok) \d+/;
const SUBTEST_RE = /^\s*# Subtest:/;

function createTapDigest() {
    let pending = "";
    let tap = false;
    let preamble = "";
    let failures = "";
    let failuresOmitted = 0;
    let inFailure = false;
    let passed = 0;
    const summary = [];

    function addFailure(text) {
        if (failures.length + text.length + 1 > MAX_FAILURES_CHARS) {
            failuresOmitted += text.length + 1;
            return;
        }
        failures += `${text}\n`;
    }

    function line(raw) {
        const text = raw.replace(/\r$/, "");

        if (!tap) {
            if (/^TAP version \d+/.test(text)) {
                tap = true;
                return;
            }
            if (preamble.length < MAX_PREAMBLE_CHARS) {
                preamble += `${text}\n`.slice(0, MAX_PREAMBLE_CHARS - preamble.length);
            }
            return;
        }

        if (SUMMARY_RE.test(text)) {
            inFailure = false;
            summary.push(text);
            return;
        }

        const result = RESULT_RE.exec(text);
        if (result) {
            inFailure = result[1] === "not ok";
            if (inFailure) addFailure(text);
            else passed++;
            return;
        }

        if (SUBTEST_RE.test(text)) {
            inFailure = false;
            return;
        }

        if (inFailure) addFailure(text);
    }

    return {
        push(text) {
            pending += text;
            const parts = pending.split("\n");
            pending = parts.pop();
            for (const part of parts) line(part);
        },

        /** Texte condensé, ou null si la sortie n'était pas du TAP. */
        render() {
            if (pending) {
                line(pending);
                pending = "";
            }
            if (!tap) return null;

            const out = [];
            if (preamble.trim()) out.push(preamble.trimEnd());
            out.push(`[sortie TAP condensée : ${passed} test(s) réussi(s) non détaillé(s)]`);
            if (failures) {
                out.push(`Échecs :\n${failures.trimEnd()}`);
                if (failuresOmitted) out.push(`[... ${failuresOmitted} caractères d'échecs omis ...]`);
            }
            if (summary.length) out.push(summary.join("\n"));
            return out.join("\n\n");
        }
    };
}

module.exports = { createTapDigest, MAX_FAILURES_CHARS };
