import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { useSaisieDifferee } from './saisieDifferee'

/**
 * GRILLE PRIMA DE LA CoAMU (164).
 *
 * L'évaluation du risque médical d'une manifestation, telle que la
 * CoAMU la fait (Plan Risques et Manifestations, v1.0 janvier 2024) :
 * les entrées de la grille, pré-remplies par ce qu'Eventware sait,
 * complétées ici ; le score de risque et sa zone (faible, moyen,
 * élevé, avis d'office) ; le niveau du dispositif médical préventif
 * (1 à 5) et sa composition d'après le mémento. Le calcul est fait en
 * base (`calcul_prima`), avec la provenance de chaque entrée.
 */
const ZONES = {
  incomplet: ['À compléter', 'veille'], extremement_faible: ['Extrêmement faible', 'ok'], faible: ['Faible', 'ok'],
  moyen: ['Moyen — informer la CoAMU', 'veille'], eleve: ['Élevé — avis CoAMU demandé', 'chaud'], avis_office: ['Avis CoAMU d\'office', 'chaud']
}
const SOURCES = { saisie: null, eventware: 'Eventware', defaut: 'par défaut' }
const CHOIX = [
  // [colonne de prima_saisies, clé des entrées, famille du référentiel, libellé, section]
  ['type_evenement', 'type_evenement', 'type_evenement', 'Type d’événement', 'Nature de l’événement'],
  ['cloture', 'cloture', 'cloture', 'Clôture', 'Configuration des lieux'],
  ['surface', 'surface', 'surface', 'Surface ou distance', 'Configuration des lieux'],
  ['structure', 'structure', 'structure', 'Structures', 'Configuration des lieux'],
  ['infrastructure', 'infrastructure', 'infrastructure', 'Infrastructures', 'Configuration des lieux'],
  ['certitude', 'certitude', 'certitude', 'Certitude globale', 'Certitude'],
  ['type_public', 'type_public', 'type_public', 'Type de public', 'Spectateurs'],
  ['age_spectateurs', 'age_spectateurs', 'age', 'Catégorie d’âge', 'Spectateurs'],
  ['groupes_risque', 'groupes_risque', 'groupes_risque', 'Groupes à risque', 'Spectateurs'],
  ['densite', 'densite', 'densite', 'Densité maximale', 'Spectateurs'],
  ['type_actifs', 'type_actifs', 'type_actifs', 'Type de participants actifs', 'Participants actifs'],
  ['age_actifs', 'age_actifs', 'age', 'Catégorie d’âge des actifs', 'Participants actifs'],
  ['violence', 'violence', 'violence', 'Violence', 'Risques particuliers'],
  ['alcool', 'alcool', 'alcool', 'Alcool et/ou drogue', 'Risques particuliers'],
  ['meteo', 'meteo', 'meteo', 'Relation météo – nombre de victimes', 'Risques particuliers']
]
const NOMBRES = [
  ['spectateurs', 'Spectateurs (présents en même temps)', 'Spectateurs'],
  ['actifs', 'Participants actifs (sportifs, artistes, manifestants…)', 'Participants actifs'],
  ['vip', 'Personnalités (acteurs, chanteurs, sportifs connus…)', 'Personnalités'],
  ['duree_h', 'Heures par jour', 'Durée et moment']
]
const MOMENTS = [['journee', 'Journée'], ['soiree', 'Soirée'], ['nuit', 'Nuit'], ['multijour', 'Multi-jour']]
const SECTIONS = ['Nature de l’événement', 'Durée et moment', 'Configuration des lieux', 'Certitude', 'Spectateurs', 'Participants actifs', 'Personnalités', 'Risques particuliers']

