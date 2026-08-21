# Eventware 2.0 — front de validation du socle

Ce n'est pas le début de l'interface. C'est un **harnais de test** : quatre écrans sans
ambition graphique, dont le seul but est de vérifier que l'isolation multi-tenant tient
à travers la vraie chaîne — PostgREST, jetons JWT réels, grants de table — et non plus
seulement en SQL simulé.

Une fois le protocole ci-dessous passé, la phase 1 est close et ce projet peut être jeté.

---

## Avant de lancer

Une seule chose à régler dans Supabase, sinon rien ne fonctionne :

**Authentication → Sign In / Providers → Email → décocher « Confirm email »**

Sans ça, chaque compte créé attend une confirmation par e-mail que le projet Free
n'enverra pas de façon fiable. À réactiver le jour où l'onboarding réel sera construit.

## Lancer

```
npm install
npm run dev
```

Le fichier `.env` est déjà rempli avec l'URL du projet et la clé publiable.

---

## Protocole de test — critère de sortie de phase 1

| # | Action | Résultat attendu |
|---|---|---|
| 1 | Créer le compte `a@test.be`, se connecter | Aucun événement visible |
| 2 | Créer l'événement « Rando VTT test » | Apparaît, jeton `admin` |
| 3 | Se déconnecter, créer le compte `b@test.be` | **Aucun événement visible** — c'est le test central |
| 4 | Créer l'événement « Festival test » | Apparaît, jeton `admin`, et A reste invisible |
| 5 | Copier l'identifiant affiché en bas d'écran | — |
| 6 | Revenir sur A, ajouter B comme `benevole` sur la Rando | B apparaît dans les membres |
| 7 | Se reconnecter en B | Voit désormais **deux** événements, avec deux rôles distincts |
| 8 | En B, tenter de basculer la phase de la Rando | Impossible : pas de contrôle affiché, et refus côté base |
| 9 | En A, basculer la phase montage → exploitation → montage | Trois lignes dans `bascule_phase`, horodatages distincts |

Si l'étape 3 échoue, tout le reste est sans objet.

---

## Ce que ce harnais ne fait pas

- **L'invitation réelle par e-mail.** Ici, on ajoute quelqu'un en collant son identifiant.
  Une vraie invitation demande une Edge Function en `service_role` (créer le compte,
  envoyer le lien, préaffecter le rôle). C'est du travail de phase 1, non fait.
- **L'import CSV** et les seeds de référentiels en base — également phase 1.
- **La gestion d'erreur fine.** Les messages remontent bruts de PostgREST, ce qui est
  volontaire : pendant un test, on veut lire le refus exact.

---

## À purger avant tout usage sérieux

Les deux utilisateurs factices créés en SQL (`test-a@eventware.local`,
`test-b@eventware.local`) ont un mot de passe invalide et ne peuvent pas se connecter.
À supprimer avec les trois événements de test une fois le protocole passé.

---

## Import CSV — protocole de test

Un fichier `exemple-lieux.csv` est fourni à la racine. Il contient
volontairement trois lignes fautives, pour vérifier que le module les
rejette au lieu de les avaler.

| # | Action | Résultat attendu |
|---|---|---|
| 1 | Ouvrir un événement (bouton « Ouvrir ») | Compteurs de référentiel à 0 |
| 2 | Choisir « Lieux », charger `exemple-lieux.csv` | 4 nouveaux, 3 rejetés |
| 3 | Lire les motifs de rejet | type hors liste · code en double · code manquant |
| 4 | Mode « Simulation », appliquer | Rien n'est écrit, compteurs inchangés |
| 5 | Mode « Ajouter seulement », appliquer | 4 lieux créés |
| 6 | Recharger le même fichier | 4 **déjà présents**, 3 rejetés — plus aucun nouveau |
| 7 | Mode « Ajouter seulement », appliquer | 0 créé, 4 ignorés : **rien n'est écrasé** |
| 8 | Modifier une description dans le CSV, recharger, mode « Mettre à jour » | 4 mises à jour, description modifiée |

L'étape 7 est le cœur du test : c'est le scénario exact de la perte de
données de 2026, et il doit désormais être sans effet.

Chaque opération, simulation comprise, laisse une ligne dans
`journal_imports` avec le détail des rejets.
