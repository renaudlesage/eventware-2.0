# Pouls du QG (migration 154)

D'où viennent les seuils de prise en charge appris, et comment rejouer la migration en local.

- `log.csv` et `ana.py` : les 68 demandes logistiques du BFMF 2026 (heures réelles de création, d'attribution, de démarrage et de clôture) et leur analyse : charge au pic, délai de prise en charge par priorité, corrélations, demandes sans trace de prise en charge.
- `donnees_bfmf2026.sql` : les mêmes 68 demandes en `insert`, pour la réplique locale.
- `stub_local.sql` : réplique minimale (`evenements`, `missions`, enums, rôles) sur un PostgreSQL local. **Ne pas exécuter sur Supabase.**
- `scenario.sql` : seuils appris, organisation sans historique, six demandes de test sur la Rando VTT, refus en anonyme.
- `resultats.txt` : ce que donne le scénario.

```sh
cd outils/pouls-qg && python3 ana.py
createdb pouls && psql pouls -f stub_local.sql -f donnees_bfmf2026.sql \
  -f ../../supabase/migrations/20261102090000_154_pouls_qg.sql -f scenario.sql
```

La vérification en base, en lecture seule, est dans `supabase/verifications/154-pouls-qg.sql`.
