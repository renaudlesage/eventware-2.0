import { useEffect, useRef } from 'react'

/**
 * Un tiroir qui se comporte comme un dialogue (11/11, audit M18).
 *
 * Les tiroirs (SOS, Mayday, constat, « Plus », demande depuis un vocal,
 * information du talkie) étaient de simples blocs par-dessus la page :
 * pas de rôle, pas de fermeture au clavier, et le focus restait dessous.
 *
 *   const tiroir = useTiroir(ouvert, fermer)
 *   <div className="tiroir" {...tiroir} aria-label="Signaler un incident">
 *
 * À l'ouverture, le focus entre dans le tiroir (sauf si un champ l'a
 * déjà pris) ; Échap ferme ; Tab tourne à l'intérieur ; à la fermeture,
 * le focus revient au bouton qui avait ouvert.
 */
const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useTiroir(ouvert, fermer) {
  const ref = useRef(null)
  const fermerRef = useRef(fermer)
  fermerRef.current = fermer

  useEffect(() => {
    if (!ouvert) return undefined
    const avant = document.activeElement
    const entrer = setTimeout(() => {
      const el = ref.current
      if (el && !el.contains(document.activeElement)) el.focus()
    }, 0)
    const surTouche = (e) => {
      const el = ref.current
      if (e.key === 'Escape') {
        e.stopPropagation()
        fermerRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const f = [...el.querySelectorAll(FOCUSABLES)].filter((x) => x.offsetParent !== null)
      if (!f.length) return
      const premier = f[0]
      const dernier = f[f.length - 1]
      if (e.shiftKey && (document.activeElement === premier || document.activeElement === el)) {
        e.preventDefault()
        dernier.focus()
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault()
        premier.focus()
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => {
      clearTimeout(entrer)
      document.removeEventListener('keydown', surTouche)
      if (avant && typeof avant.focus === 'function' && document.contains(avant)) avant.focus()
    }
  }, [ouvert])

  return { ref, role: 'dialog', 'aria-modal': 'true', tabIndex: -1 }
}
