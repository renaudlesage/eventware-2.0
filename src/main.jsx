import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import 'leaflet/dist/leaflet.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
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
 * rechargement automatique.
 */
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
        dejaRecharge = true
        window.location.reload()
      })
    } catch {
      /* Contexte non sécurisé ou navigateur sans support : sans effet. */
    }
  })
}

