# Documentation de l'API France Student

> Documentation générée à partir de la spécification OpenAPI 3.1.0 publiée sur `https://api.francestudent.org/v3/api-docs` (titre « OpenAPI definition », version `v0`).

## Sommaire

1. [Informations générales](#1-informations-générales)
2. [Authentification](#2-authentification)
3. [Conventions](#3-conventions)
4. [Endpoints](#4-endpoints)
   - [Chats](#chats) · [Streaming SSE](#streaming-sse-chatstreamevent) · [Chat Shares](#chat-shares) · [Chat Message Images](#chat-message-images) · [Messages](#messages)
   - [OpenAI compatible API](#openai-compatible-api)
   - [Models](#models)
   - [Projects](#projects) · [Partage de projets](#partage-de-projets-project-share-controller)
   - [Locked Chats](#locked-chats)
   - [Files](#files) · [Files v2](#files-v2)
   - [Skills](#skills)
   - [MCP Servers](#mcp-servers)
   - [DeskDock](#deskdock)
   - [Conversation imports](#conversation-imports)
   - [Users](#users) · [API Key](#api-key) · [Passkeys](#passkeys) · [Saved Messages](#saved-messages) · [Surveys](#surveys) · [Feedback Experiences](#feedback-experiences) · [Recherche web](#recherche-web-user-web-search-controller)
   - [Safety Hub](#safety-hub)
   - [Patch Notes](#patch-notes)
   - [Public et Data export](#public-et-data-export) · [Metrics](#metrics) · [Divers](#divers)
5. [Schémas](#5-schémas)
6. [Exemples](#6-exemples-curl)

---

## 1. Informations générales

| Élément | Valeur |
|---|---|
| Spécification | OpenAPI 3.1.0 |
| Titre / version | OpenAPI definition / `v0` |
| URL de base | `http://api.francestudent.org` (« Generated server url ») |
| Format des échanges | JSON (`application/json`), `multipart/form-data` pour les uploads, `text/event-stream` pour le streaming |
| Interface interactive | `https://api.francestudent.org/swagger-ui/index.html` |

> Le serveur déclaré dans la spécification utilise `http`. En pratique l'API est servie en HTTPS sur `api.francestudent.org`.

## 2. Authentification

Un seul schéma de sécurité est défini, appliqué globalement à tous les endpoints :

| Nom | Type | Emplacement | Paramètre |
|---|---|---|---|
| `sessionToken` | `apiKey` | en-tête HTTP | `authorization` |

```http
authorization: <jeton de session ou clé API>
```

Remarques tirées de la spécification :

- Une clé API personnelle peut être générée via [`POST /user/@me/api-key`](#api-key) ; la clé en clair n'est renvoyée qu'**une seule fois**.
- `GET /auth/staff` lit le cookie `next-auth.session-token`.
- Les endpoints `/public/**` sont documentés comme accessibles **sans authentification** (`/public/health`, `/public/alerts`, `/public/data-export/download` via un jeton à usage unique).
- Certains endpoints sont réservés au **staff** (`/metrics/chat-streams`) ou au **propriétaire** d'un chat (compactage du contexte).
- Les chats verrouillés nécessitent un en-tête supplémentaire `X-Locked-Chats-Access` (voir [Locked Chats](#locked-chats)).
- Les endpoints Passkeys exigent l'en-tête `Origin`.

## 3. Conventions

- **Identifiants** : la plupart des ressources (chats, messages, projets, fichiers) utilisent des UUID. Les utilisateurs utilisent un entier `int32`. Skills, serveurs MCP, passkeys et mémoires utilisent des chaînes.
- **Dates** : format `date-time` (ISO 8601).
- **Pagination par curseur** : `cursor`, `cursor_chat_id` ou `after`, avec `limit` ; les réponses exposent `hasMore` et `nextCursor`.
- **Réponses** : la spécification ne documente que le code `200 OK`. Les erreurs ne sont pas décrites, sauf quelques codes cités dans les descriptions (`404`, `409`, `422`).
- **Flags (bitfield)** : `flags` sur les chats et projets est un entier à bits (projets : `PUBLIC` = 1, `PINNED` = 2).
- **Streaming** : une ligne `: keepalive` est envoyée après 15 s sans événement ; elle doit être ignorée.

---

## 4. Endpoints

Tous les endpoints exigent l'en-tête `authorization` (sauf `/public/**`). Les corps de requête et de réponse renvoient vers les [schémas](#5-schémas).

### Chats

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/chats` | Lister les chats de l'utilisateur |
| `DELETE` | `/chats` | Supprimer tous les chats |
| `POST` | `/chats/stream` | Créer un chat et streamer la réponse |
| `GET` | `/chats/{chatId}` | Récupérer un chat |
| `POST` | `/chats/{chatId}` | Envoyer un message en streaming |
| `PATCH` | `/chats/{chatId}` | Mettre à jour un chat |
| `DELETE` | `/chats/{chatId}` | Supprimer un chat |
| `GET` | `/chats/{chatId}/stream` | Se rattacher au stream d'un chat |
| `POST` | `/chats/{chatId}/stream/cancel` | Arrêter la génération |
| `PATCH` | `/chats/{chatId}/messages/{messageId}` | Éditer un message en forkant le chat |
| `GET` | `/chats/{chatId}/context` | Occupation du contexte |
| `POST` | `/chats/{chatId}/context` | Compacter le contexte |
| `GET` | `/chats/{chatId}/usage` | Usage en tokens |
| `PUT` / `DELETE` | `/chats/{chatId}/pins` | Épingler / désépingler |
| `PUT` | `/chats/{chatId}/archive` | Archiver |
| `PUT` | `/chats/{chatId}/restore` | Restaurer un chat archivé |
| `GET` | `/chats/{chatId}/archive/download` | Télécharger les messages archivés |
| `GET` | `/chats/archived` | Lister les chats archivés |
| `GET` | `/chats/search` | Rechercher dans les chats |
| `GET` | `/chats/agents` | Lister les agents disponibles |

#### `GET /chats` — Lister les chats de l'utilisateur
Conversations de l'utilisateur, pagination par curseur.

| Paramètre | In | Type | Requis | Défaut | Description |
|---|---|---|---|---|---|
| `limit` | query | int32 | **oui** | | Nombre de chats |
| `cursor_chat_id` | query | uuid | non | | Curseur de pagination |
| `sortedBy` | query | string | non | `lastMessageAt` | Critère de tri |

Réponse `200` : [`ChatHistoryDto`](#chathistorydto).

#### `DELETE /chats` — Supprimer tous les chats
Marque toutes les conversations avec le flag `DELETED` (documents et messages conservés). Réponse `200` vide.

#### `POST /chats/stream` — Créer un chat et streamer la réponse
Crée une conversation puis renvoie la réponse de l'agent en flux SSE.
Corps (`application/json`, requis) : [`ChatCreateDto`](#chatcreatedto).
Réponse `200` : `text/event-stream` de [`ChatStreamEvent`](#streaming-sse-chatstreamevent).

#### `GET /chats/{chatId}` — Récupérer un chat
Paramètre : `chatId` (path, uuid). Réponse `200` : [`ChatDetailDto`](#chatdetaildto).

#### `POST /chats/{chatId}` — Envoyer un message en streaming
Envoie un message dans une conversation existante ; réponse en flux SSE. Un `agentId` optionnel change d'agent pour cette réponse et les suivantes.
Paramètre : `chatId` (path, uuid). Corps (requis) : [`ChatMessageRequestDto`](#chatmessagerequestdto). Réponse `200` : `text/event-stream`.

#### `PATCH /chats/{chatId}` — Mettre à jour un chat
Modifie le titre ou la visibilité. Corps (requis) : [`ChatUpdateDto`](#chatupdatedto). Réponse `200` : [`ChatDto`](#chatdto).

#### `DELETE /chats/{chatId}` — Supprimer un chat
Réponse `200` vide.

#### `GET /chats/{chatId}/stream` — Se rattacher au stream
Rouvre le flux SSE d'une génération en cours **sans relancer le modèle**.

| Paramètre | In | Type | Requis | Description |
|---|---|---|---|---|
| `chatId` | path | uuid | oui | |
| `Last-Event-ID` | header | string | non | Rejoue les événements d'id supérieur |
| `last_event_id` | query | int64 | non | Équivalent en paramètre de requête |

#### `POST /chats/{chatId}/stream/cancel` — Arrêter la génération
Annule la génération active, ferme les flux SSE et interrompt l'appel au fournisseur. **Idempotent.** Réponse `200` vide.

#### `PATCH /chats/{chatId}/messages/{messageId}` — Éditer un message en forkant le chat
Crée une nouvelle conversation avec l'historique avant le message cible, démarre le stream du message de remplacement sur le fork et retourne le nouveau chat. Le flux se récupère via `GET /chats/{newChatId}/stream`.
Paramètres : `chatId`, `messageId` (path, uuid). Corps : [`ChatMessageEditDto`](#chatmessageeditdto). Réponse `200` : [`ChatDetailDto`](#chatdetaildto).

#### `GET /chats/{chatId}/context` — Occupation du contexte
Répartit les tokens du contexte de la prochaine requête par catégorie (prompt système, outils, règles, skills, MCP, conversation). Réponse `200` : [`ChatContextUsageDto`](#chatcontextusagedto).

#### `POST /chats/{chatId}/context` — Compacter le contexte
Fait résumer tout l'historique par le fournisseur (compaction à la demande). **Réservé au propriétaire.** Renvoie l'occupation après compaction (`measured=false` jusqu'au prochain tour).
Erreurs documentées : `409` si une réponse est en cours ou si le chat est vide, `422` si le modèle ne le permet pas.

#### `GET /chats/{chatId}/usage` — Usage d'un chat
Réponse `200` : [`ChatUsageDto`](#chatusagedto).

#### `PUT /chats/{chatId}/pins` · `DELETE /chats/{chatId}/pins`
Épingle / désépingle la conversation pour l'utilisateur courant. Réponse `200` vide.

#### `PUT /chats/{chatId}/archive`
Compresse les messages vers la Storagebox puis les retire d'Elasticsearch, en conservant le chat archivé.

#### `PUT /chats/{chatId}/restore`
Restaure les messages dans Elasticsearch et rend la conversation de nouveau active.

#### `GET /chats/{chatId}/archive/download`
Télécharge un fichier JSON (`application/json`, binaire) contenant uniquement les messages du chat archivé.

#### `GET /chats/archived`
Métadonnées des conversations archivées. Paramètres : `limit` (int32, défaut 20), `cursor_chat_id` (uuid). Réponse : [`ChatHistoryDto`](#chathistorydto).

#### `GET /chats/search`
Recherche par titre et contenu des messages. Paramètres : `query` (string, **requis**), `limit` (int32, défaut 20). Réponse : [`ChatHistoryDto`](#chathistorydto).

#### `GET /chats/agents`
Agents IA disponibles. Paramètre : `include-disabled` (boolean, défaut `false`). Réponse : tableau de [`ModelDto`](#modeldto).

### Streaming SSE (`ChatStreamEvent`)

Les endpoints `POST /chats/stream`, `POST /chats/{chatId}` et `GET /chats/{chatId}/stream` renvoient un flux **Server-Sent Events**.

Format d'un événement :

```
id: <entier incrémental propre au stream>
event: <type>
data: <JSON ChatStreamEvent, dont "type" == nom de l'événement>
```

- `id` sert à la **reprise** : `GET /chats/{chatId}/stream` avec `Last-Event-ID` (ou `?last_event_id=`) rejoue les événements d'id supérieur puis continue en direct.
- Le statut HTTP reste `200` une fois le flux ouvert : les erreurs arrivent sous forme d'événement `error`.
- Le flux se termine après un événement **terminal** : `completed`, `error` ou `cancelled`.
- Les types inconnus doivent être ignorés par le client (ajouts compatibles).

**Événements émis par le backend**

| Événement | Terminal | Contenu |
|---|---|---|
| `stream.open` | non | Génération acceptée (`chat_id`, `first_response_timeout_ms`) |
| `response.created` | non | Message utilisateur enregistré (`chat_id`, `user_message_id`, `chat`) |
| `chat.title` | non | Titre généré (peut arriver à tout moment avant la fin) |
| `tool-transcribeAudio.status` | non | Progression de la transcription audio |
| `completed` | **oui** | Génération terminée et persistée (`chat_id`, `message`) |
| `error` | **oui** | `code`, `message`, `retryable`, `origin` (`backend` / `upstream`) |
| `cancelled` | **oui** | Génération annulée par l'utilisateur |

**Événements relayés du fournisseur** (liste blanche) : `response.output_text.delta|done`, `response.content_part.added|done`, `response.output_item.added|done` (item discriminé sur `item.type` : `message`, `reasoning`, `function_call`, `mcp_call`, `mcp_list_tools`, `web_search_call`, `image_generation_call`), `response.function_call_arguments.delta|done`, `response.reasoning_summary_text.delta`, `response.web_search_call.in_progress|searching|completed`, `response.mcp_call.in_progress|completed|failed`, `response.mcp_call_arguments.done`, `response.completed` et `response.failed` (non terminaux : attendre `completed` ou `error`).

**Codes d'erreur stables** (`error.code`) : `CHAT_LOCKED`, `CHAT_DELETED`, `CHAT_ARCHIVED`, `CONTENT_POLICY_VIOLATION`, `MCP_TOO_MANY_TOOLS`, `UPSTREAM_UNREACHABLE`, `UPSTREAM_SERVER_ERROR`, `UPSTREAM_TIMEOUT`, `BACKEND_TIMEOUT`, `STREAM_LEASE_LOST`, `GENERATION_INTERRUPTED`, `STREAM_RELAY_UNAVAILABLE`, `STREAM_FAILED`, ou un code du fournisseur.

Exemple de flux :

```
id: 1
event: stream.open
data: {"type":"stream.open","chat_id":"11111111-1111-1111-1111-111111111111","first_response_timeout_ms":300000}

id: 2
event: response.created
data: {"type":"response.created","chat_id":"1111...","user_message_id":"2222...","chat":{"id":"1111...","title":"Nouvelle conversation","flags":1,"isPrivate":true,"isPinned":false,"isEphemeral":false,"agent":{},"tokenUsage":{}}}

id: 4
event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":1,"content_index":0,"delta":"Bonjour"}

: keepalive

id: 6
event: completed
data: {"type":"completed","chat_id":"1111...","message":{"id":"3333...","chatId":"1111...","role":"assistant","content":"Bonjour"}}
```

**Outils côté client** : `ChatCreateDto.clientTools` / `ChatMessageRequestDto.clientTools` déclarent des outils exécutés par le client (`list_directory`, `read_file`, `search_files`, `edit_file`, `write_file`, `run_command`). Le serveur renvoie alors des `toolCalls` (`ChatToolCallDto`) ; le client répond via `toolResults` (`ChatToolResultInputDto`, sortie tronquée au-delà de 40 000 caractères).

### Chat Shares

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/chats/{chatId}/shares` | Lister les partages (propriétaire + utilisateurs avec accès) |
| `POST` | `/chats/{chatId}/shares` | Ajouter un partage |
| `PATCH` | `/chats/{chatId}/shares` | Modifier un partage (cible dans le body) |
| `DELETE` | `/chats/{chatId}/shares` | Supprimer un partage (cible dans le body) |

- `GET` → tableau de [`ChatShareAccessDto`](#chatshareaccessdto).
- `POST` : corps [`ChatShareCreateDto`](#chatsharecreatedto) → `ChatShareAccessDto`.
- `PATCH` : corps [`ChatShareUpdateByTargetDto`](#chatshareupdatebytargetdto) → `ChatShareAccessDto`.
- `DELETE` : corps [`ChatShareTargetDto`](#chatsharetargetdto) → `200` vide.

### Chat Message Images

#### `GET /chats/{chatId}/messages/{messageId}/images/{imageId}`
Retourne le fichier image généré par l'IA après vérification de l'accès à la conversation. Paramètres `chatId`, `messageId`, `imageId` (path, uuid). Réponse `200` : binaire.

### Messages

#### `PATCH /messages/{messageId}` — Mettre à jour le vote d'un message
Enregistre le vote (upvote/downvote). Corps : [`VoteDto`](#votedto) (`isUpvoted` requis). Réponse : [`ChatMessageDto`](#chatmessagedto).

---

### OpenAI compatible API

#### `POST /v1/responses` — Créer une réponse (format OpenAI Responses)
Envoie le dernier message `user` de `input` dans un chat, comme `/chats/stream`.

- Sans `previous_response_id` : un nouveau chat est créé ; avec, la conversation correspondante continue (`404` si inconnue, étrangère ou verrouillée par PIN).
- `stream=true` renvoie les événements SSE au format OpenAI.
- Un outil dont le `type` commence par `web_search` active la recherche web ; **les autres paramètres sont ignorés** (instructions, temperature, max_output_tokens, outils personnalisés…).

Corps : [`OpenAIResponseCreateRequest`](#openairesponsecreaterequest).

Réponses `200` :
- `stream=false` : `application/json`, [`OpenAIResponse`](#openairesponse) final (`completed` ou `failed`). Un retour à la ligne est écrit après 15 s sans sortie (keepalive) : des espaces peuvent précéder le JSON.
- `stream=true` : `text/event-stream` d'[`OpenAIResponseStreamEvent`](#openairesponsestreamevent). Chaque événement est `event: <type>` puis `data: <json>` (pas de ligne `id:`, le flux n'est **pas reprenable**). Chaque payload contient `type` et `sequence_number` (0, 1, 2…). Ordre : `response.created`, `response.in_progress`, puis, si du texte est généré, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta` (répété), `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, et exactement un événement terminal : `response.completed` ou `response.failed`. Les lignes `:keepalive` sont à ignorer. Le raisonnement, les appels d'outils et la progression de la recherche web ne sont pas exposés.

#### `GET /v1/models` — Lister les modèles (format OpenAI)
Réponse : [`ModelListPageResponse`](#modellistpageresponse).

### Models

#### `GET /models` — Lister les modèles disponibles
Modèles actifs et visibles configurés en base ou dans `resources/models`, et service IA vers lequel ils sont routés. Réponse : [`ModelListPageResponse`](#modellistpageresponse).

---

### Projects

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/projects` | Lister mes projets |
| `POST` | `/projects` | Créer un projet |
| `GET` | `/projects/shared` | Projets partagés avec moi |
| `GET` | `/projects/{projectId}` | Récupérer un projet |
| `PATCH` | `/projects/{projectId}` | Modifier un projet |
| `DELETE` | `/projects/{projectId}` | Supprimer un projet |
| `GET` | `/projects/{projectId}/chats` | Lister les chats d'un projet |
| `PUT` | `/projects/{projectId}/chats/{chatId}` | Rattacher / déplacer un chat dans un projet |
| `DELETE` | `/projects/{projectId}/chats/{chatId}` | Retirer un chat d'un projet (sans le supprimer) |

- `GET /projects` → tableau de [`ProjectDto`](#projectdto). `POST /projects` : corps [`ProjectCreateDto`](#projectcreatedto) → `ProjectDto`.
- `GET /projects/shared` → tableau de `ProjectDto`.
- `PATCH /projects/{projectId}` : corps [`ProjectUpdateDto`](#projectupdatedto). `flags` (0 à 3) remplace `PUBLIC` (1) et `PINNED` (2) : `0` retire les deux, `3` active les deux. Les bits réservés sont refusés. Les projets `LIMITED_ACCESS` ou `POLICY_VIOLATION` ne peuvent pas être modifiés.
- `GET /projects/{projectId}/chats` : paramètres `limit` (int32, défaut 20), `cursor_chat_id` (uuid) → [`ChatHistoryDto`](#chathistorydto).
- `PUT /projects/{projectId}/chats/{chatId}` → [`ChatSummaryDto`](#chatsummarydto).

### Partage de projets (`project-share-controller`)

| Méthode | Chemin | Corps → Réponse |
|---|---|---|
| `GET` | `/projects/{projectId}/shares` | → tableau de [`ProjectShareAccessDto`](#projectshareaccessdto) |
| `POST` | `/projects/{projectId}/shares` | [`ProjectShareCreateDto`](#projectsharecreatedto) → `ProjectShareAccessDto` |
| `DELETE` | `/projects/{projectId}/shares/{targetUserId}` | `targetUserId` (path, int32) → `200` vide |

---

### Locked Chats

Les chats verrouillés sont protégés par un **code PIN à 4 chiffres**. Après vérification du PIN, un jeton d'accès temporaire est renvoyé et doit être envoyé dans l'en-tête `X-Locked-Chats-Access`.

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/locked-chats/status` | Indique si le PIN a été créé → [`LockedChatStatusDto`](#lockedchatstatusdto) |
| `POST` | `/locked-chats/pin` | Créer le PIN (corps [`LockedChatPinDto`](#lockedchatpindto)) → [`LockedChatAccessDto`](#lockedchataccessdto) |
| `PUT` | `/locked-chats/pin` | Changer le PIN (corps [`LockedChatPinChangeDto`](#lockedchatpinchangedto)) ; les chats verrouillés sont conservés |
| `DELETE` | `/locked-chats/pin` | Réinitialiser le PIN : **supprime définitivement tous les chats verrouillés** puis le PIN |
| `POST` | `/locked-chats/access` | Ouvrir l'accès (corps `LockedChatPinDto`) → `LockedChatAccessDto` |
| `DELETE` | `/locked-chats/access` | Verrouiller maintenant (révoque le jeton ; en-tête `X-Locked-Chats-Access` optionnel) |
| `GET` | `/locked-chats` | Lister les chats verrouillés (en-tête `X-Locked-Chats-Access` optionnel) → `ChatHistoryDto` |
| `PUT` | `/locked-chats/chats/{chatId}` | Verrouiller un chat (il quitte son projet et n'est plus épinglé) |
| `DELETE` | `/locked-chats/chats/{chatId}` | Déverrouiller définitivement un chat (retour dans l'historique normal) |

Pour `PUT`/`DELETE /locked-chats/chats/{chatId}` : `chatId` (path, uuid) et `X-Locked-Chats-Access` (header, optionnel).

---

### Files

API historique de fichiers (remplacée progressivement par Files v2).

| Méthode | Chemin | Résumé |
|---|---|---|
| `POST` | `/files/upload` | Uploader un fichier (`multipart/form-data`, champ `file`) → [`FileUploadResponseDto`](#fileuploadresponsedto) |
| `GET` | `/files` | Lister mes fichiers → tableau d'UUID |
| `GET` | `/files/{fileId}` | Récupérer un fichier → [`FileContentResponseDto`](#filecontentresponsedto) |
| `DELETE` | `/files/{fileId}` | Supprimer un fichier |

### Files v2

Format proche de l'API Files d'OpenAI.

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/filesv2` | Lister les fichiers → [`FilesV2ListResponseDto`](#filesv2listresponsedto) |
| `POST` | `/filesv2` | Uploader un fichier → [`FileObject`](#fileobject) |
| `GET` | `/filesv2/{file_id}` | Récupérer un fichier → `FileObject` |
| `DELETE` | `/filesv2/{file_id}` | Supprimer un fichier → [`FileDeleted`](#filedeleted) |
| `GET` | `/filesv2/{file_id}/content` | Récupérer le contenu (`string`, format `byte`) |
| `GET` | `/filesv2/usage` | Usage du stockage → [`FilesV2UsageDto`](#filesv2usagedto) |
| `GET` | `/filesv2/supported-mime-types` | Types MIME supportés → tableau de `string` |
| `GET` | `/filesv2/legacy-migration` | Statut de la migration des anciens fichiers → [`FilesV2MigrationDto`](#filesv2migrationdto) |
| `POST` | `/filesv2/legacy-migration` | Migrer les anciens `/files` (images) vers Files v2 |

- `GET /filesv2` : paramètres `after`, `limit` (int64), `order`, `purpose` (query, tous optionnels).
- `POST /filesv2` : `multipart/form-data` avec `file` (binaire, **requis**) ; paramètres optionnels `expires_after[anchor]` (string) et `expires_after[seconds]` (int64).
- `POST /filesv2/legacy-migration` : ferme l'ancienne API pour l'utilisateur, **idempotent et reprenable** ; `409` si le quota Files v2 est dépassé.

---

### Skills

Skills « locaux » (versionnés, partageables). Les schémas de réponse sont des enveloppes à la OpenAI/Anthropic (`data`, `first_id`, `last_id`, `has_more`, `object`).

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/skills` | Lister les skills locaux |
| `POST` | `/skills` | Créer un skill local (`multipart/form-data`, `files[]` binaires, requis) |
| `GET` | `/skills/shared` | Lister les skills partagés avec moi (param. `query`) |
| `GET` | `/skills/{skillId}` | Récupérer un skill (possédé ou partagé) |
| `POST` | `/skills/{skillId}` | Modifier version par défaut, flags ou activation (corps [`SkillUpdateDto`](#skillupdatedto)) |
| `DELETE` | `/skills/{skillId}` | Supprimer un skill → [`DeletedSkill`](#deletedskill) |
| `GET` | `/skills/{skillId}/content` | Télécharger le ZIP du skill |
| `GET` | `/skills/{skillId}/versions` | Lister les versions → [`SkillVersionList`](#skillversionlist) |
| `POST` | `/skills/{skillId}/versions` | Créer une version **immuable** (`multipart/form-data`, `files[]`, requis ; param. `default` boolean) |
| `DELETE` | `/skills/{skillId}/versions/{version}` | Supprimer une version → [`DeletedSkillVersion`](#deletedskillversion) |
| `GET` | `/skills/{skillId}/versions/{version}/content` | Télécharger le ZIP d'une version |
| `GET` | `/skills/{skillId}/shares` | Lister les partages → tableau de [`SkillShareAccessDto`](#skillshareaccessdto) |
| `POST` | `/skills/{skillId}/shares` | Partager avec un utilisateur (**10 maximum**) ; corps [`SkillShareCreateDto`](#skillsharecreatedto) |
| `DELETE` | `/skills/{skillId}/shares/{targetUserId}` | Retirer un partage (`targetUserId` int32) |
| `POST` | `/skills/shared/{skillId}` | Activer/désactiver dans le chat un skill partagé (corps [`SkillSharedUpdateDto`](#skillsharedupdatedto)) |
| `DELETE` | `/skills/shared/{skillId}` | Retirer un skill partagé de ma liste |

Paramètres de `GET /skills` (query, optionnels) : `after`, `limit` (int64), `order`, `query`, `flag`, `flags` (tableau de string), `flags_bitfield` (int32). `POST /skills` accepte aussi `flags` (tableau de string).
`GET /skills/{skillId}/versions` : `after`, `limit` (int64), `order`.

---

### MCP Servers

Serveurs MCP (Model Context Protocol) configurés par l'utilisateur.

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/mcp/servers` | Lister mes serveurs → [`McpServerListDto`](#mcpserverlistdto) |
| `POST` | `/mcp/servers` | Ajouter un serveur (corps [`McpServerCreateDto`](#mcpservercreatedto)) → [`McpServerDto`](#mcpserverdto) |
| `POST` | `/mcp/servers/{serverId}` | Modifier un serveur (corps [`McpServerUpdateDto`](#mcpserverupdatedto)) → `McpServerDto` |
| `DELETE` | `/mcp/servers/{serverId}` | Supprimer un serveur → [`McpServerDeletedDto`](#mcpserverdeleteddto) |
| `POST` | `/mcp/servers/{serverId}/oauth/start` | Démarrer l'autorisation OAuth → [`McpOAuthStartDto`](#mcpoauthstartdto) |
| `POST` | `/mcp/servers/oauth/complete` | Terminer l'autorisation OAuth (corps [`McpOAuthCompleteDto`](#mcpoauthcompletedto)) → `McpServerDto` |

---

### DeskDock

PC virtuel de l'utilisateur, couplé à un serveur MCP.

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/deskdock` | Récupérer le PC virtuel → [`DeskDockDto`](#deskdockdto) |
| `POST` | `/deskdock` | Créer le PC virtuel et son serveur MCP |
| `DELETE` | `/deskdock` | Supprimer le PC virtuel, ses fichiers et son serveur MCP |
| `POST` | `/deskdock/start` | Démarrer le PC virtuel |
| `POST` | `/deskdock/stop` | Arrêter le PC virtuel (**fichiers conservés**) |

### Conversation imports

#### `POST /conversation-imports/openai` — Importer une conversation OpenAI partagée
Importe une conversation publique ChatGPT depuis un lien `/share/{uuid}` dans le modèle local demandé.
Corps : [`ConversationImportRequestDto`](#conversationimportrequestdto) → [`ConversationImportResponseDto`](#conversationimportresponsedto).

---

### Users

| Méthode | Chemin | Résumé |
|---|---|---|
| `PATCH` | `/user/@me` | Mettre à jour mon profil (mise à jour partielle ; champs absents ou `null` inchangés) |
| `GET` / `PATCH` | `/user/instructions` | Instructions personnalisées, niveau de raisonnement, modèle par défaut, options |
| `GET` / `PATCH` | `/user/notification-preferences` | Préférences de notifications |
| `GET` | `/user/usage` | Usage des rate limits, power-up et budget chat |
| `GET` | `/user/tokenusage` | Usage de tokens (param. `tokenUsageDays`, 1 à 366, défaut 343) |
| `GET` | `/user/rate-limit-credits` | Crédits de rate limit disponibles |
| `POST` | `/user/rate-limit-credits/activate` | Activer un power-up : consomme un crédit, double les limites pendant 7 jours |
| `GET` | `/user/sessions` | Lister mes sessions actives |
| `DELETE` | `/user/sessions` | Terminer toutes mes sessions |
| `DELETE` | `/user/sessions/{sessionId}` | Terminer une session |
| `GET` | `/user/pets` | Valeurs acceptées pour le champ `pets` |
| `GET` | `/user/flags` | Flags utilisateur disponibles |
| `POST` | `/user/register-beta` · `/user/unregister-beta` | Ajouter / retirer le flag `BETA_TESTER` |
| `POST` | `/user/register-active-developer` · `/user/unregister-active-developer` | Ajouter / retirer le flag `ACTIVE_DEVELOPER` |
| `POST` | `/user/invite` | Inviter une personne par email |
| `GET` | `/user/push/vapid-public-key` | Clé publique VAPID (Web Push) |
| `POST` | `/user/push/subscriptions` | Enregistrer / mettre à jour la subscription Web Push de l'appareil |
| `DELETE` | `/user/push/subscriptions` | Supprimer la subscription Web Push |
| `GET` | `/user/@me/memories` | Lister mes mémoires (sans contenu) |
| `DELETE` | `/user/@me/memories` | Supprimer toutes mes mémoires (définitif) |
| `GET` | `/user/@me/memories/{memoryId}` | Lire une mémoire |
| `DELETE` | `/user/@me/memories/{memoryId}` | Supprimer une mémoire |

Détails et schémas :

- `PATCH /user/@me` : corps [`UserUpdateDto`](#userupdatedto) → [`UserDto`](#userdto). Met à jour nom, `pets`, `theme`, langues d'interface et de reconnaissance vocale, date du dernier changelog vu et flags modifiables.
- `GET /user/instructions` → [`UserPersonalizationDto`](#userpersonalizationdto) ; `PATCH` : corps [`UserPersonalizationUpdateDto`](#userpersonalizationupdatedto). `documentToolsEnabled` (actif par défaut) active/désactive ensemble les outils `createDocument`, `editDocument`, `updateDocument` et `requestSuggestions`.
- `GET`/`PATCH /user/notification-preferences` : [`NotificationPreferencesDto`](#notificationpreferencesdto).
- `GET /user/usage` → [`UserUsageDto`](#userusagedto) ; `GET /user/tokenusage` → [`UserTokenUsageDto`](#usertokenusagedto) ; `GET /user/rate-limit-credits` → [`RateLimitCreditsDto`](#ratelimitcreditsdto) ; activation → [`RateLimitPowerUpDto`](#ratelimitpowerupdto).
- `GET /user/sessions` → tableau de [`UserSessionDto`](#usersessiondto).
- `GET /user/flags` → tableau de [`UserFlagDto`](#userflagdto).
- Les endpoints `register-*` / `unregister-*` renvoient [`UserDto`](#userdto).
- `POST /user/invite` : corps [`UserInviteRequestDto`](#userinviterequestdto) → [`UserReferralInviteDto`](#userreferralinvitedto). Envoi via Resend. **Limite : 5 invitations sur 30 jours par utilisateur**, avec un **délai de 7 jours** avant de réinviter le même email.
- `POST /user/push/subscriptions` : corps [`PushSubscriptionUpsertRequestDto`](#pushsubscriptionupsertrequestdto) → `PushSubscriptionUpsertResponseDto` ; `DELETE` : corps `PushSubscriptionDeleteRequestDto` → `PushSubscriptionDeleteResponseDto`.
- `GET /user/push/vapid-public-key` → [`VapidPublicKeyResponseDto`](#vapidpublickeyresponsedto).
- Mémoires : [`UserMemoriesDto`](#usermemoriesdto) (liste) et [`UserMemoryContentDto`](#usermemorycontentdto) (contenu).

### API Key

Une seule clé par utilisateur.

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/user/@me/api-key` | Consulter ma clé : clé masquée et usage du budget API sur 30 jours (remis à 0 $ à l'expiration) |
| `POST` | `/user/@me/api-key` | Générer ma clé : remplace l'éventuelle clé existante ; **la clé en clair n'est renvoyée qu'une fois** ; le budget en cours est conservé |
| `DELETE` | `/user/@me/api-key` | Révoquer ma clé (idempotent) |

Réponse (GET/POST) : [`ApiKeyDto`](#apikeydto).

### Passkeys

Tous les endpoints `POST` ci-dessous exigent l'en-tête **`Origin`** (string, requis).

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/user/passkeys` | Lister mes passkeys → tableau de [`PasskeyDto`](#passkeydto) |
| `POST` | `/user/passkeys/registration/options` | Commencer l'enregistrement → [`PasskeyChallengeDto`](#passkeychallengedto) |
| `POST` | `/user/passkeys/registration/finish` | Terminer l'enregistrement (corps [`PasskeyFinishDto`](#passkeyfinishdto)) → `PasskeyDto` |
| `POST` | `/user/passkeys/verification/options` | Commencer une vérification → `PasskeyChallengeDto` |
| `POST` | `/user/passkeys/verification/finish` | Vérifier et accorder une preuve de **5 minutes** à la session (complète aussi le second facteur staff) → [`PasskeyVerificationDto`](#passkeyverificationdto) |
| `GET` | `/user/passkeys/verification` | Date d'expiration de ma vérification → `PasskeyVerificationDto` |
| `GET` | `/user/passkeys/admin-verification` | État de la preuve admin de la session (`verifiedUntil` = limite absolue, `idleUntil` = limite d'inactivité, `null` si expirée) → [`PasskeyAdminVerificationDto`](#passkeyadminverificationdto) |
| `POST` | `/user/passkeys/admin-verification/activity` | Signaler une activité staff et prolonger la preuve (repousse `idleUntil` sans dépasser `verifiedUntil` ; une preuve expirée n'est jamais prolongée) |
| `PATCH` | `/user/passkeys/{id}` | Renommer une passkey (corps [`PasskeyRenameDto`](#passkeyrenamedto)) → `PasskeyDto` |
| `DELETE` | `/user/passkeys/{id}` | Supprimer une passkey |

### Saved Messages

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/user/@me/saved-messages` | Lister (pagination par curseur : `limit` défaut 20, `cursor`) → [`SavedMessagesPageDto`](#savedmessagespagedto) |
| `PUT` | `/user/@me/saved-messages/{chatId}/{messageId}` | Sauvegarder un message → [`SavedMessageDto`](#savedmessagedto) |
| `DELETE` | `/user/@me/saved-messages/{chatId}/{messageId}` | Retirer un message sauvegardé |

### Surveys

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/user/@me/survey` | Survey actif de l'utilisateur, s'il existe. Paramètres : `disable_auto_seen` (boolean, défaut `false`), `survey_override` (uuid) → [`UserSurveyResponseDto`](#usersurveyresponsedto) |
| `POST` | `/user/@me/survey/{surveyId}/seen` | Marquer un survey comme vu (réponse vide) |

### Feedback Experiences

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/user/@me/feedback-experiences/{experienceId}` | État d'une experience pour l'utilisateur (UUID codé en dur côté client) → [`FeedbackExperienceResponseDto`](#feedbackexperienceresponsedto) |
| `POST` | `/user/@me/feedback-experiences/{experienceId}/responses` | Sauvegarder `rating` et/ou `doNotShowAgain` (corps optionnel [`FeedbackExperienceSaveDto`](#feedbackexperiencesavedto)) |

### Recherche web (`user-web-search-controller`)

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/user/web-search-domains` | Consulter mon filtre de recherche web → [`UserWebSearchDomainsDto`](#userwebsearchdomainsdto) |
| `PUT` | `/user/web-search-domains` | Remplacer mes listes de domaines et choisir la liste active (corps `UserWebSearchDomainsDto`) |
| `GET` | `/user/web-search-domains/audit-log` | Historique : une entrée par message, avec les domaines et appels web. Trié du plus récent au plus ancien, pagination par curseur. Paramètres : `limit` (int32, défaut 20), `cursor`, `domain` (filtre exact) → [`WebSearchAuditPageDto`](#websearchauditpagedto) |

---

### Safety Hub

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/safety-hub/@me` | Safety Hub de l'utilisateur courant → [`SafetyHubDto`](#safetyhubdto) |
| `PUT` | `/safety-hub/request-review/{classificationId}` | Faire appel d'une classification de sécurité. Corps [`SafetyAppealRequestDto`](#safetyappealrequestdto) → [`SafetyAppealResponseDto`](#safetyappealresponsedto) |

### Patch Notes

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/patch-notes` | Identifiants (`<année>/<mois>/<nom>`) de toutes les patch notes, du plus récent au plus ancien → tableau de `string` |
| `GET` | `/patch-notes/{year}/{month}/{name}` | Titre et contenu en français et en anglais, ex. `GET /patch-notes/2026/10/api-keys` → [`PatchNoteDto`](#patchnotedto) |

### Public et Data export

Endpoints sans authentification.

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/public/health` | État de santé de l'application, de la base de données et de Redis → [`PublicHealthDto`](#publichealthdto) |
| `GET` | `/public/alerts` | Alertes publiques actives à afficher côté client → [`PublicAlertsDto`](#publicalertsdto) |
| `GET` | `/public/data-export/download` | Télécharger un export de données (ZIP) avec un jeton à usage unique. Paramètre : `token` (query) |

### Metrics

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/metrics` | Métriques applicatives au format texte **Prometheus** |
| `GET` | `/metrics/chat-streams` | Impact de la limite de streams (état global, admissions/refus cumulés, utilisateurs distincts sur 5 min / 1 h / 24 h). **Réservé au staff** → [`ChatStreamLimitMetricsDto`](#chatstreamlimitmetricsdto) |

### Divers

| Méthode | Chemin | Résumé |
|---|---|---|
| `GET` | `/` | Page d'accueil de l'API (objet `string → string`) |
| `GET` | `/auth/staff` | Vérifie l'accès staff (cookie `next-auth.session-token`, optionnel) |
| `POST` | `/ads/challenges/{challengeId}/complete` | Compléter un challenge publicitaire (`challengeId` uuid) → [`AdChallengeCompleteResponse`](#adchallengecompleteresponse) |
| `GET` `PUT` `POST` `DELETE` `OPTIONS` `HEAD` `PATCH` | `/error` | Endpoint d'erreur par défaut (objet libre) |

---

## 5. Schémas

Les types sont ceux de la spécification. `*` = champ requis. Les formats `uuid`, `date-time`, `int32`, `int64`, `double` suivent OpenAPI.

### Chats et messages

#### ChatCreateDto
| Champ | Type | Description |
|---|---|---|
| `agentId`* | int32 | Agent/modèle à utiliser |
| `chatId` | uuid | |
| `initialContent` | string | Premier message |
| `images` | uuid[] | |
| `files` | string[] | |
| `enableWebSearch` | boolean | |
| `projectId` | uuid | Projet de rattachement |
| `clientTools` | string[] | Outils exécutés côté client |

#### ChatMessageRequestDto
`content` (string), `images` (uuid[]), `files` (string[]), `enableWebSearch` (boolean), `agentId` (int32), `clientTools` (string[]), `toolResults` ([`ChatToolResultInputDto`](#chattoolresultinputdto)[]).

#### ChatToolResultInputDto
`callId`* (string, id de l'appel en attente), `output` (string, tronqué au-delà de 40 000 caractères), `isError` (boolean).

#### ChatMessageEditDto
`content`* (string, minLength 1).

#### ChatUpdateDto
`title` (string), `isPrivate` (boolean).

#### ChatMessageDto
`id` (uuid), `chatId` (uuid), `userId` (int32), `agentId` (int32), `model`, `modelProvider`, `role`, `content` (string), `createdAt` (date-time), `isUpvoted` (boolean), `webSearchDomains` (string[]), `tokenUsage` ([`TokenUsage`](#tokenusage)), `usedFileIds` (uuid[]), `usedFilesV2Ids` (string[]), `parts` (JSON libre), `toolCalls` ([`ChatToolCallDto`](#chattoolcalldto)[]), `toolResults` ([`ChatToolResultDto`](#chattoolresultdto)[]).

#### ChatToolCallDto
Appel d'outil client en attente de résultat : `callId`, `name` (parmi `list_directory`, `read_file`, `search_files`, `edit_file`, `write_file`, `run_command`), `arguments` (objet JSON).

#### ChatToolResultDto
`callId`, `name`, `output` (string), `isError` (boolean).

#### ChatDetailDto
`id` (uuid), `projectId` (uuid), `title`, `flags` (int32), `createdAt`, `agent` (`{ id: int32 }`), `chatMessages` (`ChatMessageDto[]`), `lastMessageAt`.

#### ChatDto
`id`, `title`, `flags`, `createdAt`, `agentId`, `model`, `modelProvider`, `userId`, `projectId`, `lastMessageAt`, `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `reasoningTokenCount`, `remoteConversationId`, `remoteLastResponseId`, `agent` ([`ModelDefinition`](#modeldefinition)), `user` ([`User`](#user)), `chatMessages`, `tokenUsage`, `chatFlags` (enum[] : `PRIVATE`, `PINNED`, `EPHEMERAL`, `API`, `DELETED`, `FORK`, `IMPORTED`, `ARCHIVED`, `FLAGGED`, `LOCKED`), et les booléens `isEphemeral`, `isApi`, `isDeleted`, `isArchived`, `isPrivate`, `isPinned`.

#### ChatSummaryDto
`id`, `projectId`, `title`, `flags`, `isPrivate`, `isPinned`, `createdAt`, `agent` (`ModelDefinition`), `lastMessageAt`, `tokenUsage`, `sharePermissionFlags` (int32).

#### ChatHistoryDto
`chats` (`ChatSummaryDto[]`), `hasMore` (boolean).

#### ChatUsageDto
`tokenUsage` (`TokenUsage`), `contextUsagePercent` (int32).

#### ChatContextUsageDto
Occupation du contexte du modèle pour la prochaine requête.
| Champ | Type | Description |
|---|---|---|
| `model` | string | Id du modèle (ex. `claude-opus-5-5`) |
| `modelName` | string | Nom affiché |
| `contextWindow` | int32 | Taille du contexte, `null` si inconnue |
| `usedTokens` | int32 | Somme des catégories |
| `freeTokens` | int32 | Tokens libres, `null` si taille inconnue |
| `usagePercent` | double | Pourcentage occupé (1 décimale) |
| `compactThreshold` | int32 | Seuil de compaction, `null` sans compaction |
| `measured` | boolean | `true` si mesuré par le fournisseur au dernier tour ; `false` si estimé |
| `categories` | `Category[]` | Répartition (toujours dans le même ordre, catégories vides incluses) |

`Category` : `key` (enum `system_prompt`, `tools`, `rules`, `skills`, `mcp`, `conversation`), `tokens` (int32).

#### TokenUsage
`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `reasoningTokenCount` (tous int32).

#### VoteDto
`isUpvoted`* (boolean).

#### ChatShareCreateDto
`permission`* (enum `View` | `Write`), `userId` (int32), `userEmail` (string).

#### ChatShareUpdateByTargetDto
`permission`* (enum `View` | `Write`), `userId` (int32), `userEmail` (string).

#### ChatShareTargetDto
`userId` (int32), `userEmail` (string).

#### ChatShareAccessDto
`userId` (int32), `userEmail` (string), `permission` (`View` | `Write`), `owner` (boolean).

#### SavedMessageDto / SavedMessagesPageDto
`SavedMessageDto` : `id` (string), `chatId` (uuid), `messageId` (uuid), `savedAt` (date-time), `message` (`ChatMessageDto`).
`SavedMessagesPageDto` : `savedMessages` (`SavedMessageDto[]`), `hasMore`, `nextCursor`.

### Modèles

#### ModelDto / ModelDefinition
`id` (int32), `name`, `namespace`, `description`, `model`, `modelProvider`, `isActive` (boolean), `isDefault` (boolean), `contextWindow` (int32), `compactThreshold` (int32).

#### ModelListPageResponse
Enveloppe : `data`, `object`, `isValid` (boolean) — les champs `data` et `object` sont des valeurs JSON génériques (`JsonValue` / `KnownValue`) ; le contenu exact est de type liste de modèles OpenAI (`object: "list"`).

### Streaming de chat

#### ChatStreamEvent
Union discriminée sur `type` (= nom de l'événement SSE), voir [la section streaming](#streaming-sse-chatstreamevent). Schémas associés :

| Schéma | `type` | Champs principaux |
|---|---|---|
| `ChatStreamStreamOpen` | `stream.open` | `chat_id`*, `first_response_timeout_ms`* |
| `ChatStreamChatCreated` | `response.created` | `chat`*, `chat_id`, `user_message_id` |
| `ChatStreamChatTitle` | `chat.title` | `chat_id`*, `title`* |
| `ChatStreamCompleted` | `completed` | `chat_id`*, `message` (`ChatMessageDto`) |
| `ChatStreamCancelled` | `cancelled` | `chat_id`* |
| `ChatStreamError` | `error` | `code`*, `message`*, `retryable`*, `origin`, `chat_id`, `chat_flagged`, `account_disabled`, `safety_classification_id`, `timeout_ms`, `param` |
| `ChatStreamTranscribeAudioStatus` | `tool-transcribeAudio.status` | `file_id`, `filename`, `status` (`completed`, `uploading`, `submitted`, `processing`, `error`), `assembly_status`, `attempt`, `max_attempts`, `assembly_transcript_id`, `message` |
| `ChatStreamOutputTextDelta` / `Done` | `response.output_text.delta` / `.done` | `item_id`, `output_index`, `content_index`, `delta`* / `text` |
| `ChatStreamContentPartAdded` / `Done` | `response.content_part.added` / `.done` | `item_id`, `output_index`, `content_index`, `part` |
| `ChatStreamOutputItemAdded` / `Done` | `response.output_item.added` / `.done` | `output_index`, `item`* (`ChatStreamOutputItem`) |
| `ChatStreamFunctionCallArgumentsDelta` / `Done` | `response.function_call_arguments.delta` / `.done` | `item_id`, `output_index`, `delta`* / `arguments` |
| `ChatStreamReasoningSummaryTextDelta` | `response.reasoning_summary_text.delta` | `item_id`, `output_index`, `summary_index`, `delta`* |
| `ChatStreamWebSearchCall*` | `response.web_search_call.in_progress` / `.searching` / `.completed` | `item_id`, `output_index` |
| `ChatStreamMcpCall*` | `response.mcp_call.in_progress` / `.completed` / `.failed` | `item_id`, `output_index` |
| `ChatStreamMcpCallArgumentsDone` | `response.mcp_call_arguments.done` | `item_id`, `output_index`, `arguments` |
| `ChatStreamResponseCompleted` / `Failed` | `response.completed` / `response.failed` | `response` (`ChatStreamUpstreamResponse` : `id`, `status`, `error`) — **non terminaux** |

**ChatStreamOutputItem** (discriminé sur `type`) :
- `message` : `id`, `status` (`in_progress` | `completed`), `role` (`assistant`), `content` (parts `{type, text}`).
- `reasoning` : `id`*, `status`, `summary[]`, `content[]`.
- `function_call` : `id`, `call_id`, `name`, `arguments` (JSON en string), `status`.
- `mcp_call` : `id`*, `name`, `server_label`, `arguments`, `status` (`in_progress`, `completed`, `failed`), `output`, `error`.
- `mcp_list_tools` : `id`*, `server_label`, `tools[]` (`{name, description}`).
- `web_search_call` : `id`, `status` (`in_progress`, `searching`, `completed`, `failed`, `incomplete`), `action` (`type` = `search` | `open_page` | `find_in_page`, `query`, `queries[]`, `sources[]` `{url,title}`, `url`, `pattern`).
- `image_generation_call` : `id`*, `status` (`in_progress`, `generating`, `completed`, `failed`), `revised_prompt`, `result_available` (l'image est attachée au message final).

**ChatStreamChat** (snapshot) : `id`, `title`, `flags`*, `isPrivate`*, `isPinned`*, `isEphemeral`*, `createdAt`, `lastMessageAt`, `agent`* (`ChatStreamChatModel`), `tokenUsage`*.

### API compatible OpenAI

#### OpenAIResponseCreateRequest
| Champ | Type | Description |
|---|---|---|
| `model`* | string | Id du modèle (liste via `GET /v1/models`) ; le nom est aussi accepté. Ex. `gpt-5` |
| `input`* | string \| `OpenAIResponseInputMessage[]` | Seul le dernier message `user` est envoyé : l'historique est conservé côté serveur |
| `previous_response_id` | string \| null | Id (`resp_…`) pour continuer une conversation |
| `stream` | boolean (défaut `false`) | SSE ou JSON unique |
| `tools` | `OpenAIResponseTool[]` | Un `type` commençant par `web_search` active la recherche web ; les autres sont ignorés |

`OpenAIResponseInputMessage` : `role`* (seuls les `user` sont utilisés), `content`* (string ou liste de `{type: "input_text"|"text", text}`; les autres parties — images, fichiers — sont ignorées), `type` (défaut `message`).
`OpenAIResponseTool` : `type`* (ex. `web_search`, `web_search_preview`).

#### OpenAIResponse
| Champ | Type | Description |
|---|---|---|
| `id`* | string | `resp_` + id du chat ; à passer en `previous_response_id` |
| `object`* | `response` | |
| `created_at`* | int64 | Epoch en secondes |
| `status`* | `in_progress` \| `completed` \| `failed` | |
| `model`* | string | |
| `output`* | `OpenAIResponseMessageItem[]` | Vide si en cours ou en échec, sinon le message assistant |
| `error` | `{code, message}` | Si `failed` ; `code` = code d'erreur du stream, `cancelled` ou `server_error` |
| `usage` | `OpenAIResponseUsage` | Si `completed` |
| `incomplete_details` | null | Toujours `null` |
| `instructions` | null | Toujours `null` (instructions ignorées) |
| `metadata` | objet | Toujours vide |
| `parallel_tool_calls` | boolean | Toujours `false` |
| `previous_response_id` | string \| null | Repris de la requête |
| `store` | boolean | Toujours `true` (la conversation est stockée comme chat) |
| `tool_choice` | `auto` | Toujours `auto` |
| `tools` | [] | Toujours vide |

`OpenAIResponseMessageItem` : `type` (`message`), `id` (`msg_…`), `status`, `role` (`assistant`), `content` (un `output_text` `{type, text, annotations: []}`).
`OpenAIResponseUsage` : `input_tokens`, `input_tokens_details.cached_tokens` (toujours 0), `output_tokens`, `output_tokens_details.reasoning_tokens`, `total_tokens`.

#### OpenAIResponseStreamEvent
Union discriminée sur `type` : `response.created`, `response.in_progress` (champ `response`), `response.output_item.added` / `.done` (`output_index`, `item`), `response.content_part.added` / `.done` (`item_id`, `output_index`, `content_index`, `part`), `response.output_text.delta` (`delta`, `logprobs` toujours vide), `response.output_text.done` (`text`), `response.completed` / `response.failed` (`response`). Chaque événement porte `sequence_number`.

### Projets

#### ProjectCreateDto
`name`* (string, ≤ 255), `customInstructions` (string, ≤ 10 000).

#### ProjectUpdateDto
`name` (string, ≤ 255, non vide), `flags` (int32, 0 à 3), `customInstructions` (string, ≤ 10 000).

#### ProjectDto
`id` (uuid), `name`, `ownerId` (int32), `customInstructions`, `flags` (int32), `createdAt`.

#### ProjectShareCreateDto
`userEmail`* (string).

#### ProjectShareAccessDto
`userId` (int32), `userEmail`, `permission` (`View` | `Write`), `owner` (boolean).

### Chats verrouillés

- `LockedChatPinDto` : `pin` (string).
- `LockedChatPinChangeDto` : `currentPin`, `newPin`.
- `LockedChatAccessDto` : `accessToken` (string), `idleTimeoutSeconds` (int64).
- `LockedChatStatusDto` : `hasPin` (boolean).

### Fichiers

- `FileUploadResponseDto` : `uuid`, `pathname`, `contentType`, `url`.
- `FileContentResponseDto` : `uuid`, `pathname`, `contentType`, `base64Data`, `url`.
- `FileObject` : `id`*, `bytes`*, `created_at`*, `filename`*, `object`*, `purpose`*, `status`*, `expires_at`*, `status_details`*, `isValid`* — champs encapsulés (`JsonValue`/`KnownValue`) au format de l'objet File d'OpenAI.
- `FileDeleted` : `id`*, `deleted`*, `object`*, `isValid`*.
- `FilesV2ListResponseDto` : `object`, `data` (`FileObject[]`), `first_id`, `last_id`, `has_more`.
- `FilesV2UsageDto` : `filesBytes`/`filesGb`, `skillsBytes`/`skillsGb`, `usedBytes`/`usedGb`, `maxBytes`/`maxGb`, `remainingBytes`/`remainingGb`.
- `FilesV2MigrationDto` : `migrated` (boolean), `legacyFileCount`, `migratedCount`, `failedCount`.

### Skills

- `SkillUpdateDto` (champs en écriture seule) : `default_version` / `defaultVersion`, `flags`, `enabled`.
- `SkillShareCreateDto` : `userEmail`*.
- `SkillShareAccessDto` : `userId` (int32), `userEmail`, `owner` (boolean).
- `SkillSharedUpdateDto` : `enabled`.
- `SkillList` / `SkillVersionList` : `data`*, `first_id`*, `has_more`*, `last_id`*, `object`*, `isValid`*.
- `DeletedSkill` : `id`*, `deleted`*, `object`*, `isValid`*. `DeletedSkillVersion` : idem + `version`*.

### Serveurs MCP

#### McpServerCreateDto
| Champ | Type |
|---|---|
| `server_label`* | string (≤ 64) |
| `server_url`* | string (≤ 2048) |
| `server_description` | string (≤ 1000) |
| `auth_type` | string |
| `oauth_scopes` | string[] |
| `allowed_tools` | string[] |
| `require_approval` | string |
| `defer_loading` | boolean |
| `enabled` | boolean |
| `authorization` | string |
| `headers` | objet `string → string` |

#### McpServerUpdateDto
Mêmes champs que la création (tous optionnels) + `clear_authorization` (boolean) et `clear_headers` (boolean).

#### McpServerDto
`id`, `object`, `server_label`, `server_description`, `server_url`, `auth_type`, `oauth_status`, `oauth_scopes`, `allowed_tools`, `available_tools` (`McpToolDto[]` : `name`, `title`, `description`, `annotations`, `input_schema`), `require_approval`, `defer_loading`, `enabled`, `has_authorization`, `credential_header_names`, `managed_by`, `created_at`, `updated_at`.

#### Autres
- `McpServerListDto` : `object`, `data` (`McpServerDto[]`).
- `McpServerDeletedDto` : `id`, `object`, `deleted`.
- `McpOAuthStartDto` : `authorization_url`, `state`.
- `McpOAuthCompleteDto` : `code`*, `state`* (non vides).

### DeskDock et imports

- `DeskDockDto` : `id`, `object`, `state`, `mcp_server_id`, `vnc_url`, `vnc_password`, `last_activity_at`, `created_at`.
- `ConversationImportRequestDto` : `link`*, `model`* (non vides).
- `ConversationImportResponseDto` : `chatId` (uuid), `title`, `source`, `sourceConversationId`, `sourceModel`, `localModel`, `importedMessagesCount` (int32), `importedAt`.

### Utilisateurs

#### UserDto
`id` (int32), `name`, `email`, `avatar`, `providerAccountId`, `pets`, `theme`, `language`, `speechToTextLanguage`, `lastChangelogViewedAt`, `tokenUsage`.

#### UserUpdateDto
`name` (string, 2 à 100 caractères), `pets`, `theme`, `language`, `speechToTextLanguage`, `lastChangelogViewedAt`, `flags` (int32).

Valeurs d'énumération :

- `language` / `speechToTextLanguage` : `en`, `fr`
- `theme` : `light`, `gris`, `dark`, `gradien`, `graphite`, `aurora`, `synthwave`, `lagoon`, `ember`, `matcha`, `midnight`, `rose`, `citrus`, `ocean`, `dusk`, `obsidian`, `amethyst`, `spruce`, `ruby`, `cobalt`
- `pets` : `none`, `apupepe`, `claude-pixel`, `codix`, `dario`, `goblin-lp`, `luoxiaohei2d`, `mini-elon`, `mini-sama`, `bear`, `bunny`, `cat`, `deer`, `dino`, `fox`, `frog`, `hamster`, `hedgehog`, `koala`, `otter`, `owl`, `panda`, `penguin`, `pug`, `raccoon`, `redpanda`, `sheep`, `sloth`, `tiger`, `afro`, `astronaut`, `bald`, `ballerina`, `beard`, `builder`, `cap`, `chef`, `glasses`, `grandpa`, `granny`, `hijabi`, `kamran`, `nurse`, `pirate`, `scientist`, `sikh`, `skater`, `wizard`, `clockwork`, `crt`, `cube`, `drone`, `gearbot`, `knight`, `lantern`, `postbot`, `radio`, `rocket`, `scout`, `toaster`, `tv`, `lekkerelou`

#### User (modèle complet)
`id`, `name`, `email`, `providerAccountId`, `flags` (int32), `pets`, `theme`, `language`, `speechToTextLanguage`, `lastChangelogViewedAt`, `lastActiveAt`, `tokenUsage`, `userFlags` (ensemble d'enum : `STAFF`, `PARTNER`, `BUG_HUNTER_LEVEL_1`, `DISABLED`, `COLLABORATOR`, `SCHEDULED_FOR_DELETION`, `UNLIMITED_USE`, `MANAGE_SETTINGS`, `BETA_TESTER`, `AUTOMATION`, `INACTIVE`, `ACTIVE_DEVELOPER`, `FILES_V2_MIGRATED`).

#### UserPersonalizationDto / UserPersonalizationUpdateDto
| Champ | Type / valeurs |
|---|---|
| `gptReasoning` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `customInstructions` | string (≤ 10 000 en mise à jour) |
| `defaultModelId` | int32 |
| `adsFrequency` | `none`, `5min`, `15min`, `30min`, `1h`, `3h`, `12h`, `24h` |
| `memoryEnabled` | boolean |
| `imageGenerationModel` | `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2.6-sunburst`, `gpt-image-2.6-flare`, `gpt-image-2` |
| `webSearchMode` | `open`, `filtered`, `disabled` |
| `documentToolsEnabled` | boolean |
| `imageGenerationToolEnabled` | boolean |
| `sidebarPinnedItems` | tableau (≤ 32) d'enum : `import`, `projects`, `skills`, `oss`, `saved_messages`, `interview`, `mcp`, `suggestions` |
| `uxAnalyticsEnabled` | boolean |
| `crashReportEnabled` | boolean |

`UserPersonalizationUpdateDto` ajoute `resetSidebarPinnedItems` (boolean).

#### Autres schémas utilisateur
- `NotificationPreferencesDto` : `appUpdates`, `offersAndSubscriptions` (boolean).
- `UserInviteRequestDto` : `email`* (format email, non vide).
- `UserReferralInviteDto` : `id`, `inviterUserId`, `invitedEmail`, `status` (`PENDING`, `SENT`, `FAILED`, `ACCEPTED`), `createdAt`, `sentAt`, `acceptedAt`.
- `UserUsageDto` : `rateLimits` (`UserRateLimitUsageDto[]`), `rateLimitPowerUpActive`, `chatBudget` (`BudgetUsage`).
  - `UserRateLimitUsageDto` : `type`, `bucket`, `limit`, `used`, `remaining` (int64), `resetAt`, `usedPercent`, `remainingPercent` (double).
  - `BudgetUsage` : `usedPercent`, `remainingPercent`, `resetAt`, `accountingUncertain`.
- `UserTokenUsageDto` : `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `reasoningTokenCount`, `last7DaysTokenUsage` (`UserDailyTokenUsageDto[]` : `date`, `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`).
- `RateLimitCreditsDto` : `availableCount` (int64), `resets` (`RateLimitResetDto[]` : `id`, `grantedAt`, `expiresAt`, `durationDays`). `RateLimitPowerUpDto` : `active`, `expiresAt`.
- `UserSessionDto` : `id`, `since`, `os`, `location`, `lastActiveAt` (strings).
- `UserFlagDto` : `name`, `description`.
- `UserSurveyResponseDto` : `survey` (`UserSurveyDto` : `id`, `key`, `prompt`, `cta`, `url`).
- `UserMemoriesDto` : `count`, `totalSizeBytes`, `memories` (`UserMemoryDto` : `id`, `path`, `name`, `sizeBytes`, `createdAt`, `updatedAt`). `UserMemoryContentDto` : mêmes champs + `content`.
- `PushSubscriptionUpsertRequestDto` : `endpoint`* (≤ 4096), `keys`* (`{p256dh*, auth*}`), `expirationTime` (int64), `userAgent` (≤ 2048), `deviceLabel` (≤ 256). Réponse : `id`, `subscribed`.
- `PushSubscriptionDeleteRequestDto` : `endpoint`*. Réponse : `subscribed`.
- `VapidPublicKeyResponseDto` : `publicKey`.
- `ApiKeyDto` : `key` (en clair, uniquement à la génération), `maskedKey`, `createdAt`, `lastUsedAt`, `budget` (`ApiBudgetUsage` : `usedUsd`, `limitUsd`, `remainingUsd`, `resetAt`, `accountingUncertain`).
- `UserWebSearchDomainsDto` : `filterType`* (`allowlist` | `blocklist`), `allowedDomains`* (string[]), `blockedDomains`* (string[]).
- `WebSearchAuditPageDto` : `entries` (`{messageId, chatId, createdAt, domains[], calls}`), `hasMore`, `nextCursor`.
- `FeedbackExperienceSaveDto` : `rating` (`positive`, `neutral`, `negative`), `doNotShowAgain`. `FeedbackExperienceResponseDto` : `experience` (`{id, key, title, description}`), `state` (`{experienceId, seen, doNotShowAgain, rating, seenAt, respondedAt}`).

### Passkeys

- `PasskeyChallengeDto` : `requestId`, `options` (JSON, options WebAuthn).
- `PasskeyFinishDto` : `requestId`, `credential` (JSON).
- `PasskeyDto` : `id`, `name`, `rpId`, `createdAt`, `lastUsedAt`.
- `PasskeyRenameDto` : `name`.
- `PasskeyVerificationDto` : `verifiedUntil`.
- `PasskeyAdminVerificationDto` : `required`, `verifiedUntil`, `idleUntil`, `serverTime`.

### Safety Hub

- `SafetyHubDto` : `classifications` / `project_classifications` (`SafetyClassificationDto[]`), `account_standing` (`{state: 100|200|500}`), `is_appeal_eligible`, `username`.
- `SafetyClassificationDto` : `id`, `classification_type` (enum `1`, `100`, `200`, `300`, `400`, `500`, `1000`), `description`, `explainer_link`, `actions` (`SafetyActionDto[]` : `id`, `descriptions[]`, `action_type` ∈ `0,1,4,9,13,15,20`), `max_expiration_time`, `flagged_content` (`{type, id, content, attachments[]}`), `appeal_status` (`SafetyAppealDto`), `is_appeal_eligible`, `project_metadata` (`{id, name}`), `created_at`.
- `SafetyAppealDto` : `id`, `status` (`1`, `2`, `3`), `signal` (`0`..`3`), `user_input`, `created_at`, `reviewed_at`.
- `SafetyAppealRequestDto` : `signal`* (`0`, `1`, `2`, `3`), `user_input` (≤ 1000). `SafetyAppealResponseDto` : `appeal_id`.

### Divers

- `LocalizedTextDto` : `fr`*, `en`* (non vides).
- `PatchNoteDto` : `id`, `year`, `month`, `name`, `title` (`LocalizedTextDto`), `content` (`LocalizedTextDto`), `feedbackExperienceId`, `createdAt`, `updatedAt`.
- `PublicHealthDto` : `checkedAt`, `status`, `app`, `database`, `redis`, `webdav`, `jaeger` (chacun `Check` : `status`, `message`, `responseTimeMs`, `avgResponseTimeMs5m`, `samples5m`).
- `PublicAlertsDto` : `alerts` (`PublicAlertDto[]` : `id`, `type`, `severity`, `title`, `message`, `placements[]`, `dismissible`, `dismissalKey`, `updatedAt`).
- `ChatStreamLimitMetricsDto` : `limitPerUser`, `current` (`activeStreams`, `activeUsers`, `usersAtLimit`, `oldestAgeSeconds`, `phases`), `admission` (`trackedSince`, `generatedAt`, `admittedTotal`, `rejectedTotal`, `rejectionPercent`, `windows[]` : `windowSeconds`, `attemptingUsers`, `rejectedUsers`, `affectedUsersPercent`).
- `AdChallengeCompleteResponse` : `status`, `expiresAt`.
- `JsonNode` / `StreamingResponseBody` : types libres.

---

## 6. Exemples cURL

> Remplacez `<TOKEN>` par votre jeton de session ou clé API.

**Vérifier l'état de l'API (sans authentification)**

```bash
curl https://api.francestudent.org/public/health
```

**Lister les modèles (format OpenAI)**

```bash
curl https://api.francestudent.org/v1/models \
  -H "authorization: <TOKEN>"
```

**Créer un chat et streamer la réponse**

```bash
curl -N https://api.francestudent.org/chats/stream \
  -H "authorization: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": 1,
    "initialContent": "Bonjour !",
    "enableWebSearch": false
  }'
```

**Envoyer un message dans un chat existant**

```bash
curl -N https://api.francestudent.org/chats/11111111-1111-1111-1111-111111111111 \
  -H "authorization: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Résume ma dernière réponse."}'
```

**Reprendre un flux interrompu**

```bash
curl -N "https://api.francestudent.org/chats/11111111-1111-1111-1111-111111111111/stream?last_event_id=4" \
  -H "authorization: <TOKEN>"
```

**Réponse au format OpenAI Responses (non streamée, avec recherche web)**

```bash
curl https://api.francestudent.org/v1/responses \
  -H "authorization: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input": "Quelle est la capitale de la France ?",
    "tools": [{"type": "web_search"}]
  }'
```

**Continuer la conversation**

```bash
curl https://api.francestudent.org/v1/responses \
  -H "authorization: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input": "Et sa population ?",
    "previous_response_id": "resp_0f8e6c2b9d4a4e57a1c3b5d7e9f10234"
  }'
```

**Uploader un fichier (Files v2)**

```bash
curl https://api.francestudent.org/filesv2 \
  -H "authorization: <TOKEN>" \
  -F "file=@document.pdf"
```

**Générer une clé API**

```bash
curl -X POST https://api.francestudent.org/user/@me/api-key \
  -H "authorization: <TOKEN>"
```

**Ouvrir les chats verrouillés puis les lister**

```bash
ACCESS=$(curl -s -X POST https://api.francestudent.org/locked-chats/access \
  -H "authorization: <TOKEN>" -H "Content-Type: application/json" \
  -d '{"pin":"1234"}' | jq -r .accessToken)

curl https://api.francestudent.org/locked-chats \
  -H "authorization: <TOKEN>" \
  -H "X-Locked-Chats-Access: $ACCESS"
```

---

## Notes et limites de cette documentation

- Elle reflète strictement la spécification OpenAPI `v0` au moment de sa lecture ; les descriptions en français proviennent des `summary` / `description` de la spec.
- La spécification ne décrit **que les réponses `200`** : les codes d'erreur ne sont pas documentés (hors `404`, `409`, `422` cités ci-dessus et les événements `error` du streaming).
- Certains schémas sont des types génériques générés (`JsonValue`, `KnownValue`, `JsonFieldString`…) ; ils proviennent de l'encapsulation de types de SDK externes et ne détaillent pas la structure réelle (ex. `FileObject`, `ModelListPageResponse`, `SkillList`).
- Les noms d'agents/modèles valides s'obtiennent dynamiquement via `GET /chats/agents` et `GET /models`.
