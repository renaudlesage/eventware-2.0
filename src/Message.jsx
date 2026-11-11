import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Le message d'un écran (11/11, audit M12).
 *
 * Chaque écran affichait son retour dans un bloc à lui : une
 * confirmation restait à l'écran jusqu'au geste suivant, parfois des
 * minutes, et rien ne permettait de l'écarter ; une erreur arrivée
 * hors de vue ne se voyait pas.
 *
 *   <Message message={message} onFermer={() => setMessage(null)} />
 *
 * — une confirmation ou une information s'efface seule après huit
 *   secondes (le temps de la lire, pas celui de l'oublier) ;
 * — une ERREUR reste jusqu'à ce qu'on la ferme : elle dit qu'un geste
 *   n'a pas été fait ;
 * — toutes se ferment d'un bouton, et une erreur hors de l'écran s'y
 *   ramène.
 */
const DUREE_MS = 8000

export default function Message({ message, onFermer, role }) {
  const ref = useRef(null)
  const fermer = useRef(onFermer)
  fermer.current = onFermer
  const erreur = message?.type === 'erreur'

  useEffect(() => {
    if (!message) return undefined
    if (erreur) {
      const el = ref.current
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return undefined
    }
    const t = setTimeout(() => fermer.current?.(), DUREE_MS)
    return () => clearTimeout(t)
  }, [message, erreur])

  if (!message) return null
  return (
    <div ref={ref} role={role ?? (erreur ? 'alert' : 'status')} className={`message ${erreur ? 'erreur' : ''} ${onFermer ? 'fermable' : ''}`}>
      <span className="message-texte">{message.texte}</span>
      {onFermer && (
        <button type="button" className="message-fermer" aria-label="Fermer le message" onClick={onFermer}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
