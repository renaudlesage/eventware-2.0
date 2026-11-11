import { useEffect, useState } from 'react'

/**
 * « Une nouvelle version est prête » (11/11, audit M14).
 *
 * La mise à jour de l'application rechargeait la page d'elle-même. Elle
 * le fait toujours quand rien n'est en cours de saisie ; sinon elle
 * attend ici qu'on ait fini, et se lance d'un bouton.
 */
export default function MiseAJour() {
  const [prete, setPrete] = useState(false)
  useEffect(() => {
    const montrer = () => setPrete(true)
    window.addEventListener('eventware:maj', montrer)
    return () => window.removeEventListener('eventware:maj', montrer)
  }, [])
  if (!prete) return null
  return (
    <div className="mise-a-jour" role="status">
      <span>Une nouvelle version d'Eventware est prête. Termine ta saisie, puis mets à jour.</span>
      <button onClick={() => window.location.reload()}>Mettre à jour</button>
    </div>
  )
}
