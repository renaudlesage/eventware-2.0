# Edge Functions

Deux fonctions serveur (Deno), déployées sur le projet Supabase. Leur
source a été récupérée depuis Supabase le 18/09/2026 : jusque-là elles
n'étaient versionnées nulle part, et le dépôt ne permettait pas de les
redéployer.

| Fonction          | JWT requis | Appelée depuis                                   |
|-------------------|------------|--------------------------------------------------|
| `diffuser-alerte` | oui        | `src/diffuserAlerte.js` (`supabase.functions.invoke`) |
| `irm-vigilance`   | **non**    | `src/MoniteurIrm.jsx` (`fetch` direct, GET)      |
| `reception-commune` | **non**  | la commune (Crisiware), POST — déployée le 2/11 (158) |
| `diffuser-dossier` | oui     | `src/diffuserDossier.js` après chaque changement de statut du dossier — déployée le 2/11 (161) |
| `transcrire-vocal` | oui     | `src/transcrireVocal.js` : le téléphone après l'envoi d'un message vocal sans texte, le QG par « Transcrire » (fil Entendu) — déployée le 2/11 |

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
supabase functions deploy transcrire-vocal
```

Le drapeau `--no-verify-jwt` sur `irm-vigilance` est indispensable :
sans lui, le déploiement remet la vérification par défaut et le pavé
IRM ne charge plus.

## Secrets

`diffuser-alerte` lit `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`,
fournis automatiquement par la plateforme. Aucun secret à déclarer.

`transcrire-vocal` a besoin de **`OPENAI_API_KEY`** (clé de l'API OpenAI,
déclarée par Ren dans Supabase › Edge Functions › Secrets, ou
`supabase secrets set OPENAI_API_KEY=…`) et lit en option
`TRANSCRIPTION_MODELE` (par défaut `gpt-4o-mini-transcribe`). Sans la clé,
la fonction répond 503 et note `erreur:serveur:cle-absente` sur le
message ; rien d'autre ne change. Elle ne tourne que si l'événement a
l'option « Transcription par le serveur » (Réglages › Modules ›
Talkie-téléphone). L'audio n'est envoyé qu'au service, jamais conservé
ailleurs que dans le compartiment `vocaux` ; le texte revient dans
`messages_vocaux.transcription` avec `reconnaissance = 'serveur'`, et le
déclencheur de la 162/166 reconnaît les mots-clés.
