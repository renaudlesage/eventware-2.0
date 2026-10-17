import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * « Bien reçu » — l'accusé de lecture nominatif d'une alerte (122).
 *
 * Repris de BFMF 2026 : le bandeau de crise y portait un bouton que
 * chaque équipe pressait, et le QG lisait « accusés : 4 — Tommy (22:00),
 * Renaud (22:09)… ». Ici, un accusé par membre et par alerte (unique en
 * base) : relire n'est pas ré-accuser, et le PC compte des postes, pas
 * des clics.
 *
 * Partagé par le bandeau du haut (Bandeau.jsx) et la colonne de veille
 * (Veille.jsx), qui portent les mêmes alertes selon la largeur d'écran.
 */
export function useAccuses(evenement, membre) {
  const [mes, setMes] = useState({}) // alerte_id → accuse_le

  async function charger() {
    if (!evenement?.id || !membre?.id) return setMes({})
    const { data } = await supabase
      .from('alertes_accuses')
      .select('alerte_id, accuse_le')
      .eq('evenement_id', evenement.id)
      .eq('membre_id', membre.id)
    setMes(Object.fromEntries((data ?? []).map((x) => [x.alerte_id, x.accuse_le])))
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement?.id, membre?.id])

  async function accuser(alerteId) {
    if (!membre?.id) return
    const quand = new Date().toISOString()
    // Optimiste : le bouton disparaît tout de suite, l'écriture suit.
    setMes((m) => ({ ...m, [alerteId]: quand }))
    const { error } = await supabase
      .from('alertes_accuses')
      .insert({ evenement_id: evenement.id, alerte_id: alerteId, membre_id: membre.id })
    // Doublon (déjà accusé depuis un autre appareil) : c'est bon aussi.
    if (error && error.code !== '23505') charger()
  }

  return { mes, accuser }
}

/** Le bouton, ou la mention « ✓ Lu à HH:MM » une fois pressé. */
export function BienRecu({ alerte, mes, accuser, membre }) {
  if (!membre?.id) return null
  const quand = mes[alerte.id]
  if (quand) {
    return (
      <span className="bien-recu lu">
        ✓ Lu à {new Date(quand).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
      </span>
    )
  }
  return (
    <button className="bien-recu" onClick={() => accuser(alerte.id)} title="Accuser réception, en ton nom">
      Bien reçu
    </button>
  )
}
