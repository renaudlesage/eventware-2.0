/*
 * Service worker d'Eventware.
 *
 * Ce qu'il fait : permettre à l'application de SE CHARGER sans réseau.
 * Jusqu'ici, le mémento était en cache mais l'application elle-même ne
 * démarrait pas hors réseau — le cache ne servait donc qu'à qui avait
 * gardé son onglet ouvert.
 *
 * Ce qu'il ne fait PAS, volontairement :
 *   il ne met JAMAIS en cache les réponses de Supabase. Une donnée
 *   opérationnelle périmée servie comme fraîche est plus dangereuse
 *   qu'une absence de donnée : on croirait lire la situation courante.
 *   Les seules données disponibles hors réseau sont celles que
 *   l'application a explicitement enregistrées — le mémento d'urgence
 *   et la file d'attente des signalements.
 */

const VERSION = 'eventware-v3'
const COQUILLE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icone.svg'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(COQUILLE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Appels à Supabase et à toute API tierce : réseau uniquement.
  // Rien de tout cela ne doit être resservi depuis un cache.
  if (url.origin !== self.location.origin) return

  // Navigation : réseau d'abord, coquille en secours.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((r) => r ?? caches.match('/'))
      )
    )
    return
  }

  // Ressources de l'application : cache d'abord, rafraîchi en arrière-plan.
  e.respondWith(
    caches.match(request).then((cachee) => {
      const reseau = fetch(request)
        .then((reponse) => {
          if (reponse && reponse.status === 200 && reponse.type === 'basic') {
            const copie = reponse.clone()
            caches.open(VERSION).then((c) => c.put(request, copie))
          }
          return reponse
        })
        .catch(() => cachee)
      return cachee ?? reseau
    })
  )
})

/* Permet à la page de forcer l'activation d'une nouvelle version. */
self.addEventListener('message', (e) => {
  if (e.data === 'activer') self.skipWaiting()
})
