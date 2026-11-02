# Edge Functions

Deux fonctions serveur (Deno), déployées sur le projet Supabase. Leur
source a été récupérée depuis Supabase le 18/09/2026 : jusque-là elles
n'étaient versionnées nulle part, et le dépôt ne permettait pas de les
redéployer.

| Fonction          | JWT requis | Appelée depuis                                   |
|-------------------|------------|--------------------------------------------------|
| `diffuser-alerte` | oui        | `src/diffuserAlerte.js` (`supabase.functions.invoke`) |
| `irm-vigilance`   | **non**    | `src/MoniteurIrm.jsx` (`fetch` direct, GET)      |
| `reception-commune` | **non**  | la commune (Crisiware), POST — **pas encore déployée** (158, accord de Ren requis) |
| `diffuser-dossier` | oui     | `src/diffuserDossier.js` après chaque changement de statut du dossier — **pas encore déployée** (161) |

`reception-commune` est ouverte parce que la commune n'a pas de compte :
ce qui l'authentifie, c'est le secret de sa liaison (Réglages › Partage
› Liaison commune), vérifié en base par `recevoir_message_commune`
(migration 158), qui journalise les rejets sans jamais écrire le
secret. Elle tourne avec la clé de service.

`irm-vigilance` est volontairement ouverte : elle relaie une donnée
publique (Meteoalarm) et l'écran qui l'appelle peut être consulté sans
compte. `diffuser-alerte` tourne avec la clé de service et n'accepte
qu'un appel authentifié.

## Redéployer

Avec la CLI Supabase, depuis la racine du dépôt :

```
supabase functions deploy diffuser-alerte
supabase functions deploy irm-vigilance --no-verify-jwt
supabase functions deploy reception-commune --no-verify-jwt
supabase functions deploy diffuser-dossier
```

Le drapeau `--no-verify-jwt` sur `irm-vigilance` est indispensable :
sans lui, le déploiement remet la vérification par défaut et le pavé
IRM ne charge plus.

## Secrets

`diffuser-alerte` lit `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`,
fournis automatiquement par la plateforme. Aucun secret à déclarer.
