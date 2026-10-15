import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Pendant la saisie d'une demande, demande à la base s'il existe déjà
 * un doublon, une demande à compléter ou un besoin récurrent
 * (fonction `missions_similaires`, migration 116, module livré par Ren
 * le 15/10 — calibré sur les 68 demandes de BFMF 2026).
 * Interroge au plus toutes les 400 ms, à partir de 4 caractères. Hors
 * ligne ou en erreur : pas de suggestion, jamais de blocage.
 */
export function useDemandesSimilaires({ evenementId, titre, description, lieuId, missionId }) {
  const [suggestions, setSuggestions] = useState([])

  useEffect(() => {
    if (!evenementId || !titre || titre.trim().length < 4) {
      setSuggestions([])
      return
    }
    let annule = false
    const minuteur = setTimeout(async () => {
      const { data, error } = await supabase.rpc('missions_similaires', {
        p_evenement: evenementId,
        p_titre: titre,
        p_description: description || null,
        p_lieu_id: lieuId || null,
        p_exclure: missionId || null
      })
      if (!annule) setSuggestions(error ? [] : data || [])
    }, 400)
    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [evenementId, titre, description, lieuId, missionId])

  return suggestions
}
