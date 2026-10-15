# Demandes similaires — module Eventware

**Avant d'enregistrer une demande, le formulaire vérifie qu'elle n'existe pas déjà.**

Le REX BFMF 2026 a relevé des doublons purs, notamment sur le circuit des jetons, et des compléments envoyés comme de nouvelles demandes (« Il me faut aussi… », « Et 2 jus de pomme »). Chacun coûte une attribution, un aller-retour de volante et une ligne de plus dans la file.

Pendant la saisie, le formulaire peut afficher trois types de suggestion :

| Suggestion | Quand | Proposition |
|---|---|---|
| **Doublon probable** | Une demande **ouverte**, au même lieu, pour le même besoin, quel que soit l'émetteur | « LOG-026 demande déjà la même chose ici (16:36, à traiter) : la suivre plutôt que créer un doublon ? » |
| **Complément** | Le **même émetteur**, au même lieu, il y a moins de 20 min, demande encore ouverte, et le texte s'annonce comme un ajout (« et… », « aussi », « en plus ») ou recouvre nettement la précédente | « Votre demande LOG-041 (il y a 10 min) est encore ouverte : l'ajouter en commentaire ? » |
| **Besoin récurrent** | Même besoin, même lieu, **résolu** dans les 4 dernières heures | « Même besoin résolu à 17:10 (LOG-025) : le problème revient. » |

La suggestion n'est **jamais bloquante** : on peut toujours créer la demande.

## Résultat sur les 68 demandes réelles de BFMF 2026

Chaque demande a été rejouée au moment exact de sa création, avec l'état des autres demandes à cet instant (`tests/evaluation_bfmf2026.sql`) :

| Demande créée | Suggestion | Verdict |
|---|---|---|
| LOG-029 « Aller chercher **seau** de jetons de la **food** à l'étape 2 » | **Doublon** de LOG-026 « Aller rechercher **sceau** jetons **Foodtruck** étape 2 », encore ouverte (score 1,00) | ✅ le doublon du REX |
| LOG-033 « Besoin de jeton bar site » | **Récurrence** de LOG-025, résolue 35 min plus tôt | ✅ |
| LOG-042 « Il me faut **aussi** des cruches et de la lupulus placebo » | **Complément** de LOG-041, même émetteur, 10 min | ✅ |
| LOG-067 « **Et** 2 jus de pomme » | **Complément** de LOG-066, même émetteur, 3 min | ✅ |
| LOG-053 « Accompagner l'équipe Nsangu depuis backstage vers étape 3 » | **Complément** de LOG-052 (navette au départ du backstage, 5 min) | 🟡 utile pour grouper les trajets |
| LOG-063 « Pick up et dépose de 4 personnes du backstage à l'étape 1 » | **Récurrence** de LOG-052 | ✅ |
| LOG-061 « Drop 1 personne sur étape 3 » | **Récurrence** de LOG-054 (navette depuis la plaine) | 🟡 limite |

**7 suggestions pour 68 créations, aucune absurde, et rien pour les 61 autres demandes.** C'est la condition pour qu'un bénévole ne prenne pas l'habitude de fermer la fenêtre sans la lire.

## Comment ça marche

1. **Normalisation** (`normaliser_demande`) : le texte passe en minuscules, sans accents, puis les synonymes de terrain sont ramenés à un même mot (sceau → seau, mazout/fuel → carburant, papier toilette → pq, pick up/drop → navette, aller chercher/rapatrier → recuperer…). Les mots vides sont retirés, et « étape 2 » devient `etape2` pour rester distinct d'`etape3`.
   « Aller rechercher sceau jetons Foodtruck étape 2 » → `etape2 foodtruck jeton recuperer seau`
2. **Score** (`score_similarite`), compris entre 0 et 1 : on retient le meilleur des deux indices suivants. Le premier est la similarité de trigrammes, qui absorbe les fautes de frappe. Le second est la part de mots communs rapportée à la demande la plus courte.
3. **Classement** (`missions_similaires`) : le score est combiné avec l'état de la demande (ouverte ou résolue), le lieu, l'auteur et l'âge de la demande. Le seuil vaut 0,5 et passe à 0,65 si la nouvelle demande n'a pas de lieu.

Le **vocabulaire** est une table (`demande_vocabulaire`), modifiable dans l'app comme les autres référentiels. Les lignes sans événement forment le vocabulaire commun. Chaque événement peut ajouter ses propres termes (« patatrak » → foodtruck, « la 3 » → etape3…) ou en remplacer.

## Installation

1. Dans le SQL Editor du projet Eventware, exécuter `supabase/migrations/20261015_demandes_similaires.sql`. La migration active `pg_trgm` et `unaccent` (disponibles sur le projet, pas encore activées). Elle est rejouable et ne modifie aucune table existante.
2. Copier `src/hooks/useDemandesSimilaires.js` et `src/components/SuggestionsDemande.jsx`, puis **adapter l'import du client Supabase** à la première ligne du hook.
3. Dans le formulaire de demande, sous le champ titre :
   ```jsx
   <SuggestionsDemande
     evenementId={evenement.id}
     titre={form.titre}
     description={form.description}
     lieuId={form.lieu_id}
     missionId={mission?.id}          // en édition seulement
     onSuivre={(id) => ouvrirMission(id)}
     onCommenter={(id) => ajouterCommentaire(id, form.titre)}  // → mission_commentaires
   />
   ```
   Les classes `suggestion--doublon`, `suggestion--complement` et `suggestion--recurrence` sont à styler avec les jetons du socle (`etat-veille` pour le doublon, `etat-info` pour le complément et la récurrence).

## Sécurité

- `missions_similaires` est en `security invoker` : elle ne voit que les missions que l'utilisateur a le droit de lire.
- Le vocabulaire commun ne se modifie que par migration. Celui d'un événement se modifie avec le droit `referentiels / modifier`.

## Rejeu

Les paramètres `p_auteur` et `p_a` permettent de poser la question « à une date donnée ». C'est ce qui a servi à l'évaluation, et ça peut servir au REX ou à un exercice rejoué.

## Tests

En local, sur Postgres 15 ou plus avec `pg_trgm` et `unaccent` :
```
psql -f tests/socle_minimal.sql \
     -f supabase/migrations/20261015_demandes_similaires.sql \
     -f tests/donnees_bfmf2026.sql \
     -f tests/evaluation_bfmf2026.sql
```

Les composants React n'ont pas pu être compilés ici (pas d'accès npm). Ils ont été relus, mais une première exécution dans StackBlitz s'impose.

## Pistes

- **Brancher la récurrence sur Précurseur** : un besoin qui revient au même lieu, c'est exactement le « résidu » que Précurseur fait peser.
- **Proposer la fusion côté QG** : quand un doublon a quand même été créé, un bouton « fusionner » (commentaires et historique rattachés à la première demande).
