import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { ecrireOuEmpiler } from './fileEcritures'

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
    const { data, error } = await supabase
      .from('alertes_accuses')
      .select('alerte_id, accuse_le')
      .eq('evenement_id', evenement.id)
      .eq('membre_id', membre.id)
    // (audit C4) Une lecture ratée ne fait pas réapparaître un bouton déjà pressé.
    if (error) return
    setMes((m) => ({ ...m, ...Object.fromEntries((data ?? []).map((x) => [x.alerte_id, x.accuse_le])) }))
  }

  useEffect(() => {
    setMes({})
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement?.id, membre?.id])

  async function accuser(alerteId) {
    if (!membre?.id) return
    const quand = new Date().toISOString()
    // Optimiste : le bouton disparaît tout de suite, l'écriture suit — tout de
    // suite si le réseau répond, par la file sinon (un doublon est un succès).
    setMes((m) => ({ ...m, [alerteId]: quand }))
    const r = await ecrireOuEmpiler({
      nature: 'insert',
      table: 'alertes_accuses',
      champs: { evenement_id: evenement.id, alerte_id: alerteId, membre_id: membre.id },
      doublonOk: true,
      libelle: 'Accusé de réception d’une alerte'
    })
    if (r.statut === 'refus') setMes((m) => { const n = { ...m }; delete n[alerteId]; return n })
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
