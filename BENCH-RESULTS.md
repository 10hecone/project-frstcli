# Banc de consommation : avant / après les 7 optimisations

Date : 18 novembre 2026. Script : `scripts/bench-conso.js` (`npm run bench:conso`).

## Protocole

- Chaque session est un seul chat neuf qui enchaîne 6 tâches dans un git worktree jetable. Un bug est injecté dans `src/tools/command/output.js`. Les tâches :
  - `version` : lire la version du projet ;
  - `commit` : donner le dernier commit ;
  - `corriger` : corriger le test cassé ;
  - `lint` : ajouter un script `lint` ;
  - `chat-total` et `chat-unitaire` : deux questions sur `src/core/chat.js`.
- **Avant** : 3 sessions par modèle, commit `bd943c8`. Une première session Opus a servi de calibrage et n'est pas comptée.
- **Après** : 3 sessions par modèle, même commit, avec les 7 optimisations actives (`CONFIG.optim`, désactivables avec `FS_OPTIM=0`). Ces optimisations n'étaient pas encore commitées.
- Les sessions ont alterné Opus 5.5 (`-2001`) et Sonnet 5.5 (`-2003`).
- L'API ne renvoie pas les tokens (`reported = 0`). Le banc mesure donc :
  - **Requêtes** : nombre d'allers-retours avec l'API ;
  - **Car. envoyés** : caractères nouveaux envoyés (messages et résultats d'outils) ;
  - **Contexte cumulé** : somme, sur toutes les requêtes, de la taille estimée de la conversation à ce moment-là. C'est l'indicateur le plus proche du coût réel.
- Les chiffres sont des **moyennes sur 3 sessions**. Les fichiers bruts sont dans `bench-results/conso-*.json`.

## Résultats globaux (par session de 6 tâches)

| Modèle | Variante | Requêtes | Car. envoyés | Contexte cumulé (min–max) | Durée | Réussite |
|---|---|---:|---:|---:|---:|---:|
| Sonnet 5.5 | avant | 17,7 | 31 500 | 299 605 (230 953–336 694) | 60 s | 94 % (17/18) |
| Sonnet 5.5 | **après** | **16,0** | **23 639** | **239 680** (232 635–245 201) | 61 s | **100 %** (18/18) |
| | *écart* | *−9 %* | *−25,0 %* | *−20,0 %* | *≈ 0* | *+1 tâche* |
| Opus 5.5 | avant | 17,0 | 28 219 | 270 275 (241 858–317 125) | 76 s | 100 % |
| Opus 5.5 | **après** | **16,3** | **32 426** | **304 285** (165 056–477 900) | 89 s | 100 % |
| | *écart* | *−4 %* | *+14,9 %* | *+12,6 %* | *+17 %* | *=* |

Les médianes résistent mieux aux sessions extrêmes :

| Modèle | Car. envoyés avant → après | Contexte cumulé avant → après |
|---|---:|---:|
| Sonnet 5.5 | 35 520 → 24 101 (**−32,1 %**) | 331 169 → 241 204 (**−27,2 %**) |
| Opus 5.5 | 30 206 → 31 731 (+5,0 %) | 251 842 → 269 900 (+7,2 %) |

Détail par session :

| Modèle | Variante | Session 1 | Session 2 | Session 3 |
|---|---|---|---|---|
| Sonnet 5.5 | avant | 18 req., 36 009 car., 336 694 ctx | 19 req., 35 520 car., 331 169 ctx | 16 req., 22 972 car., 230 953 ctx |
| Sonnet 5.5 | après | 16 req., 22 616 car., 232 635 ctx | 16 req., 24 101 car., 241 204 ctx | 16 req., 24 201 car., 245 201 ctx |
| Opus 5.5 | avant | 18 req., 18 259 car., 251 842 ctx | 17 req., 30 206 car., 241 858 ctx | 16 req., 36 191 car., 317 125 ctx |
| Opus 5.5 | après | 18 req., 50 867 car., 477 900 ctx | 15 req., 14 680 car., **165 056 ctx** | 16 req., 31 731 car., 269 900 ctx |

## Résultats par tâche (moyennes)

### Sonnet 5.5

| Tâche | Req. avant → après | Car. envoyés avant → après | Contexte cumulé avant → après | Réussite avant → après |
|---|---:|---:|---:|---:|
| version | 2,0 → 2,0 | 4 853 → 5 779 (+19,1 %) | 7 430 → 8 749 (+17,8 %) | 3/3 → 3/3 |
| commit | 3,0 → 3,0 | 523 → 561 (+7,3 %) | 16 501 → 19 328 (+17,1 %) | 3/3 → 3/3 |
| corriger | 5,7 → 5,0 | 9 806 → 10 495 (+7,0 %) | 77 238 → 73 241 (−5,2 %) | 3/3 → 3/3 |
| lint | 3,0 → 2,0 | 11 873 → 726 (**−93,9 %**) | 64 691 → 39 957 (**−38,2 %**) | 3/3 → 3/3 |
| chat-total | 3,0 → 3,0 | 4 385 → 6 018 (+37,2 %) | 97 188 → 69 747 (**−28,2 %**) | 2/3 → 3/3 |
| chat-unitaire | 1,0 → 1,0 | 60 → 60 | 36 557 → 28 658 (**−21,6 %**) | 3/3 → 3/3 |

### Opus 5.5

| Tâche | Req. avant → après | Car. envoyés avant → après | Contexte cumulé avant → après | Réussite avant → après |
|---|---:|---:|---:|---:|
| version | 2,0 → 2,0 | 4 584 → 5 779 (+26,1 %) | 7 166 → 8 749 (+22,1 %) | 3/3 → 3/3 |
| commit | 2,0 → 2,0 | 296 → 299 (+1,0 %) | 10 252 → 12 724 (+24,1 %) | 3/3 → 3/3 |
| corriger | 5,7 → 5,7 | 7 584 → 10 749 (+41,7 %) | 66 062 → 72 173 (+9,3 %) | 3/3 → 3/3 |
| lint | 3,3 → 2,7 | 12 285 → 12 106 (−1,5 %) | 62 033 → 67 706 (+9,1 %) | 3/3 → 3/3 |
| chat-total | 3,0 → 3,0 | 3 409 → 3 433 (+0,7 %) | 90 836 → 104 388 (+14,9 %) | 3/3 → 3/3 |
| chat-unitaire | 1,0 → 1,0 | 60 → 60 | 33 926 → 38 546 (+13,6 %) | 3/3 → 3/3 |

## Comparaisons à séquence d'outils identique

Ces paires utilisent exactement les mêmes appels d'outils avant et après. Elles mesurent donc l'effet propre des optimisations, sans le bruit lié au comportement du modèle.

| Cas | Outils appelés | Avant | Après | Écart |
|---|---|---:|---:|---:|
| `version` (les 2 modèles) | read_file | 5 381 | 5 779 | **+398 (+7,4 %)** |
| `corriger`, Opus | run, search, read, edit, run | 4 239 | 4 383 | +144 (+3,4 %) |
| `corriger`, Sonnet | run, read, search, read, edit, run | 9 310 | 10 943 | +1 633 (+17,5 %) |
| `lint` sans exécution, Sonnet | search, edit | 358 | 709 | **+351 (+98 %)** |
| `commit`, Sonnet | run, run | 478 | 478 / 603 | 0 à +125 |

## Analyse

### 1. Le gain apparent vient surtout du comportement du modèle

La variable qui pèse le plus n'est pas une optimisation : c'est le choix du modèle de lancer ou non `npm run lint` pendant la tâche `lint`. Cette commande affiche les 474 lignes mal indentées du dépôt, soit **≈ 17 500 caractères** d'un coup. Cette sortie reste ensuite dans l'historique et elle est **renvoyée à chaque requête suivante** du même chat, ce qui gonfle le contexte cumulé de `chat-total` et `chat-unitaire`.

| | A lancé `npm run lint` |
|---|---:|
| Sonnet avant | 2 sessions sur 3 |
| Sonnet après | **0 sur 3** |
| Opus avant | 2 sur 3 |
| Opus après | 2 sur 3 |

- **Sonnet** : la baisse de 20 % du contexte cumulé (−27 % en médiane) s'explique presque entièrement par ce point. La seule session « avant » où Sonnet n'a pas lancé le lint (230 953) est au même niveau que les sessions « après » (232 635 à 245 201). La nouvelle consigne « regrouper les appels » a peut-être joué, mais 3 sessions ne suffisent pas à le prouver.
- **Opus** : la hausse moyenne (+12,6 %) vient d'**une seule session**. Le modèle y a lancé toute la suite de tests (`node --test test/*.test.js`, ≈ 19 000 caractères) en plus du test ciblé, puis `npm run lint`. Résultat : 477 900 de contexte cumulé. La meilleure session des 12 est aussi une session Opus « après » (165 056), sans aucune de ces deux commandes. En médiane, Opus fait +7 %, dans le bruit d'environ ±20 % mesuré au calibrage.

### 2. Effet propre des optimisations : un léger surcoût sur ce banc

Les comparaisons à séquence d'outils identique montrent deux surcoûts fixes :

- **Consignes ajoutées au contrat d'outils** (optim. 3) : **+398 caractères** par nouveau chat. Comme ils sont dans le premier message, ils sont renvoyés à chaque requête, soit environ +6 000 de contexte cumulé sur une session de 16 requêtes (≈ +2 %).
- **Extrait renvoyé par `edit_file`** (optim. 5) : environ **+350 caractères par modification**. Cet extrait n'est rentable que s'il évite une relecture du fichier. Or aucun des 12 runs ne relisait le fichier après modification, avant comme après : sur ce banc, c'est un coût net.

### 3. Optimisations jamais déclenchées

- **`read_file` inchangé** (optim. 4) : aucune relecture complète d'un même fichier pendant ce banc, donc aucun gain mesuré. L'optimisation reste utile dans les longues sessions réelles.
- **Erreurs 429 et flux coupé** (optim. 1 et 2) : aucune erreur pendant les 12 sessions. Ces optimisations protègent le quota en cas d'incident et n'ont aucun effet en temps normal, ce qui est attendu.
- **Recherche groupée et arbre de dossiers** (optim. 6 et 7) : l'effet est trop petit pour ressortir. Les résultats de `search_files` sont courts dans ces tâches.

### 4. Points positifs

- **Fiabilité** : 36 tâches réussies sur 36 après, contre 35 sur 36 avant. L'échec de Sonnet sur `chat-total` ne s'est pas reproduit.
- **Moins de requêtes** : −9 % pour Sonnet, −4 % pour Opus.
- **Stabilité de Sonnet** : l'écart entre la meilleure et la pire session passe de 105 741 à 12 566 de contexte cumulé.
- **Aucune régression de comportement** n'a été observée.

## Conclusion

| Optimisation | Effet mesuré | Verdict |
|---|---|---|
| 1. Motif 429 | non déclenchée | à garder (protection) |
| 2. Pas de renvoi après flux coupé | non déclenchée | à garder (protection du quota) |
| 3. Consignes dans le contrat d'outils | +398 car. par chat, effet sur le comportement non prouvé | à raccourcir |
| 4. `read_file` inchangé | non déclenchée | à garder (sessions longues) |
| 5. Extrait renvoyé par `edit_file` | ≈ +350 car. par modification, jamais rentabilisé ici | à réduire ou à rendre facultatif |
| 6. Recherche groupée par fichier | négligeable | à garder |
| 7. Liste des dossiers en arbre | négligeable | à garder |

**Bilan** : sur ce banc, les 7 optimisations ne changent presque rien à la consommation. Elles ajoutent un petit surcoût fixe (≈ +2 à 3 %) et protègent le quota en cas d'erreur. Les écarts globaux (−20 % pour Sonnet, +13 % pour Opus) viennent surtout de la **taille des sorties de commandes** que le modèle choisit de lancer.

## Pistes suivantes

1. **Limiter les grosses sorties de `run_command`** : c'est le vrai levier. Une sortie de 17 à 19 000 caractères coûte plus que toutes les autres optimisations réunies, car elle est renvoyée à chaque requête suivante. Pistes : résumer les sorties répétitives (par exemple les 474 lignes de `check-indent`) ou baisser le plafond par défaut.
2. **Réindenter le dépôt** pour que `npm run lint` affiche presque rien : cela supprime la plus grosse source de bruit du banc.
3. **Réduire l'extrait d'`edit_file`** (±1 ligne, 15 lignes au plus) ou ne l'envoyer que si la modification touche plusieurs lignes.
4. **Raccourcir les 3 consignes** du contrat d'outils (objectif : moins de 150 caractères).
5. **Fiabiliser le banc** : passer à 5 sessions par variante, ou donner des tâches plus contraintes (par exemple « n'exécute pas le lint ») pour séparer l'effet des optimisations de celui du comportement du modèle.
