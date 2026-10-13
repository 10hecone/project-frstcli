# API FranceStudent IA : routes utilisées par le CLI

> Ce document est déduit du code du CLI (`src/api/api.js`, `src/api/auth.js`, `src/config.js`) et d'une capture réseau.
> L'API n'est pas officielle : elle peut changer sans préavis. Vérifie que ton usage respecte les conditions d'utilisation de FranceStudent.
> Les routes marquées **non confirmé** n'apparaissent pas.

## Hôtes

| Rôle | URL par défaut | Variable d'environnement |
| --- | --- | --- |
| API de chat | `https://api.francestudent.ai` | `FS_API_URL` |
| Site et authentification | `https://ia.francestudent.org` | `FS_ORIGIN` |

Dans ce document, `{apiUrl}` désigne l'hôte de l'API et `{origin}` celui du site.

## Authentification : vue d'ensemble

1. Le navigateur garde un cookie de session longue durée, `next-auth.session-token`.
2. `GET {origin}/api/auth/api-token`, appelé avec ce cookie, renvoie un JWT de courte durée.
3. Ce JWT est envoyé à l'API de chat dans l'en-tête `Authorization: Bearer <accessToken>`.

Il n'y a pas de refresh token. Le CLI redemande un JWT 60 s avant son expiration et après toute réponse HTTP 401.

## En-têtes communs

| En-tête | Valeur |
| --- | --- |
| `User-Agent` | User-Agent de navigateur (`FS_USER_AGENT`) |
| `francestudent-client-platform` | `web_fs_ai` |
| `francestudent-client-version` | `4005601` (`FS_CLIENT_VERSION`) |
| `francestudent-device-id` | UUID propre à l'appareil (`FS_DEVICE_ID`, sinon généré et sauvegardé) |
| `Referer` | `{origin}/` |

---

## GET `{origin}/api/auth/api-token`

Échange le cookie de session contre un JWT de courte durée.

**En-têtes**

```
Cookie: next-auth.session-token=<valeur>; francestudent-device-id=<uuid>
Accept: */*
```

**Réponse 200 (JSON)**

```json
{
  "accessToken": "<JWT>",
  "expiresAt": 1760000000,
  "expiresIn": 300,
  "tokenType": "Bearer"
}
```

- `expiresAt` est supposé exprimé en secondes depuis l'epoch. S'il est absent, le CLI utilise `expiresIn` (300 s par défaut).
- Les en-têtes `Set-Cookie` de la réponse sont enregistrés : le cookie de session peut être renouvelé à cette occasion.

**Erreurs**

- Statut différent de 2xx : session refusée.
- Réponse non JSON, ou sans `accessToken` : session invalide ou expirée.
- Le CLI abandonne la requête après 30 s.

---

## GET `{origin}/api/auth/csrf` (non confirmé)

Route standard d'Auth.js. Elle renvoie un jeton CSRF, nécessaire avant une connexion par email et mot de passe.

**Réponse 200**

```json
{ "csrfToken": "<jeton>" }
```

---

## Connexion e-mail / mot de passe (OAuth WHMCS)

Constaté : un seul fournisseur Auth.js, `whmcs` (type `oauth`, PKCE S256, scope `openid profile email`). Il n'existe pas de route `credentials`.

1. `GET {origin}/api/auth/providers`, puis `GET {origin}/api/auth/csrf` (jeton + cookie).
2. `POST {origin}/api/auth/signin/whmcs` (`csrfToken`, `callbackUrl`) avec `X-Auth-Return-Redirect: 1` : renvoie l'adresse d'autorisation sur `my.francestudent.org` et pose les cookies `state` et `pkce.code_verifier`.
3. Sur WHMCS : page de connexion, envoi du formulaire. : le CLI lit le formulaire dynamiquement (champs cachés, noms des champs, action) et accepte une éventuelle page d'autorisation.
4. Retour sur `{origin}/api/auth/callback/whmcs` : pose `next-auth.session-token`.

