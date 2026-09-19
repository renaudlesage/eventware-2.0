# Edge Functions

Deux fonctions serveur (Deno), déployées sur le projet Supabase. Leur
source a été récupérée depuis Supabase le 18/09/2026 : jusque-là elles
n'étaient versionnées nulle part, et le dépôt ne permettait pas de les
redéployer.

| Fonction          | JWT requis | Appelée depuis                                   |
|-------------------|------------|--------------------------------------------------|
| `diffuser-alerte` | oui        | `src/diffuserAlerte.js` (`supabase.functions.invoke`) |
| `irm-vigilance`   | **non**    | `src/MoniteurIrm.jsx` (`fetch` direct, GET)      |

`irm-vigilance` est volontairement ouverte : elle relaie une donnée
publique (Meteoalarm) et l'écran qui l'appelle peut être consulté sans
compte. `diffuser-alerte` tourne avec la clé de service et n'accepte
qu'un appel authentifié.

## Redéployer

Avec la CLI Supabase, depuis la racine du dépôt :

```
supabase functions deploy diffuser-alerte
supabase functions deploy irm-vigilance --no-verify-jwt
```

Le drapeau `--no-verify-jwt` sur `irm-vigilance` est indispensable :
sans lui, le déploiement remet la vérification par défaut et le pavé
IRM ne charge plus.

## Secrets

`diffuser-alerte` lit `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`,
fournis automatiquement par la plateforme. Aucun secret à déclarer.
