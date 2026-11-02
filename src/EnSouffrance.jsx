import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * EN SOUFFRANCE — les demandes qui attendent plus que d'habitude (154).
 *
 * Au BFMF 2026, 4 demandes P1 ont été closes sans aucune trace de prise
 * en charge, jusqu'à 130 min après leur création : rien ne mesurait
 * l'attente. Ce bandeau lit `missions_en_souffrance(evenement)` chaque
 * minute : une demande « à traiter », ni attribuée ni démarrée, y entre
 * quand son attente dépasse le délai sous lequel 9 demandes sur 10 de
 * même priorité ont été prises en charge lors des événements clos
 * (P1 : 15 min sur l'historique actuel). Rien ne s'affiche tant que
 * tout va bien.
 *
 * Usage : <EnSouffrance evenementId={evenement.id} onOuvrir={(m) => …} />
 * en tête de la Situation (tous modules) ou d'une liste de demandes
 * (`module` = 'securite' ou 'logistique' : seulement les siennes).
 */
export default function EnSouffrance({ evenementId, module, onOuvrir }) {
  const [liste, setListe] = useState([])
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    if (!evenementId) return undefined
    let actif = true
    async function lire() {
      const { data, error } = await supabase.rpc('missions_en_souffrance', { p_evenement: evenementId })
      if (!actif) return
      if (error) { setErreur(texteErreur(error)); return }
      setErreur(null)
      setListe(data ?? [])
    }
    lire()
    const minuteur = setInterval(lire, 60000)
    const canal = supabase
      .channel(`souffrance-${evenementId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'missions', filter: `evenement_id=eq.${evenementId}` }, lire)
      .subscribe()
    return () => { actif = false; clearInterval(minuteur); supabase.removeChannel(canal) }
  }, [evenementId])

  if (erreur) return <p className="aide">Demandes en souffrance : {erreur}</p>
  const visibles = module ? liste.filter((m) => m.module === module) : liste
  if (!visibles.length) return null

  const p1 = visibles.some((m) => m.priorite === 'P1')
  return (
    <section className={`bandeau-alerte en-souffrance ${p1 ? 'niv-urgence' : 'niv-vigilance'}`} role="status" aria-live="polite">
      <div className="niv">Attente</div>
      <div className="contenu">
        <strong>
          {visibles.length === 1 ? '1 demande attend' : `${visibles.length} demandes attendent`} plus que d'habitude
        </strong>
        <ul className="souffrance-liste">
          {visibles.map((m) => (
            <li key={m.mission_id}>
              <button type="button" className="discret" onClick={() => onOuvrir?.(m)}>
                <span className={`prc-jeton ${m.priorite === 'P1' ? 'chaud' : 'veille'}`}>{m.priorite}</span>{' '}
                {m.reference} · {m.titre} · <strong>{m.attente_min} min</strong>
                <span className="aide"> (habituel : moins de {m.seuil_min} min)</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
