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
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Contexte non sécurisé ou navigateur sans support : sans effet. */
    })
  })
}
