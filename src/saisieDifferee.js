import { useEffect, useRef } from 'react'

/**
 * Saisie différée qui ne perd rien (11/11, audit M12).
 *
 * Un champ de texte attend un instant de silence avant d'enregistrer,
 * pour ne pas écrire à chaque frappe. Les trois écrans du dossier
 * (formulaire communal, PRIMA, notification DMP) annulaient ce qui
 * attendait quand on quittait l'écran : la dernière saisie était
 * perdue si on changeait de rubrique dans la seconde.
 *
 * Ici, ce qui attend part tout de suite quand l'écran se ferme, quand
 * l'onglet passe en arrière-plan ou quand la page se décharge.
 *
 *   const { planifier } = useSaisieDifferee()
 *   planifier('nom-du-champ', () => enregistrer(valeur), 900)
 */
export function useSaisieDifferee() {
  const attente = useRef(new Map()) // clef → { minuterie, action }

  function planifier(clef, action, delai = 900) {
    const deja = attente.current.get(clef)
    if (deja) clearTimeout(deja.minuterie)
    const minuterie = setTimeout(() => {
      attente.current.delete(clef)
      action()
    }, delai)
    attente.current.set(clef, { minuterie, action })
  }

  /** Oublie ce qui attendait pour cette clef, sans l'envoyer. */
  function annuler(clef) {
    const deja = attente.current.get(clef)
    if (deja) clearTimeout(deja.minuterie)
    attente.current.delete(clef)
  }

  function vider() {
    const tout = [...attente.current.values()]
    attente.current.clear()
    for (const a of tout) {
      clearTimeout(a.minuterie)
      try {
        a.action()
      } catch {
        /* une écriture qui casse ne retient pas les autres */
      }
    }
  }

  useEffect(() => {
    const surCache = () => { if (document.visibilityState === 'hidden') vider() }
    window.addEventListener('pagehide', vider)
    document.addEventListener('visibilitychange', surCache)
    return () => {
      window.removeEventListener('pagehide', vider)
      document.removeEventListener('visibilitychange', surCache)
      vider()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { planifier, annuler, vider, enAttente: () => attente.current.size }
}
