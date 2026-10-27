# Fonctions serveur (Vercel)

Le dossier `api/` est déployé par Vercel avec le site : chaque fichier
devient une fonction Node, accessible sous `/api/<nom>` sur le même
domaine que l'application. Aucune étape de déploiement en plus, aucun
secret : elles partent avec `main`.

| Fonction       | Appelée depuis                        | Rôle                                   |
|----------------|---------------------------------------|----------------------------------------|
| `dwg-vers-dxf` | `src/dxfFond.js` (import d'un fond)   | Convertit un fond de plan DWG en DXF   |

## dwg-vers-dxf

Le DWG est le format fermé d'AutoCAD. Le seul lecteur libre, libredwg,
est sous GPL-3 et pèse 11 Mo en WebAssembly (`@mlightcad/libredwg-web`) :
il tourne ici, côté serveur, jamais dans le navigateur. L'application
livrée aux utilisateurs n'en contient pas une ligne ; seule cette
fonction en dépend. Si le dépôt devait un jour être diffusé
publiquement, c'est ce fichier-là qu'il faudrait regarder au regard de
la GPL.

Circuit : le navigateur dépose le DWG dans le compartiment `plans`,
demande deux adresses signées (lire le DWG, écrire le DXF) et les passe
à la fonction. Celle-ci relit le DWG, le convertit, dépose le DXF, et
répond en JSON. Le navigateur relit le DXF, le rastérise à l'échelle
comme tout DXF, puis efface les deux fichiers de passage. La fonction
n'accepte que des adresses de stockage du projet Supabase.

`vercel.json` lui donne 60 s et embarque le `.wasm` (`includeFiles`),
que le traceur de dépendances ne verrait pas seul.

Essai, sans réseau, avec le vrai libredwg :

```
node outils/banc-essai/dwg.mjs
```
