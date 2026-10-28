import { useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import { STATUTS_JALON } from './jalons'
import { Palette } from './couleurs.jsx'

/**
 * Ce qu'un jalon a gagné avec le Gantt (129) : un début, un avancement,
 * des dépendances (« doit attendre ») et sa marge. Partagé par le
 * Gantt (fiche d'un jalon cliqué) et par Préparation (sous chaque
 * ligne), pour ne pas tenir deux formulaires à jour.
 *
 * `lignes` : tous les jalons de l'événement (candidats prédécesseurs) ;
 * `liens` : les jalon_dependances de l'événement ; `info` : la ligne de
 * gantt() pour ce jalon (marge, chemin critique), facultative.
 */

const heureLocale = (iso) => (iso ? new Date(iso) : null)
const aDate = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')

/** Une date saisie (jj/mm/aaaa) garde l'heure que le jalon avait, sinon celle par défaut. */
function avecHeure(valeur, ancienne, heureDefaut) {
  if (!valeur) return null
  const [y, m, d] = valeur.split('-').map(Number)
  const base = ancienne ? new Date(ancienne) : null
  const h = base ? base.getHours() : heureDefaut
  const mi = base ? base.getMinutes() : 0
  return new Date(y, m - 1, d, h, mi).toISOString()
}

/** Les jalons qui dépendent (directement ou non) de `id` : ils ne peuvent pas le précéder. */
export function descendantsDe(id, liens) {
  const vus = new Set()
  const file = [id]
  while (file.length) {
    const cur = file.pop()
    for (const l of liens) if (l.precede_id === cur && !vus.has(l.jalon_id)) { vus.add(l.jalon_id); file.push(l.jalon_id) }
  }
  return vus
}

export default function FicheJalon({ jalon, lignes = [], liens = [], info, evenement, peutModifier, membres, onFait, onFermer, setMessage, statut = false }) {
  const [precede, setPrecede] = useState('')
  const [decalage, setDecalage] = useState(0)
  const [occupe, setOccupe] = useState(false)

  const debut = heureLocale(jalon.debut)
  const fin = heureLocale(jalon.echeance ?? jalon.fin)
  const parId = Object.fromEntries(lignes.map((l) => [l.id, l]))
  const mesLiens = liens.filter((l) => l.jalon_id === jalon.id)
  const suivants = liens.filter((l) => l.precede_id === jalon.id)
  const interdits = descendantsDe(jalon.id, liens)
  const candidats = lignes.filter((l) => l.id !== jalon.id && !interdits.has(l.id) && !mesLiens.some((m) => m.precede_id === l.id))

  async function modifier(champs) {
    const refus = await modifierOuRefuser('jalons', champs, { id: jalon.id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else onFait?.()
  }
  async function lier() {
    if (!precede || occupe) return
    setOccupe(true)
    const { error } = await supabase.from('jalon_dependances').insert({
      evenement_id: evenement.id, jalon_id: jalon.id, precede_id: precede, decalage_j: Number(decalage) || 0
    })
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else { setPrecede(''); setDecalage(0); onFait?.() }
    setOccupe(false)
  }
  async function changerDecalage(l, valeur) {
    const refus = await modifierOuRefuser('jalon_dependances', { decalage_j: Number(valeur) || 0 }, { id: l.id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else onFait?.()
  }
  async function delier(l) {
    // Une dépendance se supprime vraiment (pas de deleted_at) : ce n'est
    // pas une donnée métier à auditer.
    const { error, count } = await supabase.from('jalon_dependances').delete({ count: 'exact' }).eq('id', l.id)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage?.({ type: 'erreur', texte: 'Suppression refusée : droits insuffisants.' })
    else onFait?.()
  }

  const marge = info?.marge_j
  const lecture = !peutModifier

  return (
    <div className="fiche-jalon">
      {onFermer && (
        <div className="fiche-jalon-tete">
          <strong><span className="mono">{jalon.code}</span> {jalon.libelle}</strong>
          {jalon.groupe_nom && <span className="sourdine"> · {jalon.groupe_nom}</span>}
          <button className="discret" onClick={onFermer} aria-label="Fermer la fiche">✕</button>
        </div>
      )}
      <div className="fiche-jalon-champs">
        {statut && (
          <label>Statut
            <select value={jalon.statut} disabled={lecture} onChange={(e) => modifier({ statut: e.target.value })}>
              {STATUTS_JALON.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
        <label>Début
          <input type="date" value={aDate(debut)} disabled={lecture}
            onChange={(e) => modifier({ debut: avecHeure(e.target.value, jalon.debut, 9) })}
            title="Vide : jalon ponctuel (losange sur le Gantt)" />
        </label>
        <label>Fin
          <input type="date" value={aDate(fin)} disabled={lecture}
            onChange={(e) => e.target.value && modifier({ echeance: avecHeure(e.target.value, jalon.echeance ?? jalon.fin, 17) })} />
        </label>
        <label>Avancement
          <span className="fiche-jalon-avancement">
            <input type="range" min={0} max={100} step={5} value={jalon.avancement ?? 0} disabled={lecture}
              onChange={(e) => modifier({ avancement: Number(e.target.value) })} />
            <span className="mono">{jalon.avancement ?? 0} %</span>
          </span>
        </label>
        {statut && membres && (
          <label>Responsable
            <select value={jalon.responsable_membre_id ?? ''} disabled={lecture} onChange={(e) => modifier({ responsable_membre_id: e.target.value || null })}>
              <option value="">— personne —</option>
              {membres.map((m) => <option key={m.id} value={m.id}>{m.nom_affiche ?? 'sans nom'}</option>)}
            </select>
          </label>
        )}
        {/* (146) Une couleur propre sur le Gantt ; « × » : celle du groupe. */}
        <label title="Remplissage de la barre sur le Gantt ; le contour garde le statut">Couleur
          <Palette valeur={jalon.couleur} onChoisir={(c) => modifier({ couleur: c })} aucune="celle du groupe" disabled={lecture} />
        </label>
      </div>
      {marge != null && (
        <p className={`aide fiche-jalon-marge ${info.sur_chemin_critique ? 'alerte-texte' : ''}`} style={{ margin: '4px 0' }}>
          {info.sur_chemin_critique ? 'Sur le chemin critique : tout retard repousse le jour J.' : marge < 0 ? `En retard de ${-marge} j sur le jour J.` : `Marge ${marge} j avant de peser sur le jour J.`}
        </p>
      )}
      <div className="fiche-jalon-liens">
        <span className="sourdine">Doit attendre :</span>
        {mesLiens.length === 0 && <span className="sourdine"> rien</span>}
        {mesLiens.map((l) => (
          <span key={l.id} className="fiche-jalon-lien">
            {parId[l.precede_id] ? `${parId[l.precede_id].code} ${parId[l.precede_id].libelle}` : 'jalon'}
            {lecture ? (l.decalage_j ? ` +${l.decalage_j} j` : '') : (
              <>
                {' +'}
                <input type="number" min={0} className="fiche-jalon-decalage" defaultValue={l.decalage_j}
                  onBlur={(e) => Number(e.target.value) !== l.decalage_j && changerDecalage(l, e.target.value)} aria-label="Battement en jours" />
                {' j'}
                <button className="discret" onClick={() => delier(l)} title="Retirer la dépendance" aria-label="Retirer la dépendance">✕</button>
              </>
            )}
          </span>
        ))}
        {!lecture && candidats.length > 0 && (
          <span className="fiche-jalon-ajout">
            <select value={precede} onChange={(e) => setPrecede(e.target.value)} aria-label="Jalon à attendre">
              <option value="">+ attendre…</option>
              {candidats.map((l) => <option key={l.id} value={l.id}>{l.code} {l.libelle}</option>)}
            </select>
            <input type="number" min={0} value={decalage} onChange={(e) => setDecalage(e.target.value)} className="fiche-jalon-decalage" aria-label="Battement en jours" />
            <span className="sourdine"> j</span>
            <button className="discret" disabled={!precede || occupe} onClick={lier}>Lier</button>
          </span>
        )}
      </div>
      {suivants.length > 0 && (
        <p className="aide" style={{ margin: '2px 0 0' }}>
          Attendu par : {suivants.map((l) => parId[l.jalon_id]?.code ?? '?').join(', ')}
        </p>
      )}
    </div>
  )
}
