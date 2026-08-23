import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Capacités de l'utilisateur sur un événement, pour la phase courante.
 *
 * L'interface se compose désormais d'après ce que la personne PEUT
 * faire, et non d'après le nom de son rôle. C'est ce qui permet à un
 * rôle inventé par un client — « Chef d'étape », « Régisseur » —
 * d'obtenir ses écrans sans qu'une ligne de code soit écrite.
 *
 * Ce n'est qu'une couche d'affichage : les données restent protégées
 * par RLS quoi qu'il arrive.
 */
export function useCapacites(evenementId, phase) {
  const [capacites, setCapacites] = useState(null)
  const [toutPouvoir, setToutPouvoir] = useState(false)

  useEffect(() => {
    let vivant = true
    if (!evenementId) return

    Promise.all([
      supabase.rpc('mes_capacites', { p_evenement: evenementId }),
      supabase.rpc('a_tout_pouvoir', { p_evenement: evenementId })
    ]).then(([c, t]) => {
      if (!vivant) return
      setCapacites(new Set((c.data ?? []).map((x) => `${x.ressource}:${x.action}`)))
      setToutPouvoir(t.data === true)
    })

    return () => {
      vivant = false
    }
  }, [evenementId, phase])

  // Tant que les capacités ne sont pas chargées, on n'affiche rien de
  // plus que le strict minimum : mieux vaut un écran incomplet une
  // seconde qu'un écran qui apparaît puis disparaît.
  const peut = (ressource, action = 'lire') =>
    capacites ? capacites.has(`${ressource}:${action}`) : false

  return { capacites, peut, toutPouvoir, pret: capacites !== null }
}
