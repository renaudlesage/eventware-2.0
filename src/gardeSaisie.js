import { surEcriture } from './temoinEcriture'

/**
 * Ne pas perdre ce qui est en train d'être écrit (11/11, audit M14).
 *
 * Deux façons de perdre une saisie sans l'avoir voulu :
 * — fermer ou recharger l'onglet avec un texte tapé et pas encore
 *   envoyé (une demande, un constat, une réponse au terrain) ;
 * — la mise à jour de l'application, qui rechargeait la page d'elle-même
 *   dès qu'une nouvelle version était prête, au milieu d'une phrase.
 *
 * On retient les champs de texte que la personne a touchés. Ils sont
 * oubliés dès qu'une écriture réussit (le témoin « Enregistré ✓ »),
 * qu'ils sont vidés ou qu'ils quittent l'écran. Tant qu'il en reste,
 * le navigateur demande confirmation avant de quitter, et la mise à
 * jour attend (voir main.jsx et MiseAJour.jsx).
 *
 * Seuils : trois caractères dans une zone de texte, douze dans un
 * champ d'une ligne — un filtre ou un code tapé dans un champ court
 * n'est pas une saisie à protéger.
 */
const touches = new Set()

function compte(el) {
  if (!el.isConnected) return false
  const n = (el.value ?? '').trim().length
  return el.tagName === 'TEXTAREA' ? n >= 3 : n >= 12
}

export function saisieEnCours() {
  for (const el of [...touches]) {
    if (!el.isConnected) touches.delete(el)
    else if (compte(el)) return true
  }
  return false
}

export function demarrerGardeSaisie() {
  document.addEventListener('input', (e) => {
    const el = e.target
    if (!el || !el.tagName) return
    const texte = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'tel', 'email', 'url', ''].includes(el.type ?? ''))
    if (texte) touches.add(el)
  }, { capture: true, passive: true })
  // Une écriture a réussi : ce qui était tapé est en base (ou n'a plus à être protégé).
  surEcriture(() => touches.clear())
  window.addEventListener('beforeunload', (e) => {
    if (!saisieEnCours()) return
    e.preventDefault()
    e.returnValue = ''
  })
}
