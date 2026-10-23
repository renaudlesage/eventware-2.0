# Eventware 2.0 — tokens de design

Les tokens vivent en tête de `src/styles.css`, comme variables CSS sur
`:root`, avec un thème jour et un thème nuit. Ce document les inventorie ;
la feuille de style reste la référence.

## Principe

Un tableau de bord d'instruments, pas un site. Chaque couleur porte un
sens fixe, aucune couleur de marque ne vient le concurrencer. Deux thèmes
pour une raison opérationnelle, pas esthétique : le QG tourne de nuit sous
chapiteau, où un fond clair aveugle ; le terrain tourne en plein soleil, où
un fond sombre est illisible.

## Neutres

| Token | Jour | Nuit | Usage |
|---|---|---|---|
| `--fond` | `#eef0f2` | `#0d1116` | fond de page |
| `--surface` | `#ffffff` | `#161c23` | panneaux, cartes |
| `--surface-2` | `#f6f7f9` | `#1c242d` | plaque active, zébrage |
| `--encre` | `#10151b` | `#e6eaee` | texte |
| `--sourdine` | `#5d6874` | `#8d99a6` | texte secondaire |
| `--trait` | `#ccd2d9` | `#2b343e` | bordures |
| `--trait-fort` | `#10151b` | `#6c7a89` | bordure appuyée |
| `--on-teinte` | `#ffffff` | `#0d1116` | encre posée sur un aplat de teinte ou d'état (plaque active, bouton plein, bandeau de niveau, bouton flottant). Jamais `#fff` en dur sur une teinte : de nuit, les teintes sont éclaircies et le blanc n'y tient plus. |

## Couleurs d'état

Sens fixe, jamais décoratives.

| Token | Jour | Nuit | Sens |
|---|---|---|---|
| `--etat-ok` | `#1f6f4f` | `#3d9c74` | nominal, confirmé, résolu |
| `--etat-veille` | `#a86a00` | `#d09122` | vigilance, en attente, seuil proche |
| `--etat-chaud` | `#b3311d` | `#e2543a` | urgence, P1, seuil franchi |
| `--etat-info` | `#23557f` | `#4a8ec2` | information, préparation, focus clavier |
| `--etat-froid` | `#5d6874` | `#8d99a6` | clos, inactif, sans suite |

## Teintes de domaine

Repérage et navigation uniquement. Aucune ne doit colorer une valeur : un
chiffre coloré signifie toujours un état, jamais une appartenance.

| Token | Jour | Nuit |
|---|---|---|
| `--dom-indigo` | `#4c5bb8` | `#8b97e8` |
| `--dom-violet` | `#7a4fb0` | `#b085e0` |
| `--dom-sarcelle` | `#17796f` | `#4bb8ab` |
| `--dom-grenat` | `#a8324a` | `#e0798c` |
| `--dom-orange` | `#c25a12` | `#ef9450` |
| `--dom-bronze` | `#8a6212` | `#cfa242` |
| `--dom-mousse` | `#3f7a2e` | `#7fbd6a` |
| `--dom-azur` | `#1f6ba8` | `#5ea8e0` |
| `--dom-prune` | `#8c3f7a` | `#d07cba` |
| `--dom-ardoise` | `#4a6572` | `#8fa8b8` |
| `--dom-tilleul` | `#6d7a1c` | `#b8c95c` |
| `--dom-gris` | `#5d6874` | `#8d99a6` |

### Calques du plan d'implantation

Les huit calques (`src/calques.jsx`) reprennent les valeurs jour de ces
teintes en dur, parce qu'elles doivent rester identiques sur une carte
satellite, de nuit et à l'impression.

| Calque | Teinte | Valeur |
|---|---|---|
| infrastructures | violet | `#7a4fb0` |
| restauration | orange | `#c25a12` |
| énergie | bronze | `#8a6212` |
| eau | azur | `#1f6ba8` |
| sanitaires | sarcelle | `#17796f` |
| logistique | gris | `#5d6874` |
| sécurité | grenat | `#a8324a` |
| circulation | mousse | `#3f7a2e` |

Les pictogrammes (`src/pictos.js`) suivent les codes de la signalisation
de sécurité ISO 7010, hors thème : vert sauvetage `#1f8a4c`, rouge
incendie `#c8102e`, bleu obligation `#1d5fb5`, jaune avertissement
`#f2c200`.

## Typographie

| Token | Valeur | Usage |
|---|---|---|
| `--texte` | system-ui, -apple-system, Segoe UI, Roboto, sans-serif | tout le texte courant |
| `--mono` | ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace | codes, références, heures, compteurs, petits libellés en capitales espacées |

Corps à 15 px, interligne 1,5. Échelle effective dans la feuille : 10,
11, 11,5, 12, 13, 14, 15, 17, 20 px. Les chiffres « grands » des pavés de
la Situation montent au-delà.

## Forme

| Token | Jour | Nuit | Usage |
|---|---|---|---|
| `--rayon` | 2 px | 2 px | presque rien d'arrondi |
| `--ombre` | `0 1px 0 rgba(16,21,27,.06)` | aucune | filet sous les panneaux |
| `--ombre-flottant` | `0 3px 12px rgba(16,21,27,.22)` | `0 3px 12px rgba(0,0,0,.55)` | la seule ombre portée autorisée : ce qui flotte au-dessus de la page (rail déplié, boutons flottants) |

Focus clavier : contour 2 px `--etat-info`, décalé de 2 px.
`prefers-reduced-motion` coupe toute animation et transition.

## Thème

`data-theme` sur `<html>` : `clair`, `sombre`, ou absent pour suivre le
système (`prefers-color-scheme`). Le bouton « Nuit » de l'en-tête le pose,
`App.jsx` l'écrit. En JavaScript, les cartes Leaflet lisent les tokens à
l'exécution par `getComputedStyle` (fonction `jetons()` de
`ColonneSituation.jsx`), pour suivre le thème sans recharger.

## Sémantique dérivée

Classes qui projettent les tokens, pour ne jamais choisir une couleur à
la main :

| Classe | Token | Sens |
|---|---|---|
| `.jeton.prio-P1` | chaud, gras | priorité 1 |
| `.jeton.prio-P2` | veille | priorité 2 |
| `.jeton.prio-P3`, `.prio-P4` | sourdine | priorités basses |
| `.jeton.phase` | ok | phase courante |
| `.niveau-normal` | ok | niveau autorité |
| `.niveau-vigilance` | veille | niveau autorité |
| `.niveau-alerte` | fond chaud, encre `--on-teinte` | niveau autorité |
| `.jeton.prise-attente` | chaud, gras | intervention en attente de moyen |
| `.jeton.prise-engage` | veille | moyen engagé |
| `.jeton.prise-sur_place` | ok | sur place |

## Ce qui n'est pas nommé

Il n'y a pas de tokens d'espacement : les écarts sont écrits en px dans
chaque règle, le plus souvent 4, 6, 8, 10, 12. Les paliers de largeur non
plus : 560, 620, 700, 780, 900 px pour le mobile, 1100 pour l'éditeur
d'implantation, 1440 pour la Situation sur deux colonnes.
