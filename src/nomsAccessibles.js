/**
 * Filet de noms accessibles (11/11, audit M18).
 *
 * Plusieurs centaines de champs et de listes n'ont pas de libellé relié :
 * un texte d'exemple, une colonne de tableau ou un mot posé juste avant
 * leur tient lieu d'étiquette pour qui voit l'écran, pas pour un lecteur
 * d'écran. Les écrans les plus utilisés ont été corrigés à la source ;
 * ce filet nomme ce qui reste, à partir de ce que l'écran montre déjà.
 *
 * Il ne remplace jamais un nom existant, et ne s'applique qu'aux champs
 * qui n'en ont aucun.
 */
const CHAMPS = 'input:not([type="hidden"]), select, textarea'
const PAR_TYPE = { date: 'Date', 'datetime-local': 'Date et heure', time: 'Heure', number: 'Nombre', file: 'Fichier à choisir', search: 'Rechercher', tel: 'Téléphone', email: 'Adresse e-mail', range: 'Réglage' }

function nomme(el) {
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.title) return true
  if (el.closest('label')) return true
  if (el.id && document.querySelector(`label[for="${window.CSS?.escape ? CSS.escape(el.id) : el.id}"]`)) return true
  return false
}

function deviner(el) {
  const propre = (t) => (t ?? '').replace(/\s+/g, ' ').trim().replace(/[\s:*—–-]+$/, '')
  if (el.placeholder) return propre(el.placeholder)
  // Le mot posé juste avant le champ.
  const avant = el.previousElementSibling
  if (avant && /^(LABEL|SPAN|STRONG|B)$/.test(avant.tagName)) {
    const t = propre(avant.textContent)
    if (t && t.length <= 60) return t
  }
  // L'en-tête de la colonne, dans un tableau.
  const cellule = el.closest('td')
  if (cellule) {
    const rang = [...cellule.parentElement.children].indexOf(cellule)
    const entete = cellule.closest('table')?.querySelector(`thead tr:last-child > *:nth-child(${rang + 1})`)
    const t = propre(entete?.textContent)
    if (t) return t
  }
  if (el.tagName === 'SELECT' && el.options.length) {
    const choix = [...el.options].slice(0, 3).map((o) => propre(o.text)).filter(Boolean)
    if (choix.length) return `Choisir : ${choix.join(', ')}${el.options.length > 3 ? '…' : ''}`
  }
  return PAR_TYPE[el.type] ?? null
}

function passer(racine) {
  for (const el of racine.querySelectorAll(CHAMPS)) {
    if (el.dataset.nomAuto || nomme(el)) continue
    const nom = deviner(el)
    if (nom) {
      el.setAttribute('aria-label', nom)
      el.dataset.nomAuto = '1'
    }
  }
}

export function demarrerNomsAccessibles() {
  if (typeof window === 'undefined' || !window.MutationObserver) return
  let prevu = null
  const planifier = () => {
    if (prevu) return
    prevu = setTimeout(() => {
      prevu = null
      passer(document.body)
    }, 250)
  }
  new MutationObserver(planifier).observe(document.body, { childList: true, subtree: true })
  planifier()
}
