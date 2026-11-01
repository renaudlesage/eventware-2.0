# Heures du soleil (migration 153)

Contrôle indépendant de `heure_soleil()` : même algorithme NOAA, en Python, pour comparer la base à une seconde implémentation.

- `soleil.py` : lever, coucher, fin des crépuscules civil et nautique pour quelques dates au point 0 de la Rando VTT (Ferrières). Sur les 365 jours de 2026, l'écart avec la fonction SQL est d'au plus 1 seconde.
- `ecart.py` : recalcule les écarts de l'ancienne table « une valeur par mois » (120, 128) : 131 jours sur 365 à plus de 15 min, pire écart 94 min le 31/10.
- `stub_local.sql` : réplique minimale de `generer_exercice` pour rejouer la 153 sur un PostgreSQL local. **Ne pas exécuter sur Supabase.**

La vérification en base, en lecture seule, est dans `supabase/verifications/153-soleil.sql`.

```sh
cd outils/soleil && python3 soleil.py && python3 ecart.py
```
