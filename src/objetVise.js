import { useEffect } from 'react'
import { lireRoute } from './route'

/**
 * L'objet visé par l'adresse (11/11, audit : liens directs).
 *
 *   #securite/missions/SEC-014   →  la demande SEC-014, dépliée
 *   #planning/jalons/J-12        →  le jalon J-12, amené à l'écran
 *
 * Deux moitiés, pour ne pas faire descendre une propriété de plus dans
 * chaque écran :
 *
 * — `objetVise()` lit l'objet dans l'adresse. Une liste s'en sert pour
 *   lever son filtre par défaut (une demande close reste trouvable) ou
 *   pour déplier la bonne ligne ;
 * — chaque ligne porte `data-objet="SEC-014"`, et `useObjetVise`, posé
 *   une seule fois dans le poste, l'amène à l'écran et la souligne un
 *   instant, dès qu'elle est affichée.
 */
export function objetVise() {
  return lireRoute().objet
}

export function useObjetVise(objet, visee) {
  useEffect(() => {
    if (!objet) return undefined
    let essais = 0
    let fin = null
    // La liste se charge : on regarde quelques secondes, puis on renonce sans bruit.
    const t = setInterval(() => {
      const el = [...document.querySelectorAll('[data-objet]')].find((x) => x.getAttribute('data-objet') === objet)
      if (el) {
        clearInterval(t)
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        el.classList.add('objet-vise')
        fin = setTimeout(() => el.classList.remove('objet-vise'), 3000)
      } else if (++essais > 40) {
        clearInterval(t)
      }
    }, 150)
    return () => {
      clearInterval(t)
      clearTimeout(fin)
    }
  }, [objet, visee])
}