Non pris en charge (message d'erreur clair) : captcha, double authentification, blocage Cloudflare. Code : `src/api/login.js`, `src/api/html-forms.js`.

---

## POST `{apiUrl}/chats/stream`

Envoie un message à un agent et reçoit la réponse sous forme de flux SSE.

**En-têtes**

```
Accept: text/event-stream
Content-Type: application/json
Authorization: Bearer <accessToken>
Origin: {origin}
Referer: {origin}/
francestudent-client-platform: web_fs_ai
francestudent-client-version: 4005601
francestudent-device-id: <uuid>
```

**Corps (JSON)**

```json
{
  "agentId": -1002,
  "chatId": null,
  "enableCanvas": false,
  "enableWebSearch": false,
  "images": [],
  "initialContent": "Bonjour",
  "isIncognito": false,
  "isPrivate": true
}
```

| Champ | Type | Rôle |
| --- | --- | --- |
| `agentId` | entier | Modèle utilisé (voir « Agents connus ») |
| `chatId` | chaîne ou `null` | `null` ouvre une nouvelle conversation. Sinon, l'identifiant `chat_id` reçu précédemment |
| `enableCanvas` | booléen | Canvas de l'interface web (toujours `false` dans le CLI) |
| `enableWebSearch` | booléen | Recherche web (`/web on`, chat normal uniquement) |
| `images` | tableau | Images jointes (toujours vide dans le CLI) |
| `initialContent` | chaîne | Texte du message |
| `isIncognito` | booléen | Mode incognito |
| `isPrivate` | booléen | Conversation privée (`true` par défaut) |

Limites côté CLI : 1 000 000 caractères par message (`maxMessageChars`), 310 s pour l'ensemble du flux (`timeoutMs`), 60 s pour recevoir la réponse du serveur (`firstByteTimeoutMs`, variable `FS_FIRST_BYTE_TIMEOUT_MS`) et 90 s sans données reçues pendant le flux (`idleTimeoutMs`, variable `FS_IDLE_TIMEOUT_MS`).

**Réponse : flux SSE**

Chaque événement se compose de lignes `event: <nom>` puis `data: <JSON>`, et se termine par une ligne vide.

| Événement | Données | Traitement par le CLI |
| --- | --- | --- |
| `response.output_text.delta` | `{ "delta": "..." }` | Morceau de texte ajouté à la réponse |
| `response.output_text.done` | `{ "text": "..." }` | Texte complet, utilisé seulement si aucun delta n'a été reçu |
| `response.completed` | `{ "response": { "error": ... } }` | Erreur si `response.error` est présent |
| `response.failed` / `error` | objet d'erreur | Fin du flux avec une erreur |
| `completed` | `{ "message": { "content": "..." } }` | Fin du flux. `content` sert de repli si aucun texte n'a été reçu |
| (données) `[DONE]` | n/a | Fin du flux |

N'importe quel événement peut contenir `chat_id`. Pour continuer la conversation, renvoie cette valeur dans `chatId`. Le CLI conserve une conversation distincte pour le chat normal et pour l'agent (state.chatIds), réutilisée d'un tour à l'autre.

**Erreurs**

- Statut différent de 2xx : le corps de la réponse est renvoyé dans le message d'erreur.
- Relances : au maximum 2 (`MAX_REQUEST_FAILURES`), selon le type d'erreur :
  - 401 : le CLI renouvelle le JWT, puis relance ;
  - 408, 409 (« A stream is already active for this chat ») et 429 : relance après 3 s, puis après 8 s ;
  - en mode agent, le premier 409 ouvre immédiatement une nouvelle conversation (`chatIds.agent` et `chatId` remis à `null`) : relance sans attente, non comptée comme un échec, avec un avertissement affiché ;
  - autres 4xx : aucune relance, l'erreur est renvoyée immédiatement ;
  - erreurs réseau ou de flux, et 5xx : relance immédiate.
- Flux vide ou interrompu : erreur « Réponse vide du modèle » ou « Flux interrompu sans réponse ».

---

## Agents connus (`agentId`)

Ces identifiants ont été observés dans la capture réseau (`KNOWN_MODELS` dans `src/config.js`) :

| agentId | Nom |
| --- | --- |
| -1002 | GPT 6 Luna (par défaut, `FS_AGENT_ID`) |
| -1003 | GPT 6.1 Sol |
| -2002 | Claude Haiku 5.5 |
| -2001 | Claude Opus 5.5 |

## Sécurité

- Le cookie `next-auth.session-token` donne accès au compte. Ne le partage jamais et ne le commite jamais (`.env` est ignoré par git).
- Le CLI enregistre la session dans `~/.francestudent-cli/session.json` (ou dans `FS_DATA_DIR`).
