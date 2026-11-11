import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * LA CLÔTURE GUIDÉE (169).
 *
 * BFMF 2026 est resté quatre mois en « exploitation » : rien n'invitait
 * à clôturer, alors que les délais appris et le REX automatique en
 * dépendent. Avant de fermer, cet écran dit ce qui reste ouvert —
 * alertes, signalements, demandes, clés non rendues — et ce que la
 * clôture va faire (audios effacés, constats proposés). Les points
 * bloquants se règlent d'abord, ou se passent en connaissance de cause.
 */
const TITRES = { bloquant: 'À régler d’abord', alerte: 'À regarder', info: 'Ce que la clôture fera' }

export default function ClotureGuidee({ evenement, onCloturer, onAnnuler, onAller, occupe }) {
  const [points, setPoints] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [outrepasser, setOutrepasser] = useState(false)

  async function charger() {
    const { data, error } = await supabase.rpc('controle_cloture', { p_evenement: evenement.id })
    if (error) {
      // Serveur sans la migration 169 : on clôture comme avant, sur simple confirmation.
      setErreur(error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '') ? 'absent' : texteErreur(error))
      setPoints([])
    } else {
      setErreur(null)
      setPoints(data ?? [])
    }
  }
  useEffect(() => { charger() }, [evenement.id])

  if (points === null) return <p className="aide" role="status">Vérification de ce qui reste ouvert…</p>

  const bloquants = points.filter((p) => p.gravite === 'bloquant')
  const peutCloturer = !occupe && (bloquants.length === 0 || outrepasser)

  return (
    <div className="cloture-guidee" role="group" aria-label="Avant de clôturer">
      <h3>Avant de clôturer « {evenement.nom} »</h3>
      {erreur && erreur !== 'absent' && <div className="message erreur" role="alert">{erreur}</div>}
      {erreur === 'absent' && <p className="aide">Le contrôle détaillé n’est pas disponible sur ce serveur. La clôture ferme les écritures de terrain et efface les audios du talkie.</p>}

      {['bloquant', 'alerte', 'info'].map((g) => {
        const lignes = points.filter((p) => p.gravite === g)
        if (!lignes.length) return null
        return (
          <div className={`cloture-groupe cloture-${g}`} key={g}>
            <span className="etiquette">{TITRES[g]}</span>
            <ul>
              {lignes.map((p) => (
                <li key={p.code}>
                  <div>
                    <strong>{p.titre}</strong>
                    <span className="aide">{p.detail}</span>
                  </div>
                  {p.ecran && onAller && (
                    <button className="discret" onClick={() => onAller(p.ecran, p.rubrique ?? undefined)}>Voir</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {points.length > 0 && bloquants.length === 0 && !points.some((p) => p.gravite === 'alerte') && (
        <p className="aide" style={{ color: 'var(--etat-ok)' }}>Rien ne reste ouvert : l’événement peut être clôturé.</p>
      )}

      {bloquants.length > 0 && (
        <label className="case-a-cocher">
          <input type="checkbox" checked={outrepasser} onChange={(e) => setOutrepasser(e.target.checked)} />
          Clôturer quand même, en laissant {bloquants.length > 1 ? `ces ${bloquants.length} points ouverts` : 'ce point ouvert'}
        </label>
      )}
      <div className="ligne-boutons">
        <button disabled={!peutCloturer} onClick={onCloturer}>{occupe ? 'Clôture…' : 'Clôturer l’événement'}</button>
        <button className="discret" onClick={charger} disabled={occupe}>Revérifier</button>
        <button className="discret" onClick={onAnnuler} disabled={occupe}>Annuler</button>
      </div>
    </div>
  )
}

/** Vrai si l'événement est terminé depuis plus de deux jours sans être clôturé. */
export function joursDepuisFin(evenement) {
  const fin = evenement?.date_demontage || evenement?.date_fin || evenement?.date_debut
  if (!fin || evenement.phase === 'cloture') return 0
  const jours = Math.floor((Date.now() - new Date(fin + 'T23:59:59').getTime()) / 86400000)
  return jours > 2 ? jours : 0
}
