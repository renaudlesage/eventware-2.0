/**
 * Icône PWA par événement.
 *
 * L'application est une SPA statique : un seul manifeste, servi une
 * fois pour tous les clients. On ne peut pas générer un manifeste par
 * événement côté serveur sans infrastructure supplémentaire.
 *
 * La parade : échanger les balises <link rel="apple-touch-icon"> et
 * <link rel="manifest"> CÔTÉ NAVIGATEUR, une fois l'événement chargé,
 * juste avant que la personne installe l'app sur son écran d'accueil.
 *
 * Limite à connaître : ça ne change l'icône que pour une INSTALLATION
 * FAITE APRÈS le chargement du logo. Une app déjà sur l'écran d'accueil
 * garde son ancienne icône — il faut la réinstaller.
 */

let urlManifestPrecedente = null

export function appliquerIconeEvenement(nom, logoUrl) {
  const toucheApple = document.querySelector('link[rel="apple-touch-icon"]')
  if (toucheApple) toucheApple.href = logoUrl || '/icone.svg'

  const toucheIcone = document.querySelector('link[rel="icon"]')
  if (toucheIcone && logoUrl) toucheIcone.href = logoUrl

  const lienManifeste = document.querySelector('link[rel="manifest"]')
  if (!lienManifeste) return

  if (urlManifestPrecedente) URL.revokeObjectURL(urlManifestPrecedente)

  if (!logoUrl) {
    lienManifeste.href = '/manifest.webmanifest'
    urlManifestPrecedente = null
    return
  }

  const manifeste = {
    name: nom ? `${nom} — Eventware` : 'Eventware',
    short_name: nom || 'Eventware',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0d1116',
    theme_color: '#0d1116',
    lang: 'fr-BE',
    icons: [{ src: logoUrl, sizes: 'any', purpose: 'any maskable' }]
  }

  const blob = new Blob([JSON.stringify(manifeste)], { type: 'application/manifest+json' })
  const url = URL.createObjectURL(blob)
  lienManifeste.href = url
  urlManifestPrecedente = url
}
