# Contrat des outils locaux

Le client transmet les six noms dans `clientTools`. Les descriptions et schémas publics appartiennent au catalogue de la plateforme : ils ne sont pas redéfinis par les fonctions locales `describe()`, réservées à l'affichage. Le contexte initial complète ce catalogue avec les contraintes locales, dans le budget de 3 000 caractères du contexte court.

## Recherche

`search_files.query` est littéral et insensible à la casse par défaut. Pour une expression régulière, utiliser `regex:<motif>`. Pour chercher un texte commençant par un préfixe réservé, utiliser `literal:<texte>`. Cette convention évite d'ajouter un paramètre absent du catalogue public ; les anciennes requêtes implicitement interprétées comme regex doivent être adaptées.

Le plafond local est de 200 résultats, avec 50 par défaut et au plus 3 000 fichiers parcourus. Une sortie tronquée ne constitue pas une recherche exhaustive.

## Commandes

`run_command` utilise un analyseur interne, pas un shell généraliste. Le dossier par défaut est la racine du projet ; `cwd` s'applique à l'appel, sans terminal persistant. Les opérateurs `&&`, `||`, `;` et `|` sont gérés, avec huit segments au maximum. Les expansions de variables, substitutions et redirections vers des fichiers ne sont pas prises en charge. Le délai par défaut est de 120 secondes, au plus 600 secondes. Les confirmations restent contrôlées par le client.

## MCP

Découvrir les outils avec `mcp-call tools <serveur>`, puis consulter leur contrat avec `mcp-call describe <serveur> <outil>`. Une description longue est paginée sans suppression de son schéma : suivre la commande `--offset` indiquée, puis concaténer les portions avant d'interpréter le JSON. Il n'y a pas d'écriture implicite de fichier. La pagination suppose que la description du serveur reste stable entre les appels.

Les résultats textuels et les données structurées complémentaires sont conservés ensemble ; une répétition JSON identique est évitée. Les limites globales de sortie restent applicables et signalées. Les images et l'audio ne sont pas transmis au modèle par ce pont textuel ; aucune analyse visuelle ne doit être annoncée sur cette seule base.

## Profil

Les préférences explicites sont séparées des faits et des sujets fréquents. Les doublons sont regroupés sans additionner les poids et en conservant chaque provenance. Définir `FS_INCLUDE_LEARNED_TOPICS=0` avant de démarrer le client masque les sujets fréquents du prochain contexte initial sans supprimer les données enregistrées. Par défaut ils restent inclus. Ouvrir une nouvelle conversation pour prendre en compte un nouveau contexte.
