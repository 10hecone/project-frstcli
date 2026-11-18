# Serveurs MCP locaux

Le CLI (TUI et GUI) peut utiliser des serveurs [MCP](https://modelcontextprotocol.io) déclarés sur la machine : transports `stdio`, `http` (Streamable HTTP) et `sse`. Le service distant `/mcp/servers` décrit dans [sdkapi.md](sdkapi.md) n'est volontairement pas utilisé : tout se passe en local.

## Principe : une seule commande, `mcp-call`

L'API France Student accepte seulement six outils client, dans un ordre fixe (cache de prompt). Les outils MCP ne sont donc pas déclarés à l'API. Le modèle y accède par `run_command` avec une commande virtuelle, `mcp-call`. Ce n'est pas un binaire et elle n'est pas dans le `PATH` : le CLI l'exécute lui-même. Elle se lance seule, sans `&&`, `|` ni `;`.

Au premier message d'une conversation, le contexte court ajoute une ligne « MCP local : commande `mcp-call` » avec le nom des serveurs disponibles.

### Grammaire

```text
mcp-call [--help]
mcp-call list
mcp-call tools <serveur>
mcp-call describe <serveur> <outil>
mcp-call run <serveur> <outil> ['<json>' | --args-file <fichier>]
mcp-call resources <serveur>
mcp-call read <serveur> <uri>
mcp-call prompts <serveur>
mcp-call prompt <serveur> <nom> ['<json>' | --args-file <fichier>]
mcp-call <serveur> [<outil> ['<json>']]      # raccourci
```

- `--help` est accepté à chaque niveau.
- Le JSON forme un seul argument, entre apostrophes. La ligne fait 4 000 caractères au plus : au-delà, utiliser `--args-file` (fichier du projet, 1 Mo au plus, jamais hors du projet).
- Codes de sortie : `0` succès, `1` l'outil a renvoyé `isError`, `2` erreur d'usage, serveur inconnu ou erreur de protocole.
- Les noms de sous-commandes (`list`, `run`, `tools`…) sont réservés et ne peuvent pas servir de nom de serveur. Un nom valide respecte `^[A-Za-z0-9_-]{1,64}$`.

### Permissions

| Sous-commande | Confirmation |
| ------------- | ------------ |
| `--help`, `list`, `tools`, `describe`, `resources`, `prompts` | Non |
| `run`, `read`, `prompt` | Oui |

- La question affiche les arguments masqués (secrets retirés) et tronqués à 300 caractères, ainsi que les indications du serveur (`readOnlyHint`…) marquées « non vérifiées » : elles ne servent jamais à autoriser un appel.
- « Toujours » enregistre une règle dans `permissions.json` du projet, limitée à l'outil ou au prompt (`mcp-call run <serveur> <outil>`), ou au serveur pour `read`.
- `/mcp allow <serveur>` autorise tout un serveur. Une règle trop large (`mcp-call` ou `mcp-call run` seuls) est refusée.
- `/auto on` supprime les confirmations comme pour les autres commandes. En mode `/plan`, `run_command` n'est pas proposé, donc `mcp-call` non plus.

## Configuration

Format identique à celui de Claude Code :

```json
{
  "mcpServers": {
    "fichiers": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": { "LOG_LEVEL": "info" }
    },
    "docs": {
      "type": "http",
      "url": "https://exemple.org/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "timeout": 60000
    }
  }
}
```

### Portées (scopes)

| Portée | Fichier | Usage |
| ------ | ------- | ----- |
| `local` (défaut) | `~/.francestudent-cli/projects/<projet>/mcp.json` | Toi seul, ce projet |
| `project` | `<projet>/.mcp.json` | Partagé avec le dépôt |
| `user` | `~/.francestudent-cli/mcp.json` | Toi seul, tous les projets |

Précédence : `local` > `project` > `user`. Un serveur défini dans plusieurs portées n'est pas fusionné : la définition la plus prioritaire gagne.

### Variables

- `${VAR}` et `${VAR:-défaut}` sont développées dans `command`, `args`, `env`, `url` et `headers`. Une variable non définie, sans défaut, empêche le démarrage du serveur et l'erreur la nomme.
- Les variables `FS_*` ne sont jamais développées.
- L'environnement transmis à un serveur stdio est filtré : les variables `FS_*` et celles qui ressemblent à des secrets (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`…) sont retirées, sauf si elles sont déclarées dans `env`.
- Limites : 50 serveurs au plus, URL de 2 048 caractères au plus.

### Approbation de `.mcp.json`

Un `.mcp.json` vient du dépôt et peut lancer n'importe quel programme. Ses serveurs ne démarrent qu'après approbation. L'approbation porte sur une empreinte de la définition : si le serveur change, elle est redemandée. Les choix sont dans `~/.francestudent-cli/mcp-approvals.json` (droits 0600) ; `/mcp reset-project-choices` les efface pour le projet. Les serveurs désactivés sont listés dans `~/.francestudent-cli/mcp-disabled.json`.

## Commandes `/mcp`

Les mêmes commandes existent hors session : `frst mcp <commande>`.

| Commande | Rôle |
| -------- | ---- |
| `/mcp` ou `/mcp list` | Liste les serveurs, leur portée et leur état |
| `/mcp get <nom>` | Détail d'un serveur (secrets masqués) |
| `/mcp add <nom> [options] -- <commande> [args…]` | Ajoute un serveur stdio |
| `/mcp add --transport http\|sse <nom> <url>` | Ajoute un serveur distant |
| `/mcp add-json <nom> '<json>'` | Ajoute un serveur depuis sa définition JSON |
| `/mcp remove <nom> [--scope …]` | Supprime un serveur |
| `/mcp enable <nom>` / `/mcp disable <nom>` | Active ou désactive un serveur |
| `/mcp reconnect <nom\|all>` | Relance la connexion |
| `/mcp allow <serveur>` | Autorise tous les appels d'un serveur dans ce projet |
| `/mcp reset-project-choices` | Oublie les approbations de `.mcp.json` |
| `/mcp login <nom> [--client-id …] [--client-secret] [--callback-port …]` | Connexion OAuth |
| `/mcp logout <nom>` | Supprime les jetons OAuth |

Options de `add` : `--scope local|project|user`, `--env CLE=valeur`, `--header "Nom: valeur"`, `--transport stdio|http|sse`.

Aucun secret ne doit être tapé en clair : utiliser une référence `${VAR}`, ou omettre la valeur (`--env CLE`, `--header "Authorization"`, `--client-secret`) pour une saisie masquée.

Exemples :

```text
/mcp add fichiers -- npx -y @modelcontextprotocol/server-filesystem .
/mcp add --transport http --header "Authorization: Bearer ${DOCS_TOKEN}" docs https://exemple.org/mcp
/mcp add --scope project --env API_KEY meteo -- node serveurs/meteo.js
```

## OAuth

Pour les serveurs http et sse qui l'exigent : `/mcp login <nom>`. Le CLI utilise PKCE, l'enregistrement dynamique du client s'il est proposé, et un retour sur `127.0.0.1` (délai de 5 minutes). Une URL d'autorisation qui n'est pas en https est refusée. Les jetons sont rangés dans `~/.francestudent-cli/mcp-auth.json` (droits 0600), sous le nom du serveur et une empreinte de son URL. OAuth n'est pas utilisé si la configuration fournit déjà un en-tête `Authorization`.

## Fonctionnement

- Démarrage paresseux : un serveur n'est lancé qu'au premier appel. 8 connexions simultanées au plus.
- Arrêt après inactivité : 30 minutes pour stdio, 5 minutes pour http et sse. Tous les serveurs sont arrêtés à la sortie du CLI, à la fermeture de la GUI et au changement de dossier.
- Délais : démarrage `FS_MCP_TIMEOUT_MS` (30 s par défaut), appel `FS_MCP_TOOL_TIMEOUT_MS` (120 s par défaut, 10 min au plus). Le champ `timeout` d'un serveur remplace le délai d'appel.
- Reconnexion http et sse : 5 essais, attente doublée à partir de 1 s.
- Les notifications `list_changed` vident le cache des listes.
- La sortie renvoyée au modèle est limitée à 16 000 caractères, comme celle de `run_command`.
- Tout ce qui vient d'un serveur est une donnée non fiable : texte nettoyé (caractères de contrôle), plafonné, étiqueté comme provenant du serveur, secrets masqués.
- Bibliothèque : `@modelcontextprotocol/sdk` (v1, version épinglée).

## GUI

La vue « Serveurs MCP » de la barre d'activité liste les serveurs et permet de les activer ou désactiver, de les examiner, de s'y connecter (OAuth, ouverture du navigateur par le système) ou de les reconnecter. Rien d'autre : aucun canal IPC ne permet d'ajouter un serveur, de lire la configuration ou d'appeler un outil depuis le renderer. Les actions sont refusées pendant une réponse, aucun secret n'est affiché et les URL sont montrées sans paramètres. L'ajout se fait avec `/mcp add` ou `frst mcp add`.

## Code

| Fichier (`src/mcp/`) | Rôle |
| -------------------- | ---- |
| `config.js` | Lecture, validation et écriture des trois portées, développement des variables |
| `approvals.js` | Approbations des serveurs de `.mcp.json` (empreintes) |
| `disabled.js` | Serveurs désactivés |
| `client.js` | Connexion à un serveur (transports du SDK) |
| `manager.js` | Démarrage paresseux, limites, arrêt après inactivité, cache |
| `policy.js` | Grammaire de `mcp-call`, questions de confirmation, règles de permission |
| `call.js` | Exécution de `mcp-call` et mise en forme des résultats |
| `redact.js` | Masquage des secrets |
| `oauth.js` | Connexion OAuth et stockage des jetons |
| `cli.js` | Commandes `/mcp` et `frst mcp` |

`mcp-call` est branché dans `src/tools/command/index.js`. Côté GUI : `src/gui/mcp.js` (processus principal) et le panneau de `Sidebar.jsx`.

## Hors périmètre

WebSocket, `headersHelper`, plugins, `mcp serve` et `add-from-claude-desktop` ne sont pas pris en charge.
