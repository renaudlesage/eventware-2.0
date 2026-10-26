import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import { euros } from './Fournisseurs'
import { VERDICTS_FOURNISSEUR, libelleVerdict } from './referentielsProduit'

/**
 * (130) Évaluer les fournisseurs de l'événement — dans Analyse / REX,
 * seul endroit où l'on note : une ligne par fournisseur retenu, une
 * note 1–5, un verdict, un commentaire. Un clic, une ligne. La note
 * remonte dans l'annuaire et dans la grille de comparaison des
 * prochaines demandes. Disponible dès le démontage.
 */
export default function EvaluationsFournisseurs({ evenement, peut, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState(null)
  const peutEvaluer = toutPouvoir || peut?.('analyse', 'creer')
  const trop_tot = ['preparation', 'montage', 'exploitation'].includes(evenement.phase)

  async function charger() {
    const [c, e] = await Promise.all([
      supabase.from('consultations').select('id, fournisseur_id, montant_ht, taux_tva, demandes_prix(reference, objet), fournisseurs(nom)')
        .eq('evenement_id', evenement.id).eq('statut', 'retenue').is('deleted_at', null),
      supabase.from('fournisseur_evaluations').select('*').eq('evenement_id', evenement.id).is('deleted_at', null)
    ])
    if (c.error) setMessage({ type: 'erreur', texte: texteErreur(c.error) })
    const evals = Object.fromEntries((e.data ?? []).map((x) => [x.fournisseur_id, x]))
    // Un fournisseur retenu sur deux demandes : une seule ligne.
    const parF = new Map()
    for (const x of c.data ?? []) {
      const f = parF.get(x.fournisseur_id) ?? { fournisseur_id: x.fournisseur_id, nom: x.fournisseurs?.nom, demandes: [], total: 0 }
      f.demandes.push(x.demandes_prix?.reference)
      f.total += Number(x.montant_ht ?? 0)
      parF.set(x.fournisseur_id, f)
    }
    setLignes([...parF.values()].map((f) => ({ ...f, evaluation: evals[f.fournisseur_id] ?? null })))
  }
  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  async function noter(f, champs) {
    const e = f.evaluation
    if (e) {
      const refus = await modifierOuRefuser('fournisseur_evaluations', champs, { id: e.id })
      if (refus) setMessage({ type: 'erreur', texte: refus })
      else charger()
    } else {
      const { error } = await supabase.from('fournisseur_evaluations').insert({
        fournisseur_id: f.fournisseur_id, evenement_id: evenement.id, note: champs.note ?? 3, verdict: champs.verdict ?? 'a_reprendre', commentaire: champs.commentaire ?? null
      })
      if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
      else charger()
    }
  }

  if (lignes === null) return null
  return (
    <section className="bloc four-evaluations">
      <h2>Fournisseurs de l'événement</h2>
      {trop_tot && <p className="aide">L'évaluation s'ouvre au démontage ; on note une fois la prestation faite.</p>}
      {lignes.length === 0 ? (
        <p className="vide">Aucun fournisseur retenu sur cet événement (Logistique › Demandes de prix).</p>
      ) : (
        <table className="tableau">
          <thead><tr><th>Fournisseur</th><th>Demandes</th><th>Retenu HT</th><th>Note</th><th>Verdict</th><th>Commentaire</th></tr></thead>
          <tbody>
            {lignes.map((f) => {
              const e = f.evaluation
              const lecture = !peutEvaluer || trop_tot
              return (
                <tr key={f.fournisseur_id}>
                  <td><strong>{f.nom}</strong></td>
                  <td className="mono">{f.demandes.join(', ')}</td>
                  <td className="mono">{euros(f.total)}</td>
                  <td className="four-etoiles">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} className="lien" disabled={lecture} onClick={() => noter(f, { note: n })} title={`${n} / 5`}>{e && n <= e.note ? '★' : '☆'}</button>
                    ))}
                  </td>
                  <td>
                    {lecture ? (e ? libelleVerdict(e.verdict) : '—') : (
                      <select value={e?.verdict ?? ''} onChange={(ev) => ev.target.value && noter(f, { verdict: ev.target.value })} style={{ width: 'auto', marginBottom: 0 }}>
                        <option value="">—</option>
                        {VERDICTS_FOURNISSEUR.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    {lecture ? (e?.commentaire ?? '') : (
                      <input defaultValue={e?.commentaire ?? ''} placeholder="ponctualité, matériel, contact…" disabled={!e}
                        onBlur={(ev) => e && (ev.target.value || null) !== (e.commentaire ?? null) && noter(f, { commentaire: ev.target.value || null })} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
