# Documentation de l'API FranceStudent AI

> Documentation non officielle, générée à partir de la spécification OpenAPI publique
> (`https://api.francestudent.ai/v3/api-docs`, OpenAPI 3.1.0, version `v0`) et du SDK communautaire
> [`francestudent-ai-sdk`](https://github.com/FranceStudent/francestudent-ai-sdk).
> L'API peut changer sans préavis. Les champs de **Files v2** et **Skills** sont typés `object` dans la spec : leur forme réelle est inférée du format compatible OpenAI et peut être incomplète.

## Sommaire

1. [Informations générales](#1-informations-générales)
2. [Authentification](#2-authentification)
3. [Conventions](#3-conventions)
4. [Streaming SSE (chat)](#4-streaming-sse-chat)
5. [Référence des endpoints](#5-référence-des-endpoints)
6. [Schémas de données](#6-schémas-de-données)
7. [Enums et flags](#7-enums-et-flags)
8. [Erreurs et rate limits](#8-erreurs-et-rate-limits)
9. [SDK TypeScript / CLI](#9-sdk-typescript--cli)
10. [Exemples complets](#10-exemples-complets)
11. [Endpoints non couverts par le SDK](#11-endpoints-non-couverts-par-le-sdk)

---

## 1. Informations générales

| Élément | Valeur |
|---|---|
| Base URL | `https://api.francestudent.ai` |
| Application web | `https://ia.francestudent.org` |
| Swagger UI | `https://api.francestudent.ai/swagger-ui/index.html` |
| Spec OpenAPI | `https://api.francestudent.ai/v3/api-docs` |
| Format | JSON (`application/json`), `multipart/form-data` pour les uploads, SSE pour le chat |
| Identifiants | UUID pour chats, messages, projets, fichiers v1, transcriptions ; entiers `int32` pour les utilisateurs et agents |
| Dates | ISO 8601 (`date-time`) |

Le backend est routé vers plusieurs fournisseurs (OpenAI-compatible, Claude, etc.) : les modèles sont exposés sous forme d'**agents** (`/chats/agents`).

---

## 2. Authentification

### 2.1 Ce que dit la spec

Le schéma de sécurité global est `sessionToken` : `apiKey`, en header, nom `authorization`.

```
security: [ { sessionToken: [] } ]
securitySchemes.sessionToken = { type: apiKey, name: authorization, in: header }
```

### 2.2 Ce qui se passe en pratique (d'après le SDK)

1. Le navigateur détient un **session token** longue durée : le cookie `next-auth.session-token` de `ia.francestudent.org`.
2. Le SDK l'échange contre un **access token** (JWT) court via `GET https://ia.francestudent.org/api/auth/api-token`.
3. L'access token est envoyé à l'API : `Authorization: Bearer <jwt>`.

Il n'y a pas de refresh token. Le SDK redemande un access token **60 s avant expiration** et **après toute réponse `401`** (une seule nouvelle tentative). Les requêtes concurrentes partagent un seul renouvellement.

Headers client envoyés par le SDK (utiles pour imiter le client web) :

| Header | Valeur |
|---|---|
| `Authorization` | `Bearer <access token>` |
| `francestudent-device-id` | UUID aléatoire si non fourni |
| `francestudent-client-version` | version du client (`clientVersion`) |
| `User-Agent` | un User-Agent de navigateur (nécessaire pour passer Cloudflare) |
| client platform | `web_fs_ai` par défaut |

### 2.3 Récupérer le session token

1. Se connecter sur `https://ia.francestudent.org`.
2. `F12` puis Chrome/Edge : *Application → Storage → Cookies* ; Firefox : *Storage → Cookies*.
3. Copier la valeur de `next-auth.session-token`. Un header `Cookie` complet est aussi accepté par le SDK.

> ⚠️ Le session token donne un accès complet au compte. Ne jamais le partager ni le committer (fichier `.env` ignoré par git).

### 2.4 Connexion email / mot de passe (SDK)

Flux OAuth de l'application web (Auth.js + provider WHMCS de `my.francestudent.org`). **Non supporté** si captcha, double authentification (2FA) ou blocage Cloudflare : utiliser alors un token copié du navigateur.

### 2.5 Renouvellement du session token

Le serveur peut renouveler le cookie de session. Le SDK appelle `onSessionUpdate(newToken)` pour que vous le persistiez ; la valeur courante est dans `fs.sessionToken`.

### 2.6 Endpoints sans authentification

`GET /public/health`, `GET /public/alerts`.

---

## 3. Conventions

- **Pagination par curseur** : `cursor_chat_id` pour les chats (réponse `{ chats, hasMore }`), `cursor` / `nextCursor` pour les messages sauvegardés et l'audit web (réponse `{ ..., hasMore, nextCursor }`). Pour `/skills` et `/filesv2` : `after`, `limit`, `order` (style OpenAI, avec `first_id`, `last_id`, `has_more`).
- **Soft delete** : `DELETE /chats` marque les chats avec le flag `DELETED` (documents et messages conservés).
- **Réponses 200 sans corps** pour la plupart des `DELETE`/`PUT` d'action.
- La spec ne documente que le code `200`. Les erreurs sont décrites en section 8.

---

## 4. Streaming SSE (chat)

Endpoints concernés : `POST /chats`, `POST /chats/`, `POST /chats/stream`, `POST /chats/{chatId}`, `GET /chats/{chatId}/stream`.

Réponse : `Content-Type: text/event-stream`. Format de chaque événement :

```
id: <id incrémental>
event: <nom>
data: <payload JSON>
```

### 4.1 Événements backend

| Événement | Signification |
|---|---|
| `stream.open` | Requête acceptée. Payload : `chat_id`, `first_response_timeout_ms`. Ne signifie pas que le fournisseur a répondu. |
| `response.created` | Émis une fois, après sauvegarde du message utilisateur, avant la génération. Payload : `type`, `chat_id`, `user_message_id`, `chat` (sans historique). |
| `completed` | Fin réussie. Payload : `chat_id`, `message` (dernier message assistant). |
| `error` | Fin en erreur. Payload : `message`. Pour un timeout avant la première réponse : aussi `code` (`UPSTREAM_TIMEOUT` ou `BACKEND_TIMEOUT`), `origin`, `chat_id`, `timeout_ms`, `retryable`. Pour un signalement de contenu : `code=CONTENT_POLICY_VIOLATION`, `origin=upstream`, `retryable=false`, `account_disabled` (suspension appliquée ou non). |

Le statut HTTP reste **200** une fois le flux ouvert, même en cas d'erreur : il faut lire l'événement `error`. Le délai upstream par défaut est de 5 minutes.

### 4.2 Événements relayés du fournisseur

| Événement | Contenu |
|---|---|
| `response.output_text.delta` | delta de texte (`delta`) |
| `response.output_text.done` | texte final d'une partie |
| `response.output_item.added` / `.done` | item ajouté/terminé (`reasoning`, `web_search_call`, `message`, `function_call`, `image_generation_call`…) |
| `response.function_call_arguments.delta` | delta des arguments d'un function call (`item_id`, `delta`) |
| `response.reasoning_summary_text.delta` | delta de résumé de raisonnement |
| `response.completed` | complétion côté fournisseur (**ne remplace pas** `completed` du backend) |
| `response.failed` | erreur côté fournisseur |

Claude émet aussi `output_item.added/done` pour ses appels d'outils, au même format qu'OpenAI. Un chunk texte non JSON est publié comme `response.output_text.delta`. `stream.open` et `response.created` ne sont pas des heartbeats.

### 4.3 Exemple de flux

```
id: 1
event: stream.open
data: {"chat_id":"1111...","first_response_timeout_ms":300000}

id: 2
event: response.created
data: {"type":"response.created","chat_id":"1111...","user_message_id":"2222...","chat":{"id":"1111...","title":"Hello","flags":1,"isPrivate":true,"isPinned":false,"isEphemeral":false}}

id: 3
event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"Bonjour"}

id: 5
event: completed
data: {"chat_id":"1111...","message":{"id":"3333...","role":"assistant","content":"Bonjour"}}
```

### 4.4 Reprise d'un flux

`GET /chats/{chatId}/stream` rouvre le flux d'une génération en cours sans relancer le modèle. Reprise après coupure via le header `Last-Event-ID` ou le query param `last_event_id` (int64).

### 4.5 Arrêt

`POST /chats/{chatId}/stream/cancel` annule la génération, ferme les flux SSE et interrompt l'appel au fournisseur (idempotent).

---

## 5. Référence des endpoints

Légende : 🔓 = pas d'authentification. Sauf mention, les réponses sont en `*/*` (JSON) avec code 200.

### 5.1 Chats

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| GET | `/chats` | Lister mes chats (curseur) | query : `limit` (int32, **requis**), `cursor_chat_id` (uuid), `sortedBy` (défaut `lastMessageAt`) | `ChatHistoryDto` |
| POST | `/chats`, `/chats/`, `/chats/stream` | Créer un chat et streamer la réponse (3 alias) | body `ChatCreateDto` | SSE |
| DELETE | `/chats` | Supprimer tous mes chats (flag DELETED) | — | 200 |
| GET | `/chats/{chatId}` | Détail d'un chat | path `chatId` | `ChatDetailDto` |
| POST | `/chats/{chatId}` | Envoyer un message en streaming. Un `agentId` optionnel change d'agent pour cette réponse et les suivantes | body `MessageDto` | SSE |
| PATCH | `/chats/{chatId}` | Modifier titre / visibilité | body `ChatUpdateDto` | `ChatDocument` |
| DELETE | `/chats/{chatId}` | Supprimer un chat | — | 200 |
| POST | `/chats/{chatId}/stream/cancel` | Arrêter la génération | — | 200 |
| GET | `/chats/{chatId}/stream` | Se rattacher au flux en cours | header `Last-Event-ID`, query `last_event_id` | SSE |
| GET | `/chats/{chatId}/usage` | Usage en tokens + usage du contexte | — | `ChatUsageDto` |
| PUT | `/chats/{chatId}/pins` | Épingler | — | 200 |
| DELETE | `/chats/{chatId}/pins` | Désépingler | — | 200 |
| PUT | `/chats/{chatId}/archive` | Archiver (messages compressés vers la Storagebox, retirés d'Elasticsearch) | — | 200 |
| PUT | `/chats/{chatId}/restore` | Restaurer un chat archivé (réinjecte les messages dans Elasticsearch) | — | 200 |
| GET | `/chats/{chatId}/archive/download` | Télécharger les messages d'un chat archivé | — | JSON (binaire) |
| GET | `/chats/archived` | Lister les chats archivés (métadonnées seulement) | query : `limit` (déf. 20), `cursor_chat_id` | `ChatHistoryDto` |
| GET | `/chats/search` | Recherche par titre et contenu des messages | query : `query` (**requis**), `limit` (déf. 20) | `ChatHistoryDto` |
| GET | `/chats/agents` | Lister les agents (modèles) disponibles | query : `include-disabled` (déf. false) | `Agent[]` |
| PATCH | `/chats/{chatId}/messages/{messageId}` | Éditer un message en **forkant** le chat : crée un nouveau chat avec l'historique avant le message, démarre le stream du remplacement, retourne le nouveau chat. Le flux se récupère via `GET /chats/{newChatId}/stream` | body `ChatMessageEditDto` | `ChatDetailDto` |
| GET | `/chats/{chatId}/messages/{messageId}/images/{imageId}` | Image générée par l'IA dans un message | path (3 uuid) | binaire |
| POST | `/conversation-imports/openai` | Importer une conversation ChatGPT partagée (`/share/{uuid}`) dans un modèle local | body `ConversationImportRequestDto` | `ConversationImportResponseDto` |

### 5.2 Partage de chats

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| GET | `/chats/{chatId}/shares` | Propriétaire et utilisateurs ayant accès | — | `ChatShareAccessDto[]` |
| POST | `/chats/{chatId}/shares` | Ajouter un partage | `ChatShareCreateDto` | `ChatShareAccessDto` |
| DELETE | `/chats/{chatId}/shares` | Retirer un partage (cible dans le body) | `ChatShareTargetDto` | 200 |
| PATCH | `/chats/{chatId}/shares` | Modifier les droits (cible dans le body) | `ChatShareUpdateByTargetDto` | `ChatShareAccessDto` |
| DELETE | `/chats/{chatId}/shares/{targetUserId}` | Retirer un partage par id utilisateur (int32) | — | 200 |
| PATCH | `/chats/{chatId}/shares/{targetUserId}` | Modifier les droits par id utilisateur | `ChatShareUpdateDto` | `ChatShareAccessDto` |

### 5.3 Messages et messages sauvegardés

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| PATCH | `/messages/{messageId}` | Voter (upvote/downvote) une réponse | `VoteDto` | `ChatMessage` |
| GET | `/user/@me/saved-messages` | Lister mes messages sauvegardés (curseur) | query : `limit` (déf. 20), `cursor` | `SavedMessagesPageDto` |
| PUT | `/user/@me/saved-messages/{chatId}/{messageId}` | Sauvegarder un message | — | `SavedMessageDto` |
| DELETE | `/user/@me/saved-messages/{chatId}/{messageId}` | Retirer un message sauvegardé | — | 200 |

### 5.4 Projets

Les projets `LIMITED_ACCESS` ou `POLICY_VIOLATION` ne peuvent pas être modifiés.

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| GET | `/projects` | Mes projets | — | `ProjectDto[]` |
| POST | `/projects` | Créer un projet | `ProjectCreateDto` | `ProjectDto` |
| GET | `/projects/shared` | Projets partagés avec moi | — | `ProjectDto[]` |
| GET | `/projects/{projectId}` | Détail | — | `ProjectDto` |
| PATCH | `/projects/{projectId}` | Modifier nom et/ou flags | `ProjectUpdateDto` | `ProjectDto` |
| DELETE | `/projects/{projectId}` | Supprimer | — | 200 |
| GET | `/projects/{projectId}/chats` | Chats actifs du projet | query : `limit` (déf. 20), `cursor_chat_id` | `ChatHistoryDto` |
| PUT | `/projects/{projectId}/chats/{chatId}` | Rattacher/déplacer un chat vers ce projet | — | `ChatSummaryDto` |
| DELETE | `/projects/{projectId}/chats/{chatId}` | Retirer un chat du projet (sans le supprimer) | — | 200 |
| GET | `/projects/{projectId}/shares` | Lister les partages | — | `ProjectShareAccessDto[]` |
| POST | `/projects/{projectId}/shares` | Partager par email | `ProjectShareCreateDto` | `ProjectShareAccessDto` |
| DELETE | `/projects/{projectId}/shares/{targetUserId}` | Retirer un partage | — | 200 |

### 5.5 Utilisateur (`tag: Users`)

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| GET | `/user/me` | Mon profil | — | `UserDto` |
| PATCH | `/user/me` | Mettre à jour (langues, thème, pets, nom, flags…) | `UserUpdateDto` | `UserDto` |
| DELETE | `/user/me` | **Supprimer définitivement mon compte** | — | 200 |
| PATCH | `/user/@me` | Mettre à jour le profil public (nom ; `avatar` accepté mais non persisté) | `UserProfileUpdateDto` | `UserDto` |
| GET | `/user/instructions` | Instructions personnalisées, niveau de reasoning, modèle par défaut, `documentToolsEnabled` (actif par défaut) | — | `UserPersonalizationDto` |
| PATCH | `/user/instructions` | Mise à jour partielle (`documentToolsEnabled` active/désactive ensemble `createDocument`, `editDocument`, `updateDocument`, `requestSuggestions`) | `UserPersonalizationUpdateDto` | `UserPersonalizationDto` |
| GET | `/user/notification-preferences` | Préférences de notifications | — | `NotificationPreferencesDto` |
| PATCH | `/user/notification-preferences` | Mise à jour partielle | `NotificationPreferencesDto` | `NotificationPreferencesDto` |
| GET | `/user/usage` | Rate limits, power-up, budget chat | — | `UserUsageDto` |
| GET | `/user/tokenusage` | Cumul de tokens + `last7DaysTokenUsage` | query : `tokenUsageDays` (1 à 366, défaut 343) | `UserTokenUsageDto` |
| GET | `/user/chat-budget` | Budget commun aux modèles (%), remise à zéro sur tranche de 24 h. `null` si l'expérimentation est inactive | — | `BudgetUsage` |
| GET | `/user/rate-limit-credits` | Power-ups disponibles et détail des resets | — | `RateLimitCreditsDto` |
| POST | `/user/rate-limit-credits/activate` | Consomme un crédit : **double toutes les limites pendant 7 jours** | — | `RateLimitPowerUpDto` |
| GET | `/user/sessions` | Sessions actives | — | `UserSessionDto[]` |
| DELETE | `/user/sessions` | Révoquer **toutes** les sessions | — | 200 |
| DELETE | `/user/sessions/{sessionId}` | Révoquer une session (id public, string) | — | 200 |
| GET | `/user/flags` | Flags utilisateur disponibles | — | `UserFlagDto[]` |
| GET | `/user/pets` | Valeurs acceptées pour `pets` (dont `none`) | — | `string[]` |
| POST | `/user/register-beta` | Ajoute le flag `BETA_TESTER` au compte | — | `UserDto` |
| POST | `/user/invite` | Inviter par email (Resend). **Max 5 invitations / 30 jours** ; 7 jours d'attente avant de réinviter le même email | `UserInviteRequestDto` | `UserReferralInviteDto` |
| DELETE | `/user/chats` | Supprimer tous mes chats (doublon de `DELETE /chats`, inclut projets supprimés/restreints) | — | 200 |
| GET | `/user/web-search-domains` | Mon filtre de recherche web | — | `UserWebSearchDomainsDto` |
| PUT | `/user/web-search-domains` | Remplacer mes listes et choisir la liste active | `UserWebSearchDomainsDto` | `UserWebSearchDomainsDto` |
| GET | `/user/web-search-domains/audit-log` | Historique des recherches web (une entrée par message, plus récent d'abord) | query : `limit` (déf. 20), `cursor`, `domain` (exact) | `WebSearchAuditPageDto` |

### 5.6 Mémoires

| Méthode | Chemin | Description | Sortie |
|---|---|---|---|
| GET | `/user/me/memories` | Fichiers mémoire triés par chemin, sans contenu | `UserMemoriesDto` |
| DELETE | `/user/me/memories` | **Supprimer toutes** les mémoires | 200 |
| GET | `/user/me/memories/{memoryId}` | Contenu intégral d'un fichier mémoire | `UserMemoryContentDto` |
| DELETE | `/user/me/memories/{memoryId}` | Supprimer une mémoire | 200 |

Il n'existe pas d'endpoint d'écriture : les mémoires sont écrites par le modèle (activable via `memoryEnabled` dans `/user/instructions`).

### 5.7 Fichiers v1 (`tag: Files`)

Pour les images/pièces jointes référencées par `images` dans les messages.

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| POST | `/files/upload` | Uploader un fichier | `multipart/form-data` : `file` (binary) | `FileUploadResponseDto` |
| GET | `/files` | Liste de mes fichiers | — | `uuid[]` |
| GET | `/files/{fileId}` | Contenu structuré (base64) | path uuid | `FileContentResponseDto` |
| DELETE | `/files/{fileId}` | Supprimer | path uuid | 200 |

### 5.8 Fichiers v2 (`tag: Files v2`, format compatible OpenAI)

Ces IDs (strings) sont ceux utilisés dans le champ `files` des messages.

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| POST | `/filesv2` | Upload | `multipart/form-data` : `file` (**requis**) ; query `expires_after[anchor]` (string), `expires_after[seconds]` (int64) | non typé |
| GET | `/filesv2` | Liste | query : `after`, `limit` (int64), `order`, `purpose` | `FilesV2ListResponseDto` |
| GET | `/filesv2/{file_id}` | Métadonnées | — | non typé |
| DELETE | `/filesv2/{file_id}` | Supprimer | — | `FileDeleted` |
| GET | `/filesv2/{file_id}/content` | Contenu | — | `string` (byte) |
| GET | `/filesv2/usage` | Stockage utilisé | — | `FilesV2UsageDto` |
| GET | `/filesv2/supported-mime-types` | Types MIME acceptés | — | `string[]` |

### 5.9 Transcription

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| POST | `/transcript/upload` | Uploader un **MP3**, crée un job en file d'attente | `multipart/form-data` : `file` | `TranscriptCreateResponseDto` |
| GET | `/transcript` | Mes jobs | — | `TranscriptSummaryDto[]` |
| GET | `/transcript/{transcriptId}` | Détail d'un job | path uuid | `TranscriptDetailDto` |
| GET | `/transcript/{transcriptId}/audio` | MP3 source | path uuid | binaire |

Statuts : `PENDING` → `SUBMITTED` → `PROCESSING` → `COMPLETED` ou `ERROR`.

### 5.10 Skills locaux

Les réponses sont typées `object` (non documentées).

| Méthode | Chemin | Description | Entrée |
|---|---|---|---|
| GET | `/skills` | Lister | query : `after`, `limit` (int64), `order`, `query`, `flag`, `flags[]`, `flags_bitfield` (int32) |
| POST | `/skills` | Créer | `multipart/form-data` : `files[]` (**requis**), query `flags[]` |
| GET | `/skills/{skillId}` | Récupérer | — |
| POST | `/skills/{skillId}` | Modifier la version par défaut | body JSON libre |
| DELETE | `/skills/{skillId}` | Supprimer | — |
| GET | `/skills/{skillId}/content` | ZIP du skill | — |
| GET | `/skills/{skillId}/versions` | Lister les versions | query : `after`, `limit`, `order` |
| POST | `/skills/{skillId}/versions` | Créer une version **immutable** | `multipart/form-data` : `files[]`, query `default` (bool) |
| GET | `/skills/{skillId}/versions/{version}` | Récupérer une version | — |
| DELETE | `/skills/{skillId}/versions/{version}` | Supprimer une version | — |
| GET | `/skills/{skillId}/versions/{version}/content` | ZIP d'une version | — |

### 5.11 Serveurs MCP

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| GET | `/mcp/servers` | Lister | — | `McpServerListDto` |
| POST | `/mcp/servers` | Ajouter | `McpServerCreateDto` | `McpServerDto` |
| GET | `/mcp/servers/{serverId}` | Récupérer | — | `McpServerDto` |
| POST | `/mcp/servers/{serverId}` | Modifier | `McpServerUpdateDto` | `McpServerDto` |
| DELETE | `/mcp/servers/{serverId}` | Supprimer | — | objet libre |
| POST | `/mcp/servers/{serverId}/discover` | Rafraîchir les tools exposés | — | `McpServerDto` |
| POST | `/mcp/servers/{serverId}/oauth/start` | Démarrer l'autorisation OAuth | — | `McpOAuthStartDto` |
| POST | `/mcp/servers/oauth/complete` | Terminer l'autorisation OAuth | `McpOAuthCompleteDto` | `McpServerDto` |

### 5.12 Modèles

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/models` | Modèles actifs et visibles (config en base ou `resources/models`) et service IA vers lequel ils sont routés. Réponse non typée. |

### 5.13 Safety Hub

| Méthode | Chemin | Description | Entrée | Sortie |
|---|---|---|---|---|
| GET | `/safety-hub/@me` | Safety Hub de l'utilisateur | — | `SafetyHubDto` |
| PUT | `/safety-hub/request-review/{classificationId}` | Faire appel d'une classification | `SafetyAppealRequestDto` | `SafetyAppealResponseDto` |

### 5.14 Public 🔓

| Méthode | Chemin | Description | Sortie |
|---|---|---|---|
| GET | `/public/health` | État de l'app, de la base et de Redis | `PublicHealthDto` |
| GET | `/public/alerts` | Alertes actives à afficher côté client | `PublicAlertsDto` |

### 5.15 Endpoints orientés application web

Documentés pour complétude ; non couverts par le SDK.

| Méthode | Chemin | Description |
|---|---|---|
| GET/POST/DELETE | `/user/push/subscriptions` | Lister / créer-mettre à jour / supprimer la subscription Web Push de l'appareil |
| GET | `/user/push/vapid-public-key` | Clé publique VAPID |
| GET | `/user/@me/survey` | Survey actif (query `disable_auto_seen`, `survey_override`) |
| POST | `/user/@me/survey/{surveyId}/seen` | Marquer un survey comme vu |
| GET | `/user/@me/feedback-experiences/{experienceId}` | État d'une feedback experience |
| POST | `/user/@me/feedback-experiences/{experienceId}/responses` | Sauvegarder rating / `doNotShowAgain` |
| POST | `/ads/challenges/{challengeId}/complete` | Compléter un challenge publicitaire (`AdChallengeCompleteResponse`) |
| GET | `/user/passkeys` | Lister mes passkeys |
| DELETE / PATCH | `/user/passkeys/{id}` | Supprimer / renommer (`RenameRequest`) |
| POST | `/user/passkeys/registration/options` / `.../finish` | Enregistrement WebAuthn |
| POST | `/user/passkeys/verification/options` / `.../finish` | Vérification (preuve valable **5 minutes** pour la session) |
| GET | `/user/passkeys/verification` | Date d'expiration de la vérification |
| GET | `/metrics` | Métriques Prometheus (texte) |
| GET | `/metrics/chat-streams` | Impact de la limite de streams (**réservé au staff**) |
| GET | `/auth/staff` | Contrôle d'accès staff (cookie `next-auth.session-token`) |
| GET | `/`, `/error` | Landing / erreurs |

Les endpoints passkeys exigent les headers `Authorization` et `Origin` (requis, en plus du schéma de sécurité global).

---

## 6. Schémas de données

Notation : `?` = optionnel (aucun champ n'est marqué requis sauf mention).

### 6.1 Chat

**ChatCreateDto** (requis : `agentId`)
```
chatId?: uuid
agentId: int32
initialContent?: string
images?: uuid[]            // IDs Files v1
files?: string[]           // IDs Files v2
enableWebSearch?: boolean
projectId?: uuid
```

**MessageDto**
```
content?: string
images?: uuid[]
files?: string[]
enableWebSearch?: boolean
agentId?: int32            // change d'agent pour cette réponse et les suivantes
```

**ChatUpdateDto** `{ title?: string, isPrivate?: boolean }`

**ChatMessageEditDto** (requis : `content`, minLength 1) `{ content: string }`

**ChatSummaryDto**
```
id, projectId?: uuid
title: string
flags: int32
isPrivate, isPinned: boolean
createdAt, lastMessageAt: date-time
agent: Agent
tokenUsage: TokenUsage
sharePermissionFlags: int32
```

**ChatDetailDto**
```
id, projectId?: uuid
title: string
flags: int32
createdAt, lastMessageAt: date-time
agent: { id: int32 }
chatMessages: ChatMessage[]
```

**ChatHistoryDto** `{ chats: ChatSummaryDto[], hasMore: boolean }`

**ChatDocument** : `id, title, flags, createdAt, agentId, model, modelProvider, userId, projectId, lastMessageAt, promptTokenCount, candidatesTokenCount, totalTokenCount, reasoningTokenCount, remoteConversationId, remoteLastResponseId, agent, user, chatMessages, tokenUsage, chatFlags[], isApi, isDeleted, isEphemeral, isArchived, isPrivate, isPinned`.

**ChatMessage**
```
id: uuid, chatId: uuid, userId: int32, agentId: int32
model, modelProvider, role, content: string
createdAt: date-time
isUpvoted: boolean
webSearchDomains: string[]
tokenUsage: TokenUsage
usedFileIds: uuid[]          // Files v1
usedFilesV2Ids: string[]     // Files v2
parts: JsonNode              // parties structurées (type libre)
```

**TokenUsage** `{ promptTokenCount, candidatesTokenCount, totalTokenCount, reasoningTokenCount: int32 }`

**ChatUsageDto** `{ tokenUsage: TokenUsage, contextUsagePercent: int32 }`

**Agent**
```
id: int32, name, namespace, description, model, modelProvider: string
isActive, isDefault: boolean
```

**VoteDto** (requis) `{ isUpvoted: boolean }`

**SavedMessageDto** `{ id: string, chatId, messageId: uuid, savedAt: date-time, message: ChatMessage }`
**SavedMessagesPageDto** `{ savedMessages[], hasMore, nextCursor }`

**ConversationImportRequestDto** (requis) `{ link: string, model: string }`
**ConversationImportResponseDto** `{ chatId, title, source, sourceConversationId, sourceModel, localModel, importedMessagesCount, importedAt }`

### 6.2 Partages

**ChatShareCreateDto** (requis : `permission`) `{ userId?: int32, userEmail?: string, permission: "View" | "Write" }`
**ChatShareUpdateByTargetDto** : idem.
**ChatShareUpdateDto** `{ permission: "View" | "Write" }`
**ChatShareTargetDto** `{ userId?: int32, userEmail?: string }`
**ChatShareAccessDto / ProjectShareAccessDto** `{ userId, userEmail, permission, owner: boolean }`
**ProjectShareCreateDto** (requis) `{ userEmail: string }`

### 6.3 Projets

**ProjectCreateDto** (requis) `{ name: string (max 255) }`
**ProjectUpdateDto** `{ name?: string (max 255, non vide), flags?: int32 (0 à 3) }` — flags : `PUBLIC`=1, `PINNED`=2 ; `0` retire les deux, `3` active les deux ; les bits réservés sont refusés.
**ProjectDto** `{ id: uuid, name, ownerId: int32, customInstructions, flags: int32, createdAt }`

### 6.4 Utilisateur

**UserDto** `{ id, name, email, avatar, providerAccountId, pets, theme, language, speechToTextLanguage, lastChangelogViewedAt, tokenUsage }`

**UserUpdateDto** `{ name? (2 à 100 car.), pets?, theme?, language?, speechToTextLanguage?, lastChangelogViewedAt?, flags?: int32 }`

**UserProfileUpdateDto** `{ name? (2 à 100), avatar? }`

**UserPersonalizationDto / UserPersonalizationUpdateDto**
```
gptReasoning: none | minimal | low | medium | high | xhigh
customInstructions: string (max 2 000 000)
defaultModelId: int32
adsFrequency: none | 5min | 15min | 30min | 1h | 3h | 12h | 24h
memoryEnabled: boolean
imageGenerationModel: gpt-image-2.5-sunburst | gpt-image-2.5-flare | gpt-image-2
webSearchMode: open | filtered | disabled
documentToolsEnabled: boolean
imageGenerationToolEnabled: boolean
```

**NotificationPreferencesDto** `{ appUpdates: boolean, offersAndSubscriptions: boolean }`

**UserWebSearchDomainsDto** (requis : les 3 champs)
```
filterType: allowlist | blocklist
allowedDomains: string[]
blockedDomains: string[]
```

**WebSearchAuditPageDto** `{ entries: [{ messageId, chatId, createdAt, domains[], calls }], hasMore, nextCursor }`

**UserUsageDto** `{ rateLimits: UserRateLimitUsageDto[], rateLimitPowerUpActive: boolean, chatBudget: BudgetUsage }`
**UserRateLimitUsageDto** `{ type, bucket, limit, used, remaining (int64), resetAt, usedPercent, remainingPercent (double) }`
**BudgetUsage** `{ usedPercent, remainingPercent: double, resetAt, accountingUncertain: boolean }`
**UserTokenUsageDto** `{ promptTokenCount, candidatesTokenCount, totalTokenCount, reasoningTokenCount, last7DaysTokenUsage: [{ date, inputTokens, outputTokens, totalTokens, reasoningTokens }] }`
**RateLimitCreditsDto** `{ availableCount: int64, resets: [{ id, grantedAt, expiresAt, durationDays }] }`
**RateLimitPowerUpDto** `{ active: boolean, expiresAt }`
**UserSessionDto** `{ id, since, os, location }`
**UserFlagDto** `{ name, description }`
**UserInviteRequestDto** (requis) `{ email: string (format email) }`
**UserReferralInviteDto** `{ id, inviterUserId, invitedEmail, status: PENDING|SENT|FAILED|ACCEPTED, createdAt, sentAt, acceptedAt }`

**UserMemoriesDto** `{ count, totalSizeBytes, memories: [{ id, path, name, sizeBytes, createdAt, updatedAt }] }`
**UserMemoryContentDto** : idem avec `content: string`.

### 6.5 Fichiers

**FileUploadResponseDto** `{ uuid, pathname, contentType, url }`
**FileContentResponseDto** `{ uuid, pathname, contentType, base64Data, url }`
**FilesV2ListResponseDto** `{ object, data: FileObject[], first_id, last_id, has_more }` (`FileObject` non typé)
**FilesV2UsageDto** `{ filesBytes, filesGb, skillsBytes, skillsGb, usedBytes, usedGb, maxBytes, maxGb, remainingBytes, remainingGb }`
**FileDeleted** : objet de type enveloppe JSON `{ id, deleted, object, isValid }` (format OpenAI : `{ id, object: "file", deleted: true }`).

### 6.6 Transcription

**TranscriptCreateResponseDto** `{ uuid, status, createdAt }`
**TranscriptSummaryDto** `{ uuid, pathname, status, createdAt, completedAt }`
**TranscriptDetailDto** `{ uuid, pathname, contentType, sizeBytes, status, transcriptText, languageCode, languageConfidence (double), failureReason, createdAt, startedAt, completedAt }`

### 6.7 MCP

**McpServerCreateDto** (requis : `server_label` ≤ 64, `server_url` ≤ 2048)
```
server_label, server_description (≤ 1000), server_url
auth_type: string, oauth_scopes: string[]
allowed_tools: string[]
require_approval: string, defer_loading: boolean, enabled: boolean
authorization: string
headers: { [name]: string }
```
**McpServerUpdateDto** : mêmes champs, tous optionnels, plus `clear_authorization`, `clear_headers` (boolean).
**McpServerDto** `{ id, object, server_label, server_description, server_url, auth_type, oauth_status, oauth_scopes, allowed_tools, available_tools: McpToolDocument[], require_approval, defer_loading, enabled, has_authorization, credential_header_names, created_at, updated_at }`
**McpToolDocument** `{ name, title, description, annotations, input_schema }`
**McpServerListDto** `{ object, data: McpServerDto[] }`
**McpOAuthStartDto** `{ authorization_url, state }`
**McpOAuthCompleteDto** (requis) `{ code, state }`

### 6.8 Safety Hub

**SafetyHubDto** `{ classifications[], project_classifications[], account_standing: { state }, is_appeal_eligible, username }`
**SafetyClassificationDto** `{ id, classification_type, description, explainer_link, actions: SafetyAction[], max_expiration_time, flagged_content: [{ type, id, content, attachments[] }], appeal_status: SafetyAppeal, is_appeal_eligible, project_metadata: { id, name }, created_at }`
**SafetyAction** `{ id, descriptions[], action_type }`
**SafetyAppeal** `{ id, status, signal, user_input, created_at, reviewed_at }`
**SafetyAppealRequestDto** (requis : `signal`) `{ signal: 0|1|2|3, user_input?: string (max 1000) }`
**SafetyAppealResponseDto** `{ appeal_id: uuid }`

### 6.9 Public

**PublicHealthDto** `{ checkedAt, status, app, database, redis, webdav, jaeger }`, chacun de type **Check** `{ status, message, responseTimeMs, avgResponseTimeMs5m, samples5m }`
**PublicAlertsDto** `{ alerts: [{ id, type, severity, title, message, placements[], dismissible, dismissalKey, updatedAt }] }`

### 6.10 Autres (web app)

`PushSubscriptionUpsertRequestDto` `{ endpoint (≤4096, requis), expirationTime, keys: { p256dh, auth } (requis), userAgent, deviceLabel }` · `PushSubscriptionResponseDto` · `VapidPublicKeyResponseDto { publicKey }` · `UserSurveyResponseDto { survey: { id, key, prompt, cta, url } }` · `FeedbackExperienceSaveDto { rating, doNotShowAgain }` · `Challenge { requestId, options }` · `FinishRequest { requestId, credential }` · `VerificationResult { verifiedUntil }` · `PasskeyView { id, name, rpId, createdAt, lastUsedAt }` · `ChatStreamLimitMetrics { limitPerUser, current: StreamMetrics, admission: AdmissionStats }`.

---

## 7. Enums et flags

| Enum | Valeurs |
|---|---|
| `language`, `speechToTextLanguage` | `en`, `fr` |
| `theme` | `light`, `gris`, `dark`, `gradien`, `graphite`, `aurora`, `synthwave`, `lagoon`, `ember`, `matcha`, `midnight`, `rose`, `citrus`, `ocean`, `dusk`, `obsidian`, `amethyst`, `spruce`, `ruby`, `cobalt` |
| `pets` | `none`, `apupepe`, `claude-pixel`, `codix`, `dario`, `goblin-lp`, `luoxiaohei2d`, `mini-elon`, `mini-sama`, `bear`, `bunny`, `cat`, `deer`, `dino`, `fox`, `frog`, `hamster`, `hedgehog`, `koala`, `otter`, `owl`, `panda`, `penguin`, `pug`, `raccoon`, `redpanda`, `sheep`, `sloth`, `tiger`, `afro`, `astronaut`, `bald`, `ballerina`, `beard`, `builder`, `cap`, `chef`, `glasses`, `grandpa`, `granny`, `hijabi`, `kamran`, `nurse`, `pirate`, `scientist`, `sikh`, `skater`, `wizard`, `clockwork`, `crt`, `cube`, `drone`, `gearbot`, `knight`, `lantern`, `postbot`, `radio`, `rocket`, `scout`, `toaster`, `tv`, `lekkerelou` (liste officielle via `GET /user/pets`) |
| `gptReasoning` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `adsFrequency` | `none`, `5min`, `15min`, `30min`, `1h`, `3h`, `12h`, `24h` |
| `imageGenerationModel` | `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2` |
| `webSearchMode` | `open`, `filtered`, `disabled` |
| `filterType` | `allowlist`, `blocklist` |
| `permission` (partages) | `View`, `Write` |
| `chatFlags` | `PRIVATE`, `PINNED`, `EPHEMERAL`, `API`, `DELETED`, `FORK`, `IMPORTED`, `ARCHIVED` |
| `userFlags` | `STAFF`, `PARTNER`, `BUG_HUNTER_LEVEL_1`, `DISABLED`, `COLLABORATOR`, `SCHEDULED_FOR_DELETION`, `UNLIMITED_USE`, `MANAGE_SETTINGS`, `BETA_TESTER`, `AUTOMATION`, `INACTIVE` |
| `transcript status` | `PENDING`, `SUBMITTED`, `PROCESSING`, `COMPLETED`, `ERROR` |
| `invite status` | `PENDING`, `SENT`, `FAILED`, `ACCEPTED` |
| `rating` (feedback) | `positive`, `neutral`, `negative` |
| Project `flags` (bitfield) | `PUBLIC`=1, `PINNED`=2 |
| Safety `classification_type` | `1`, `100`, `200`, `300`, `400`, `500`, `1000` (significations non documentées) |
| Safety `action_type` | `0`, `1`, `4`, `9`, `13`, `15`, `20` (non documenté) |
| Safety `account_standing.state` | `100`, `200`, `500` (non documenté) |
| Safety appeal `signal` | `0`, `1`, `2`, `3` ; `status` : `1`, `2`, `3` |

`ChatSummaryDto.flags` est un bitfield : à l'exemple du flux (`"flags":1` avec `"isPrivate":true`), le bit `1` correspond à `PRIVATE`. Les autres positions de bits ne sont pas documentées : préférer `isPrivate`, `isPinned`, `isEphemeral`, ou `chatFlags` sur `ChatDocument`.

### Agents connus (observés, **susceptibles de changer**)

| ID | Nom |
|---|---|
| `-1002` | GPT 6 Luna |
| `-1003` | GPT 6.1 Sol |
| `-2002` | Claude Haiku 5.5 |
| `-2001` | Claude Opus 5.5 |

Toujours récupérer la liste à jour avec `GET /chats/agents`.

---

## 8. Erreurs et rate limits

- **401** : access token expiré ou invalide → renouveler via le session token puis réessayer une fois.
- **429 / 503** : limite de débit ou indisponibilité transitoire. Un budget de chat épuisé ne doit pas être réessayé ; le SDK expose la date de reset (`resetAt`) lorsque le message l'indique.
- **Erreurs de flux SSE** : statut HTTP 200 et événement `error` (voir 4.1). `CONTENT_POLICY_VIOLATION` n'est pas réessayable et peut entraîner une suspension (`account_disabled`).
- **Cloudflare** : un User-Agent de navigateur est requis ; sinon la requête peut être bloquée.
- **Suivi de l'usage** : `GET /user/usage` (limites par bucket), `GET /user/chat-budget`, `GET /user/rate-limit-credits`, `POST /user/rate-limit-credits/activate` (power-up x2 pendant 7 jours).
- **Limite de streams** : il existe une limite de générations simultanées par utilisateur (`limitPerUser`, `/metrics/chat-streams`, staff uniquement).

Codes d'erreur HTTP exacts et corps d'erreur : non documentés dans la spec (seul `200` y figure).

---

## 9. SDK TypeScript / CLI

Dépôt : <https://github.com/FranceStudent/francestudent-ai-sdk> (non officiel, branche `master`). Prérequis : Node 22 ou 24.

```bash
npm install francestudent-ai-sdk          # en dépendance
npm install -g francestudent-ai-sdk       # CLI globale : fsai
```

### 9.1 Initialisation

```ts
import { FranceStudent } from 'francestudent-ai-sdk';

const fs = new FranceStudent({
  sessionToken: process.env.FS_SESSION_TOKEN,
  onSessionUpdate: async (token) => saveSomewhere(token),
});
```

Variantes : `accessToken` (JWT utilisé tel quel, non renouvelable) ; `await fs.login('EMAIL', 'PASSWORD')` ; `fs.token()` retourne un access token valide et sa date d'expiration.

### 9.2 Options de configuration

| Option | Description |
|---|---|
| `sessionToken` | Valeur du cookie `next-auth.session-token` (ou cookie complet) |
| `accessToken` | JWT direct, non renouvelable |
| `deviceId` | Header `francestudent-device-id` (UUID aléatoire par défaut) |
| `apiUrl` | Défaut `https://api.francestudent.ai` |
| `origin` | Défaut `https://ia.francestudent.org` |
| `clientVersion` | Header `francestudent-client-version` |
| `clientPlatform` | Défaut `web_fs_ai` |
| `userAgent` | User-Agent navigateur par défaut (requis pour Cloudflare) |
| `headers` | Headers custom ajoutés à toutes les requêtes |
| `proxy` | URL (`http(s)://`, `socks://`) ou config proxy Axios |
| `timeout` | Timeout des requêtes (ms) |
| `logging` | Logs de debug |
| `delay` | Délai entre requêtes (ms) ou fonction |
| `maxRetries` | Retries sur erreurs transitoires (défaut `0`). `POST`/`PATCH` ne sont rejoués que s'ils n'ont certainement pas atteint le serveur, ou sur 429/503 ; un budget de chat épuisé n'est jamais rejoué |
| `streamFirstByteTimeout` | Défaut 60 000 ms (`0` = désactivé) |
| `streamIdleTimeout` | Défaut 90 000 ms |
| `streamTimeout` | Défaut 310 000 ms |
| `errorHandler` | Gestionnaire d'erreurs custom |
| `responseMiddleware` | Fonction appelée avec chaque réponse réussie |
| `onSessionUpdate` | Appelée avec le nouveau session token |
| `fetch` | Implémentation `fetch` custom (adapter fetch d'Axios ; le login email/mot de passe peut ne pas fonctionner) |

`sessionToken`, `accessToken`, `headers` et `proxy` peuvent être modifiés sur une instance existante.

### 9.3 Services et correspondance avec l'API

| Service | Méthodes | Commande CLI |
|---|---|---|
| `fs.chat` | `agents`, `models`, `list`, `archived`, `search`, `details`, `usage`, `ask`, `stream`, `reply`, `send`, `attach`, `cancel`, `update`, `pin`, `unpin`, `archive`, `restore`, `download`, `delete`, `deleteAll`, `share`, `shares`, `updateShare`, `unshare`, `importOpenAi` | `chat` |
| `fs.message` | `edit` (fork), `vote`, `save`, `unsave`, `saved`, `image` | `message` |
| `fs.project` | `list`, `shared`, `details`, `create`, `update`, `delete`, `chats`, `addChat`, `removeChat`, `shares`, `share`, `unshare` | `project` |
| `fs.user` | `details`, `update`, `updateProfile`, `delete`, `instructions`, `updateInstructions`, `notificationPreferences`, `updateNotificationPreferences`, `usage`, `tokenUsage`, `chatBudget`, `credits`, `activatePowerUp`, `sessions`, `terminateSession`, `terminateAllSessions`, `flags`, `pets`, `invite`, `registerBeta`, `webSearchDomains`, `updateWebSearchDomains`, `webSearchAudit`, `safetyHub`, `appeal` | `user` |
| `fs.memory` | `list`, `details`, `delete`, `deleteAll` | `memory` |
| `fs.file` (Files v2) | `upload`, `list`, `details`, `content`, `delete`, `usage`, `mimeTypes` | `file` |
| `fs.attachment` (Files v1) | `upload`, `list`, `details`, `delete` | `attachment` |
| `fs.transcript` | `upload` (MP3), `list`, `details`, `wait` (polling jusqu'à `COMPLETED`), `audio` | `transcript` |
| `fs.skill` | `list`, `details`, `create`, `delete`, `content` (ZIP), `versions`, `version`, `createVersion`, `setDefaultVersion`, `deleteVersion` | `skill` |
| `fs.mcp` | `list`, `details`, `create`, `update`, `delete`, `discover`, `startOAuth`, `completeOAuth` | `mcp` |
| `fs.public` | `health`, `alerts` (sans authentification) | `public` |

Les uploads de `fs.file`, `fs.attachment` et `fs.transcript` acceptent un chemin local ou `{ data, name, type? }` ; `fs.skill` accepte une liste de `{ data, name, type? }`.

**Pièces jointes dans un chat** : `files` = IDs Files v2 (`fs.file.upload()`), `images` = IDs Files v1 (`fs.attachment.upload()`).

### 9.4 Erreurs du SDK

| Classe | Quand |
|---|---|
| `FranceStudentError` | L'API répond par une erreur. Propriétés : `status` (HTTP), `body` (corps brut), `resetAt` (reset d'un rate limit / budget de chat, si indiqué) |
| `AuthenticationError` | Échec de login/renouvellement ou aucun identifiant. `needsLogin` indique si un nouveau login est requis |
| `StreamError` | Un flux de chat signale une défaillance. `details` contient le payload brut |

### 9.5 Accès brut

```ts
import { FetcherService, FranceStudentConfig, ResourceType } from 'francestudent-ai-sdk';

const fetcher = new FetcherService(
  new FranceStudentConfig({ sessionToken: process.env.FS_SESSION_TOKEN }),
);
const response = await fetcher.request(ResourceType.USER_USAGE, {});
console.log(response.data);
```

Chaque modèle expose ses données brutes via le getter `raw` ; les types bruts sont exportés avec le préfixe `IRaw`.

### 9.6 CLI `fsai`

```bash
export FS_SESSION_TOKEN='...'
fsai user details
fsai --session '...' chat agents
fsai chat ask "Bonjour !" --agent -1002
fsai chat ask "Et en anglais ?" --chat CHAT_ID
fsai help chat
fsai auth login [email]      # lit FS_EMAIL / FS_PASSWORD, affiche le session token
```

| Option globale | Variable d'env | Description |
|---|---|---|
| `-s, --session <string>` | `FS_SESSION_TOKEN` | Session token |
| `-a, --access-token <string>` | `FS_ACCESS_TOKEN` | Access token (JWT) direct |
| `--device-id <string>` | `FS_DEVICE_ID` | Device ID (aléatoire à chaque exécution sinon) |
| `--api-url <string>` | `FS_API_URL` | URL de base de l'API |
| `--origin <string>` | `FS_ORIGIN` | Origine de l'application web |
| `-l, --log` | | Logs de debug |
| `-p, --proxy <string>` | | Proxy |
| `-t, --timeout <number>` | | Timeout (ms) |
| `-r, --retries <number>` | | Retries max |
| `-d, --delay <number>` | | Délai entre requêtes (ms) |

Sortie en JSON (ou texte brut) ; erreurs sur stderr avec code de sortie non nul. Les commandes destructrices globales (`user delete`, `user logout --all`, `memory delete --all`, `project delete`) exigent `--yes`.

### 9.7 Développement du SDK

```bash
npm install     # installe et build (dist/)
npm run build   # tsc
npm test        # build + node:test avec serveur mock
npm run lint    # eslint --fix
npm run format  # prettier --write
npm run docs    # typedoc
```

Architecture (inspirée de Rettiwt-API) : chaque endpoint est un `ResourceType` → builder de requête (`src/requests`) → `FetcherService` → extracteur (`src/collections/Extractors.ts`) → modèle (`src/models/data`) → service (`src/services/public`) → commande CLI (`src/commands`). Un dossier `playground/` contient un script d'essai.

---

## 10. Exemples complets

### 10.1 HTTP brut : obtenir un access token puis lister les agents

```bash
# 1) Échange session token -> access token (JWT)
curl -s https://ia.francestudent.org/api/auth/api-token \
  -H "Cookie: next-auth.session-token=$FS_SESSION_TOKEN" \
  -H "User-Agent: Mozilla/5.0 ..."

# 2) Appel de l'API
curl -s https://api.francestudent.ai/chats/agents \
  -H "Authorization: Bearer $FS_ACCESS_TOKEN" \
  -H "User-Agent: Mozilla/5.0 ..."
```

La forme exacte de la réponse de `/api/auth/api-token` n'est pas dans la spec (elle est gérée par le SDK) : à vérifier avec une vraie réponse.

### 10.2 Créer un chat et lire le flux SSE (curl)

```bash
curl -N -X POST https://api.francestudent.ai/chats/stream \
  -H "Authorization: Bearer $FS_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"agentId":-1002,"initialContent":"Bonjour !","enableWebSearch":false}'
```

### 10.3 Lire le flux en Node (sans SDK)

```ts
const res = await fetch('https://api.francestudent.ai/chats/stream', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  },
  body: JSON.stringify({ agentId: -1002, initialContent: 'Bonjour !' }),
});

const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of res.body!) {
  buffer += decoder.decode(chunk, { stream: true });
  let sep: number;
  while ((sep = buffer.indexOf('\n\n')) !== -1) {
    const raw = buffer.slice(0, sep);
    buffer = buffer.slice(sep + 2);
    const event = /^event: (.*)$/m.exec(raw)?.[1];
    const data = /^data: (.*)$/m.exec(raw)?.[1];
    if (!event || !data) continue;
    const payload = JSON.parse(data);
    if (event === 'response.output_text.delta') process.stdout.write(payload.delta);
    if (event === 'error') throw new Error(payload.message);
    if (event === 'completed') console.log('\nchat:', payload.chat_id);
  }
}
```

### 10.4 Avec le SDK : chat avec fichier joint

```ts
const file = await fs.file.upload('./cours.pdf');          // Files v2
const res = await fs.chat.ask(
  { agentId: -2002, content: 'Résume ce document', files: [file.id] },
  { onDelta: (d) => process.stdout.write(d) },
);
const suite = await fs.chat.reply(res.chatId!, { content: 'Fais une fiche de révision' });
```

### 10.5 Avec le SDK : itérer sur le flux et annuler

```ts
const stream = await fs.chat.stream({ agentId: -1002, content: 'Raconte une blague' });
for await (const event of stream) {
  if (event.delta) process.stdout.write(event.delta);
}
console.log(stream.chatId, stream.text);

// stream.abort() arrête la réception ; fs.chat.cancel(chatId) arrête la génération côté serveur
```

### 10.6 Transcription d'un MP3

```ts
const job = await fs.transcript.upload('./reunion.mp3');
const done = await fs.transcript.wait(job.uuid);
console.log(done.transcriptText, done.languageCode);
```

### 10.7 Restreindre la recherche web à certains domaines

```bash
curl -X PUT https://api.francestudent.ai/user/web-search-domains \
  -H "Authorization: Bearer $FS_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"filterType":"allowlist","allowedDomains":["wikipedia.org","legifrance.gouv.fr"],"blockedDomains":[]}'

curl -X PATCH https://api.francestudent.ai/user/instructions \
  -H "Authorization: Bearer $FS_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"webSearchMode":"filtered"}'
```

---

## 11. Endpoints non couverts par le SDK

Volontairement exclus car réservés à l'application web ou non destinés aux utilisateurs :

- push subscriptions et clé VAPID (`/user/push/...`)
- surveys (`/user/@me/survey`) et feedback experiences (`/user/@me/feedback-experiences/...`)
- ads challenges (`/ads/...`)
- passkeys (`/user/passkeys/...`, nécessitent WebAuthn dans un navigateur)
- métriques (`/metrics`, `/metrics/chat-streams`), accès staff (`/auth/staff`), landing/erreurs (`/`, `/error`)
- `DELETE /user/chats` (doublon de `DELETE /chats`, couvert par `fs.chat.deleteAll()`)

---

*Sources : spec OpenAPI `https://api.francestudent.ai/v3/api-docs`, README de `https://github.com/FranceStudent/francestudent-ai-sdk` (consultés le 14/10/2026).*