# Outils client (« mode avancé »)

Permet à un client (IDE, CLI) de donner au modèle des outils qui s'exécutent **sur la machine de l'utilisateur** : le backend déclare les outils au modèle, transmet les appels au client et rejoue les résultats que le client renvoie. Le backend n'exécute jamais rien lui-même.

Remplace les « IDE » maison qui injectaient leurs propres protocoles d'outils dans le texte des messages (bloqués par le prompt système depuis `9371eaa5`).

- Flag Unleash : `2026_11_client_tools` (désactivé par défaut). Sans le flag : `403`.
- Modèles : OpenAI (Responses) et Claude. Gemini : `400 Client tools are not supported by this model.`

## Catalogue

Catalogue fixe, défini par le backend (`service/ai/clienttools/ClientToolCatalog`) :

| Outil | Arguments (JSON) |
|---|---|
| `list_directory` | `path` (requis, relatif à la racine du workspace), `depth` (1 à 3) |
| `read_file` | `path` (requis), `start_line`, `end_line` |
| `search_files` | `query` (requis, texte ou regex), `path`, `glob`, `max_results` |
| `edit_file` | `path`, `old_text`, `new_text` (requis), `replace_all` |
| `write_file` | `path`, `content` (requis) |
| `run_command` | `command` (requis), `cwd`, `timeout_seconds` |

Le client choisit ceux qu'il sait exécuter. Un nom inconnu donne `400`.

## Déroulé

### 1. Message avec outils

`POST /chats/stream` (nouveau chat) ou `POST /chats/{chatId}` :

```json
{ "agentId": 12, "initialContent": "Corrige le bug du login", "clientTools": ["list_directory", "read_file", "search_files", "edit_file", "run_command"] }
```

`clientTools` est aussi accepté sur `POST /chats/{chatId}` (champ `content` pour le texte).

### 2. Le modèle appelle un outil

Le stream relaie les événements habituels (`response.output_item.added|done` avec un item `function_call`, `response.function_call_arguments.delta|done`), puis se termine par `completed`. Le message assistant de `completed.message` porte les appels **à exécuter** :

```json
{
  "type": "completed",
  "chat_id": "…",
  "message": {
    "role": "assistant",
    "content": "Je regarde le fichier.",
    "toolCalls": [
      { "callId": "call_abc", "name": "read_file", "arguments": { "path": "src/login.ts", "start_line": 1, "end_line": 80 } }
    ]
  }
}
```

`toolCalls` n'apparaît que s'il y a des appels en attente. Ses éléments sont la seule source de vérité. Les `function_call` relayés pendant le stream concernent aussi les outils de la plateforme (météo, documents…), que le backend exécute lui-même. Le client ne doit exécuter que `completed.message.toolCalls`.

### 3. Le client renvoie les résultats

`POST /chats/{chatId}`, sans texte obligatoire :

```json
{
  "toolResults": [
    { "callId": "call_abc", "output": "1: import …\n2: …" },
    { "callId": "call_def", "output": "Commande refusée par l'utilisateur", "isError": true }
  ]
}
```

- Il faut répondre à **tous** les appels en attente, une seule fois chacun. Sinon : `400` (`missing: …`, `unknown: …`). Sans appel en attente : `409`.
- `output` est du texte. Un objet JSON est accepté et transmis en JSON. `isError: true` signale un échec ou un refus de l'utilisateur.
- `content` peut accompagner les résultats (« et ajoute un test »).
- Sans `clientTools`, la requête garde les outils du tour qui a fait les appels.
- `callId` / `isError` acceptent aussi `call_id` / `is_error`.

La génération reprend et peut appeler d'autres outils (retour à l'étape 2), jusqu'à une réponse sans `toolCalls`.

Si l'utilisateur envoie un message normal alors que des appels sont en attente, ces appels sont rejoués au modèle comme « non exécutés ». Rien n'est bloqué.

### Historique

`GET /chats/{chatId}` : un message assistant qui a appelé des outils client garde ses `toolCalls`, même une fois traités. Le message utilisateur qui y répond porte `toolResults` (`callId`, `name`, `output`, `isError`). Des appels sont donc en attente seulement si le dernier message du chat est un message assistant avec `toolCalls`. Les deux champs sont absents sur les autres messages, dont le JSON est inchangé.

## Limites et consommation

- Chaque envoi de résultats est **une requête de chat** : il compte dans la limite de messages par jour (`chat-budget.max-requests-per-day`) et dans le budget quotidien en dollars, comme les messages des anciens « IDE ». La limite de 50 nouveaux chats par jour s'applique aussi.
- Sortie d'un résultat : 40 000 caractères maximum. Total d'un envoi : 120 000. Au-delà, le texte est coupé et le modèle est prévenu (« lis une plage plus étroite »).
- 32 résultats au maximum par envoi.
- Les définitions d'outils sont stables et placées après les outils de la plateforme, pour garder le cache de prompt. Le prompt système demande au modèle d'être économe : chercher avant de lire, lire par plages, regrouper les appels.
- L'historique (appels, résultats, réflexion de Claude) est rejoué tel quel à chaque tour. La compaction existante des fournisseurs le résume quand il grossit.

## Sécurité

- Le backend n'exécute rien : c'est le client qui lance les commandes. **Le client doit demander une confirmation à l'utilisateur** avant `run_command`, `write_file` et `edit_file`, et limiter les chemins au workspace.
- Le contenu des fichiers lus peut contenir des instructions malveillantes (prompt injection) : le client ne doit pas exécuter de commande sans confirmation, même si le modèle insiste.

## Côté backend

- Stockage : `ChatMessageDocument.clientTools` (message utilisateur), `clientToolChainJson` (message assistant : appels en attente et éléments du fournisseur à rejouer tels quels), `clientToolResultsJson` (message utilisateur). Les champs sont ajoutés au mapping de `chat-messages-v1` au démarrage.
- Claude : la chaîne garde tout ce qui a été produit depuis le message utilisateur (blocs de réflexion signés compris), rejouée sans modification (« preserved thinking »). Tous les `tool_result` d'un tour, ceux des outils de la plateforme compris, sont envoyés en tête du message utilisateur suivant.
- Changement de modèle en cours de route : les appels et résultats produits par l'autre fournisseur sont rejoués sous forme de texte.
