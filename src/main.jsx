import { demarrerNomsAccessibles } from './nomsAccessibles'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import 'leaflet/dist/leaflet.css'
import './styles.css'
// Après la feuille principale : la couche mobile n'ajoute pas un thème,
// elle rectifie la présentation sous 700 px et doit donc passer après.
import './mobile.css'
import { ecouterNotifications } from './push'
import { demarrerChargement } from './chargement'
import { demarrerGardeSaisie, saisieEnCours } from './gardeSaisie'
import MiseAJour from './MiseAJour'

// (11/11) Filet de noms accessibles pour les champs sans libellé relié.
demarrerNomsAccessibles()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <MiseAJour />
  </React.StrictMode>
)

/*
 * Service worker : il ne sert qu'à faire DÉMARRER l'application sans
 * réseau. Aucune donnée Supabase n'est mise en cache — une situation
 * périmée servie comme courante serait plus dangereuse qu'un écran vide.
 *
 * Enregistré seulement en production : en développement, il masquerait
 * les modifications derrière un cache.
 *
 * Défaut corrigé : une mise à jour détectée pouvait rester "en attente"
 * indéfiniment — l'onglet continuait à tourner sur l'ancien code pendant
 * que le stockage local (session Supabase incluse) évoluait sous un
 * nouveau format. Décalage exact qui produisait des erreurs d'auth
 * aléatoires, une fois sur deux. On force maintenant la nouvelle
 * version à prendre la main dès qu'elle est prête, avec un seul
 * rechargement automatique — sauf si un texte est en cours de saisie :
 * on le propose alors au lieu de l'imposer (audit du 11/11).
 */
// Entre une navigation et le retour de ses requêtes, les listes disent « Chargement… », pas « Aucun… ».
demarrerChargement()
// Un texte tapé et pas encore envoyé : confirmation avant de quitter, et la mise à jour attend.
demarrerGardeSaisie()

// Un clic sur une notification, application déjà ouverte : le service worker indique l'écran à montrer.
ecouterNotifications()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')

      // Une mise à jour peut déjà être en attente à l'arrivée.
      if (reg.waiting) reg.waiting.postMessage('activer')

      reg.addEventListener('updatefound', () => {
        const neuf = reg.installing
        neuf?.addEventListener('statechange', () => {
          if (neuf.state === 'installed' && navigator.serviceWorker.controller) {
            neuf.postMessage('activer')
          }
        })
      })

      // Un seul rechargement, au moment où la nouvelle version prend
      // effectivement le contrôle — jamais en boucle.
      let dejaRecharge = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (dejaRecharge) return
        // (11/11) Pas au milieu d'une phrase : si un texte est en cours de saisie, on propose
        // la mise à jour (MiseAJour.jsx) au lieu de recharger d'office.
        if (saisieEnCours()) {
          window.dispatchEvent(new Event('eventware:maj'))
          return
        }
        dejaRecharge = true
        window.location.reload()
      })
    } catch {
      /* Contexte non sécurisé ou navigateur sans support : sans effet. */
    }
  })
}

