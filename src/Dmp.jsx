import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * DISPOSITIF MÉDICAL PRÉVENTIF (DMP, 160, étape 5).
 *
 * Le score et le niveau (1 à 5) de la manifestation selon la grille
 * applicable, critère par critère : ce qui vient du public attendu, ce
 * qui vient du questionnaire, ce qui se coche ici. Aux niveaux qui
 * appellent l'avis de la CoAMU, un lien d'avis se propose. La grille
 * elle-même (critères, points, seuils) se modifie par formulaire : la
 * grille partagée par l'exploitant, une grille d'organisation par qui
 * gère les données d'organisation.
 */
const SOURCES = { frequentation: 'public attendu', conformite: 'questionnaire', manuel: 'à cocher' }

export function Dmp({ evenement, peut, toutPouvoir, setMessage, onLienCoamu }) {
  const [calcul, setCalcul] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [grille, setGrille] = useState(false)
  const peutCocher = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger() {
    const { data, error } = await supabase.rpc('calcul_dmp', { p_evenement: evenement.id })
    if (error) return setErreur(texteErreur(error))
    setErreur(null)
    setCalcul(Array.isArray(data) ? data[0] : data)
  }
  useEffect(() => { charger() }, [evenement.id])

  async function cocher(critere, coche) {
    const { error } = await supabase.from('dmp_reponses').upsert({ evenement_id: evenement.id, critere_id: critere.id, coche }, { onConflict: 'evenement_id,critere_id' })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    charger()
  }

  if (erreur) return <p className="aide">DMP : {erreur}</p>
  if (!calcul) return null
  if (!calcul.grille) return <p className="aide">Aucune grille DMP applicable à cette province.</p>

  const familles = [...new Set((calcul.details ?? []).map((d) => d.famille))]
  return (
    <div className="dmp">
      <div className="pave-titre">Dispositif médical préventif — {calcul.grille.libelle}</div>
      <p className="dmp-resume">
        <strong>{calcul.score} points → niveau {calcul.niveau ?? '?'}</strong>
        {calcul.avis_coamu && <span className="prc-jeton chaud" style={{ marginLeft: 8 }}>avis CoAMU requis</span>}
        {calcul.points_a_saisir > 0 && <span className="aide"> · {calcul.points_a_saisir} critère{calcul.points_a_saisir > 1 ? 's' : ''} sans points : la grille est à compléter</span>}
      </p>
      {calcul.avis_coamu && onLienCoamu && (
        <p className="aide">Aux niveaux 4 et 5, la CoAMU rend un avis : <button className="lien" onClick={onLienCoamu}>ouvrir un lien d'avis CoAMU</button>.</p>
      )}
      <table className="tableau dmp-criteres">
        <tbody>
          {familles.map((f) => (
            <>
              <tr key={f} className="dmp-famille"><th colSpan={3}>{f}</th></tr>
              {(calcul.details ?? []).filter((d) => d.famille === f).map((d) => (
                <tr key={d.id} className={d.applique ? 'applique' : ''}>
                  <td>
                    {d.source === 'manuel' && peutCocher ? (
                      <label><input type="checkbox" checked={!!d.applique} onChange={(e) => cocher(d, e.target.checked)} /> {d.libelle}</label>
                    ) : (
                      <>{d.applique ? '☑' : '☐'} {d.libelle}</>
                    )}
                  </td>
                  <td className="aide">{SOURCES[d.source]}</td>
                  <td className="mono dmp-points">{d.points > 0 ? `+${d.points}` : d.points}</td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
      <button className="discret" onClick={() => setGrille(!grille)}>{grille ? 'Fermer la grille' : 'Modifier la grille'}</button>
      {grille && <GrilleDmp grilleId={calcul.grille.id} organisation={evenement.organisation_id} evenement={evenement} setMessage={setMessage} onFait={charger} />}
    </div>
  )
}

/** L'éditeur de la grille : critères, points, seuils. */
export function GrilleDmp({ grilleId, organisation, evenement, setMessage, onFait }) {
  const [criteres, setCriteres] = useState([])
  const [seuils, setSeuils] = useState([])
  const [editable, setEditable] = useState(false)
  const [nouveau, setNouveau] = useState({ code: '', libelle: '', famille: '', source: 'manuel', condition_cle: '', seuil_min: '', seuil_max: '', points: 0 })

  async function charger() {
    const [c, s, e] = await Promise.all([
      supabase.from('grille_dmp_criteres').select('*').eq('grille_id', grilleId).order('ordre').order('code'),
      supabase.from('grille_dmp_seuils').select('*').eq('grille_id', grilleId).order('niveau'),
      supabase.rpc('peut_editer_grille_dmp', { p_grille: grilleId })
    ])
    setCriteres(c.data ?? [])
    setSeuils(s.data ?? [])
    setEditable(Array.isArray(e.data) ? !!e.data[0] : !!e.data)
  }
  useEffect(() => { charger() }, [grilleId])

  async function majCritere(id, champs) {
    const { error } = await supabase.from('grille_dmp_criteres').update(champs).eq('id', id)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    charger(); onFait?.()
  }
  async function supprimerCritere(c) {
    if (!window.confirm(`Retirer le critère « ${c.libelle} » de la grille ?`)) return
    const { error } = await supabase.from('grille_dmp_criteres').delete().eq('id', c.id)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    charger(); onFait?.()
  }
  async function ajouter() {
    if (!nouveau.code.trim() || !nouveau.libelle.trim() || !nouveau.famille.trim()) return
    const { error } = await supabase.from('grille_dmp_criteres').insert({
      grille_id: grilleId, code: nouveau.code.trim().toUpperCase(), libelle: nouveau.libelle.trim(), famille: nouveau.famille.trim(),
      source: nouveau.source, condition_cle: nouveau.source === 'conformite' ? nouveau.condition_cle.trim() || null : null,
      seuil_min: nouveau.source === 'frequentation' && nouveau.seuil_min !== '' ? Number(nouveau.seuil_min) : null,
      seuil_max: nouveau.source === 'frequentation' && nouveau.seuil_max !== '' ? Number(nouveau.seuil_max) : null,
      points: Number(nouveau.points) || 0, ordre: (criteres.at(-1)?.ordre ?? 0) + 10
    })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setNouveau({ code: '', libelle: '', famille: '', source: 'manuel', condition_cle: '', seuil_min: '', seuil_max: '', points: 0 })
    charger(); onFait?.()
  }
  async function majSeuil(id, champs) {
    const { error } = await supabase.from('grille_dmp_seuils').update(champs).eq('id', id)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    charger(); onFait?.()
  }
  async function copierPourOrganisation() {
    if (!organisation || !window.confirm('Créer une grille propre à votre organisation, copiée de celle-ci ? Elle prendra le pas sur la grille partagée.')) return
    const { data: g, error } = await supabase.from('grilles_dmp').insert({ code: `ORG-${organisation.slice(0, 8)}-${Date.now().toString(36)}`, libelle: 'Grille DMP de l’organisation', province: evenement.province ?? null, organisation_id: organisation, version: new Date().getFullYear().toString() }).select('id').single()
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    await supabase.from('grille_dmp_seuils').insert(seuils.map((s) => ({ grille_id: g.id, niveau: s.niveau, score_min: s.score_min, score_max: s.score_max, avis_coamu: s.avis_coamu })))
    await supabase.from('grille_dmp_criteres').insert(criteres.map((c) => ({ grille_id: g.id, code: c.code, libelle: c.libelle, famille: c.famille, source: c.source, condition_cle: c.condition_cle, seuil_min: c.seuil_min, seuil_max: c.seuil_max, points: c.points, ordre: c.ordre })))
    setMessage({ type: 'succes', texte: 'Grille de l’organisation créée.' })
    onFait?.()
  }

  return (
    <div className="grille-dmp">
      {!editable && <p className="aide">Grille partagée : seul l'exploitant la modifie. {organisation && <button className="lien" onClick={copierPourOrganisation}>En faire une copie pour mon organisation</button>}</p>}
      <table className="tableau">
        <thead><tr><th>Code</th><th>Critère</th><th>Famille</th><th>Source</th><th>Condition</th><th>Points</th>{editable && <th></th>}</tr></thead>
        <tbody>
          {criteres.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.code}</td>
              <td>{c.libelle}</td>
              <td>{c.famille}</td>
              <td>{SOURCES[c.source]}</td>
              <td className="aide">{c.source === 'conformite' ? c.condition_cle : c.source === 'frequentation' ? `${c.seuil_min ?? '…'} – ${c.seuil_max ?? '…'}` : ''}</td>
              <td>{editable ? <input type="number" className="dmp-points-saisie" defaultValue={c.points} onBlur={(e) => Number(e.target.value) !== c.points && majCritere(c.id, { points: Number(e.target.value) || 0 })} /> : c.points}</td>
              {editable && <td><button className="discret" onClick={() => supprimerCritere(c)} aria-label="Retirer">×</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div className="formulaire grille-dmp-ajout">
          <div className="saisie-rapide">
            <input value={nouveau.code} placeholder="Code" onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })} style={{ flex: '0 1 110px' }} />
            <input value={nouveau.libelle} placeholder="Critère" onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} />
            <input value={nouveau.famille} placeholder="Famille" onChange={(e) => setNouveau({ ...nouveau, famille: e.target.value })} style={{ flex: '0 1 160px' }} />
          </div>
          <div className="saisie-rapide">
            <select value={nouveau.source} onChange={(e) => setNouveau({ ...nouveau, source: e.target.value })} aria-label="Source">
              <option value="manuel">à cocher</option><option value="conformite">questionnaire</option><option value="frequentation">public attendu</option>
            </select>
            {nouveau.source === 'conformite' && <input value={nouveau.condition_cle} placeholder="groupe.critere — ex. structure.chapiteau" onChange={(e) => setNouveau({ ...nouveau, condition_cle: e.target.value })} />}
            {nouveau.source === 'frequentation' && (<>
              <input type="number" value={nouveau.seuil_min} placeholder="de" onChange={(e) => setNouveau({ ...nouveau, seuil_min: e.target.value })} style={{ flex: '0 1 90px' }} />
              <input type="number" value={nouveau.seuil_max} placeholder="à" onChange={(e) => setNouveau({ ...nouveau, seuil_max: e.target.value })} style={{ flex: '0 1 90px' }} />
            </>)}
            <input type="number" value={nouveau.points} onChange={(e) => setNouveau({ ...nouveau, points: e.target.value })} aria-label="Points" style={{ flex: '0 1 80px' }} />
            <button className="discret" onClick={ajouter} disabled={!nouveau.code.trim() || !nouveau.libelle.trim() || !nouveau.famille.trim()}>+ Critère</button>
          </div>
        </div>
      )}
      <div className="pave-titre">Seuils</div>
      <table className="tableau">
        <thead><tr><th>Niveau</th><th>De</th><th>À</th><th>Avis CoAMU</th></tr></thead>
        <tbody>
          {seuils.map((s) => (
            <tr key={s.id}>
              <td>{s.niveau}</td>
              <td>{editable ? <input type="number" className="dmp-points-saisie" defaultValue={s.score_min} onBlur={(e) => Number(e.target.value) !== s.score_min && majSeuil(s.id, { score_min: Number(e.target.value) })} /> : s.score_min}</td>
              <td>{editable ? <input type="number" className="dmp-points-saisie" defaultValue={s.score_max ?? ''} placeholder="∞" onBlur={(e) => (e.target.value === '' ? null : Number(e.target.value)) !== s.score_max && majSeuil(s.id, { score_max: e.target.value === '' ? null : Number(e.target.value) })} /> : (s.score_max ?? '∞')}</td>
              <td>{editable ? <input type="checkbox" checked={s.avis_coamu} onChange={(e) => majSeuil(s.id, { avis_coamu: e.target.checked })} /> : (s.avis_coamu ? 'oui' : 'non')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
