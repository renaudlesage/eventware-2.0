import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Un drapeau qui retombe tout seul : « Enregistré ✓ », « Copié ».
 *
 * Remplace huit `setTimeout(() => setX(false), 2500)` qui survivaient
 * au démontage de leur composant (audit du 19/09) : le minuteur est
 * annulé si l'écran se ferme, et relancé si on enregistre deux fois de
 * suite (le drapeau ne retombe pas au milieu du second).
 */
export function useDrapeau(duree = 2500) {
  const [leve, setLeve] = useState(false)
  const minuteur = useRef(null)

  useEffect(() => () => clearTimeout(minuteur.current), [])

  const lever = useCallback(() => {
    setLeve(true)
    clearTimeout(minuteur.current)
    minuteur.current = setTimeout(() => setLeve(false), duree)
  }, [duree])

  return [leve, lever]
}