export function Prima({ evenement, peut, toutPouvoir, setMessage, onChange, onLienCoamu }) {
  const [calcul, setCalcul] = useState(null)
  const [referentiel, setReferentiel] = useState([])
  const [erreur, setErreur] = useState(null)
  const [detail, setDetail] = useState(false)
  const [brouillons, setBrouillons] = useState({})
  const { planifier } = useSaisieDifferee()
  const peutSaisir = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger() {
    const { data, error } = await supabase.rpc('calcul_prima', { p_evenement: evenement.id })
    if (error) return setErreur(texteErreur(error))
    setErreur(null)
    setCalcul(Array.isArray(data) ? data[0] : data)
  }
  useEffect(() => {
    supabase.from('prima_referentiel').select('famille, code, libelle, groupe, coefficient, scoring').order('famille').order('code').then(({ data }) => setReferentiel(data ?? []))
    charger()
  }, [evenement.id])

  async function enregistrer(champs) {
    const { error } = await supabase.from('prima_saisies').upsert({ evenement_id: evenement.id, ...champs }, { onConflict: 'evenement_id' })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setBrouillons((b) => { const n = { ...b }; Object.keys(champs).forEach((k) => delete n[k]); return n })
    await charger()
    onChange?.()
  }
  // Les nombres attendent une seconde de silence ; les choix partent tout de suite.
  function changer(champ, valeur, differe = false) {
    setBrouillons((b) => ({ ...b, [champ]: valeur }))
    planifier(champ, () => enregistrer({ [champ]: valeur }), differe ? 900 : 0)
  }

  if (erreur) return <p className="aide">Grille PRIMA : {erreur}</p>
  if (!calcul) return null

  const e = calcul.entrees ?? {}
  const [zoneLibelle, zoneTon] = ZONES[calcul.zone] ?? [calcul.zone, 'veille']
  const options = (famille) => referentiel.filter((r) => r.famille === famille)
  const badge = (entree) => entree?.source && SOURCES[entree.source] ? <span className="prc-jeton prima-source" title={entree.source === 'eventware' ? 'déduit des données Eventware' : 'valeur par défaut de la grille, à confirmer'}>{SOURCES[entree.source]}</span> : null
  const valeurChoix = (champ, cle) => (champ in brouillons ? brouillons[champ] : e[cle]?.code) ?? ''
  const valeurNombre = (champ) => (champ in brouillons ? brouillons[champ] : e[champ]?.valeur) ?? ''

  return (
    <div className="prima">
      <div className="pave-titre">Grille PRIMA de la CoAMU — risque médical et dispositif préventif</div>
      <p className="prima-resume">
        <span className={`prc-jeton ${zoneTon}`}>{zoneLibelle}</span>
        {calcul.score != null && <strong> score {calcul.score}</strong>}
        {calcul.niveau != null && <strong> · niveau {calcul.niveau} : {calcul.dispositif}</strong>}
        {calcul.scoring?.total != null && <span className="aide"> ({calcul.scoring.total} points)</span>}
      </p>
      <p className={`aide prima-message ${zoneTon}`}>{calcul.message}</p>
      {calcul.avis_coamu && onLienCoamu && (
        <p className="aide">La CoAMU rend un avis : <button className="lien" onClick={onLienCoamu}>ouvrir un lien d'avis CoAMU</button> — dossier et grille via le coordinateur PLANU entre 90 et 60 jours avant l'événement.</p>
      )}
      {calcul.composition && <p className="aide prima-composition">{calcul.composition}</p>}
      {(calcul.a_confirmer ?? []).length > 0 && (
        <p className="aide">À confirmer : {calcul.a_confirmer.map((k) => ({ type_evenement: 'le type d’événement', spectateurs: 'le nombre de spectateurs', duree_h: 'la durée' })[k] ?? k).join(', ')}.</p>
      )}

      <table className="tableau prima-entrees">
        <tbody>
          {SECTIONS.map((section) => (
            <Section key={section} titre={section}>
              {section === 'Durée et moment' && (
                <tr>
                  <td>Moments</td>
                  <td>
                    <div className="prima-moments">
                      {MOMENTS.map(([k, l]) => (
                        <label key={k}>
                          <input type="checkbox" checked={!!(k in brouillons ? brouillons[k] : e.moments?.[k])} disabled={!peutSaisir} onChange={(ev) => changer(k, ev.target.checked)} />
                          {l}
                        </label>
                      ))}
                      {badge(e.moments)}
                    </div>
                  </td>
                </tr>
              )}
              {NOMBRES.filter(([, , s]) => s === section).map(([champ, libelle]) => (
                <tr key={champ}>
                  <td>{libelle}</td>
                  <td>
                    <input type="number" min="0" step={champ === 'duree_h' ? '0.5' : '1'} className="prima-nombre" value={valeurNombre(champ)} disabled={!peutSaisir}
                      onChange={(ev) => changer(champ, ev.target.value === '' ? null : Number(ev.target.value), true)} />
                    {badge(e[champ])}
                  </td>
                </tr>
              ))}
              {CHOIX.filter(([, , , , s]) => s === section).map(([champ, cle, famille, libelle]) => (
                <tr key={champ} className={e[cle]?.source === 'defaut' && champ === 'type_evenement' ? 'manquante' : ''}>
                  <td>{libelle}</td>
                  <td>
                    <select value={valeurChoix(champ, cle)} disabled={!peutSaisir} onChange={(ev) => changer(champ, ev.target.value === '' ? null : Number(ev.target.value))}>
                      <option value="">{champ === 'type_evenement' ? '— à choisir —' : '—'}</option>
                      {famille === 'type_evenement'
                        ? [...new Set(options(famille).map((o) => o.groupe))].map((g) => (
                          <optgroup key={g} label={g}>
                            {options(famille).filter((o) => o.groupe === g).map((o) => <option key={o.code} value={o.code}>{o.libelle} (×{o.coefficient})</option>)}
                          </optgroup>
                        ))
                        : options(famille).map((o) => <option key={o.code} value={o.code}>{o.libelle} (×{o.coefficient})</option>)}
                    </select>
                    {badge(e[cle])}
                  </td>
                </tr>
              ))}
              {section === 'Risques particuliers' && (
                <tr>
                  <td>Impact important sur les riverains ?</td>
                  <td>
                    <label className="prima-case">
                      <input type="checkbox" checked={!!('impact_riverains' in brouillons ? brouillons.impact_riverains : e.impact_riverains?.valeur)} disabled={!peutSaisir} onChange={(ev) => changer('impact_riverains', ev.target.checked)} />
                      oui (accès des secours publics, nuisances) — avis d'office
                    </label>
                  </td>
                </tr>
              )}
            </Section>
          ))}
        </tbody>
      </table>
      <textarea className="prima-remarques" rows={2} placeholder="Remarques pour la CoAMU" defaultValue={calcul.remarques ?? ''} disabled={!peutSaisir}
        onBlur={(ev) => (ev.target.value || null) !== (calcul.remarques ?? null) && enregistrer({ remarques: ev.target.value || null })} />

      <button className="discret" onClick={() => setDetail(!detail)}>{detail ? 'Masquer le détail du calcul' : 'Détail du calcul'}</button>
      {detail && (
        <div className="prima-detail">
          <div className="pave-titre">Facteurs du score (×)</div>
          <table className="tableau">
            <tbody>
              {Object.entries(calcul.facteurs ?? {}).map(([k, v]) => (
                <tr key={k}><td>{({ type: 'Type d’événement', duree: 'Durée', moment: 'Moment', lieux: 'Lieux (clôture × surface × structures × infrastructures)', certitude: 'Certitude', spectateurs: 'Spectateurs pondérés', actifs: 'Actifs pondérés', vip: 'Personnalités', risques: 'Risques (violence × alcool × météo)' })[k] ?? k}</td><td className="mono prima-points">{v ?? '—'}</td></tr>
              ))}
              <tr><td>Score = (spectateurs + actifs) × type × durée × moment × lieux × certitude × VIP × risques / 10 000</td><td className="mono prima-points">{calcul.score ?? '—'}</td></tr>
            </tbody>
          </table>
          <div className="pave-titre">Scoring du niveau (somme)</div>
          <table className="tableau">
            <tbody>
              {(calcul.scoring?.details ?? []).map((d) => <tr key={d.critere}><td>{d.critere}</td><td className="mono prima-points">{d.points ?? '—'}</td></tr>)}
              <tr><td><strong>Total</strong></td><td className="mono prima-points"><strong>{calcul.scoring?.total ?? '—'}</strong></td></tr>
              {(calcul.scoring?.seuils ?? []).map((s) => <tr key={s.niveau} className={s.niveau === calcul.niveau ? 'applique' : ''}><td className="aide">≥ {s.seuil} : niveau {s.niveau}</td><td className="aide">{s.dispositif}</td></tr>)}
            </tbody>
          </table>
          <p className="aide">{calcul.version}. Un avis de la CoAMU est toujours possible en cas de doute.</p>
        </div>
      )}
    </div>
  )
}

function Section({ titre, children }) {
  return (
    <>
      <tr className="prima-section"><th colSpan={2}>{titre}</th></tr>
      {children}
    </>
  )
}
