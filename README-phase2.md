# Phase 2 — boucle SOS participants

Trois écrans : le participant qui signale, la carte et la liste au PC,
le suivi renvoyé au participant.

## Mise en route

```
npm install     # leaflet et react-leaflet sont nouveaux
npm run dev
```

## Activer le module

Le SOS ne reçoit rien tant que le module est éteint, même si le lien
circule — c'est volontaire.

1. Ouvrir l'événement (bouton « Ouvrir »)
2. Dans **Modules**, activer **SOS participants**
3. Passer la phase en **exploitation** (le dépôt est refusé en
   préparation et en clôture)
4. Le lien participant s'affiche dans le panneau « Signalements »

## Protocole de test

| # | Action | Attendu |
|---|---|---|
| 1 | Ouvrir le lien `?sos=…` dans un onglet privé | Écran participant, sans connexion |
| 2 | Autoriser la position | Précision affichée en mètres |
| 3 | Envoyer un signalement « Malaise » | Référence `SOS-XXXX`, « Reçu au poste de commandement » |
| 4 | Revenir au PC | Le signalement apparaît, marqueur rouge sur la carte |
| 5 | Passer le statut à « Pris en charge » | Côté participant : « quelqu'un arrive » (dans les 15 s) |
| 6 | **Couper le réseau** (mode avion / DevTools → Offline) | Bandeau « hors réseau » |
| 7 | Envoyer un signalement hors réseau | « En attente d'envoi », message honnête affiché |
| 8 | Rétablir le réseau | Part tout seul, référence attribuée |
| 9 | Vérifier au PC | **Un seul** signalement, pas de doublon |
| 10 | Éteindre le module, réessayer d'envoyer | Refus explicite : module non activé |

Les étapes 7 à 9 sont le cœur : c'est le scénario du fond de vallée à
Ferrières. Un signalement qui ne part pas doit le dire, partir seul
ensuite, et ne jamais arriver en double.

## Ce qui n'est pas fait

- **QR code** : le lien s'affiche en texte, à encoder avec un générateur
  externe pour l'instant.
- **Notification au PC** : il faut regarder l'écran. Le rafraîchissement
  est de 10 secondes, sans son ni alerte.
- **Fond de carte hors ligne** : les tuiles OpenStreetMap exigent du
  réseau. La saisie fonctionne hors ligne, pas l'affichage de la carte.
- **Limitation d'abus** : aucune. À traiter le jour où un abus existe,
  pas avant.
