import { useEffect } from 'react'

/**
 * L'adresse de l'écran (11/11, audit M1).
 *
 * L'application ne retenait pas où l'on était : un rechargement
 * ramenait à la Situation, le bouton Retour faisait sortir, et aucun
 * lien ne menait à un écran. L'écran, sa rubrique et, s'il y en a un,
 * l'objet ouvert vivent maintenant dans le fragment de l'adresse :
 *
 *   #securite                     l'écran
 *   #securite/missions            sa rubrique
 *   #securite/missions/SEC-014    un objet de cette rubrique
 *
 * Le fragment, et non le chemin : les pages publiques se choisissent
 * déjà par paramètre (?sos=, ?poste=), et l'hébergement n'a pas à
 * connaître ces routes.
 */
const SIGNAL = 'eventware:route'

export function lireRoute() {
  const morceaux = window.location.hash.replace(/^#/, '').split('/').map((m) => {
    try { return decodeURIComponent(m) } catch { return m }
  })
  return { ecran: morceaux[0] || null, rubrique: morceaux[1] || null, objet: morceaux[2] || null }
}

export function fragment({ ecran, rubrique, objet }) {
  if (!ecran) return ''
  const m = [ecran]
  if (rubrique || objet) m.push(rubrique ?? '')
  if (objet) m.push(objet)
  return '#' + m.map(encodeURIComponent).join('/')
}

/** Écrit l'adresse. `remplacer` : sans ajouter d'étape au bouton Retour. */
export function ecrireRoute(route, { remplacer = false } = {}) {
  const cible = fragment(route)
  if (cible === window.location.hash) return
  const url = window.location.pathname + window.location.search + cible
  try {
    if (remplacer) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState({ eventware: true }, '', url)
  } catch {
    /* adresse non modifiable (aperçu, fichier local) : la navigation fonctionne quand même */
  }
  window.dispatchEvent(new Event(SIGNAL))
}

/** Prévient à chaque changement d'adresse : bouton Retour, lien, navigation interne. */
export function surRoute(fn) {
  // `origine` : 'navigateur' (bouton Retour, lien collé) ou 'interne' (notre propre écriture).
  const navigateur = () => fn(lireRoute(), 'navigateur')
  const interne = () => fn(lireRoute(), 'interne')
  window.addEventListener('popstate', navigateur)
  window.addEventListener('hashchange', navigateur)
  window.addEventListener(SIGNAL, interne)
  return () => {
    window.removeEventListener('popstate', navigateur)
    window.removeEventListener('hashchange', navigateur)
    window.removeEventListener(SIGNAL, interne)
  }
}

/** Le lien complet vers un écran, une rubrique ou un objet, à copier ou à envoyer. */
export function lienVers(route) {
  return window.location.origin + window.location.pathname + fragment(route)
}

/**
 * Relie la rubrique d'un écran à l'adresse.
 *
 *   useRubriqueRoute('rh', onglet, setOnglet, ongletCible, ['couverture', 'membres'])
 *
 * — une navigation ciblée (`ongletCible`, venue d'un cadran, d'un pavé ou
 *   de l'adresse) ouvre la rubrique demandée, si elle existe ;
 * — changer de rubrique met l'adresse à jour, sans étape de plus au
 *   bouton Retour : il ramène à l'écran précédent, pas à la rubrique d'avant.
 */
export function useRubriqueRoute(ecran, valeur, setValeur, cible, valides) {
  const admise = (k) => !!k && (!valides || valides.includes(k))
  useEffect(() => {
    if (admise(cible) && cible !== valeur) setValeur(cible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cible])
  useEffect(() => {
    const r = lireRoute()
    if (r.ecran !== ecran || !valeur) return
    // On garde l'objet tant qu'on reste dans la rubrique qui le porte.
    ecrireRoute({ ecran, rubrique: valeur, objet: r.rubrique === valeur ? r.objet : null }, { remplacer: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecran, valeur])
}
