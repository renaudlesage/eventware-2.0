# Migrations

Ordre chronologique, préfixe = horodatage Supabase. À rejouer dans cet
ordre sur un projet neuf pour reconstruire la base complète.

| Fichier | Contenu |
|---|---|
| `..._001_socle_multitenant.sql` | Types, tables du socle, fonctions d'autorisation, triggers, RLS |
| `..._002_seed_matrice_permissions.sql` | Seed produit rôle × phase × ressource (257 lignes) |
| `..._003_fix_horodatage_bascule.sql` | Correction `now()` → `clock_timestamp()` |
| `..._004_admin_createur_evenement.sql` | Le créateur d'un événement devient admin |
| `..._005_referentiels.sql` | equipes, lieux, types_mission, materiel, contacts |

## Ce qui n'est PAS ici

Aucune donnée client. La seule chose semée est la matrice de
permissions, qui relève du produit et non du client : le jeu de rôles
est figé, non paramétrable.

Les référentiels d'un événement (lieux, équipes, matériel…) se
chargent exclusivement par formulaire ou par import CSV depuis l'app.
Jamais par édition d'un fichier source — c'est ce mode de travail qui a
provoqué la perte de données de BFMF 2026.

## Test d'isolation

Critère de sortie de phase 1, à rejouer après toute modification des
policies :

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid_utilisateur>","role":"authenticated"}';
select count(*) from evenements;
```

Un utilisateur ne doit voir que les événements dont il est membre.
