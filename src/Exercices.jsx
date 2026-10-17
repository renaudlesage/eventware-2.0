import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * Exercice sur mesure, v1 « sur table » (120, 16/10 — concept FERRU).
 *
 * L'outil lit ce que l'événement a encodé et en tire un exercice qui
 * teste ce dispositif-là : le contrôle avant-vol relève les écarts de
 * configuration, le générateur choisit des trames selon les objectifs,
 * remplit les champs avec les vrais lieux, canaux, groupes et seuils, et
 * glisse les écarts en pièges. Trois temps dans l'écran :
 *   Avant-vol  — les écarts, à corriger ou à jouer ;
 *   Exercices  — cadrer et générer, puis la page d'animation (conducteur,
 *                chronomètre, textes à lire, grille d'actions attendues) ;
 *   Clore      — écarts constatés, actions correctives, synthèse imprimable.
 * Rien ici ne touche aux vraies données : la v2 (dans l'outil, bac à
 * sable) viendra avec `dupliquer_evenement` et l'origine 'exercice'.
 */

const FORMATS = [
  ['table', 'Sur table', 'La page d’animation sert de conducteur ; le QG joue à voix haute. Zéro risque.'],
  ['alerte', 'Exercice d’alerte', 'Court : rappel du personnel, test des numéros et des canaux encodés.'],
  ['outil', 'Dans l’outil (v2)', 'Les stimuli tombent dans un bac à sable. Pas encore disponible.']
]
const CANAUX = { radio: 'Radio', telephone: 'Téléphone', temoin: 'Témoin', meteo: 'Météo', outil: 'Outil', '112': '112' }
const fr = (d) => (d ? new Date(d).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const mm = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function Exercices({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [onglet, setOnglet] = useState('exercices')
  const [ecarts, setEcarts] = useState(null)
  const [liste, setListe] = useState([])
  const [ouvert, setOuvert] = useState(null)
  const [creer, setCreer] = useState(false)
  const peutCreer = toutPouvoir || peut?.('exercices', 'creer')
  const peutModifier = toutPouvoir || peut?.('exercices', 'modifier')

  async function chargerAvantVol() {
    const { data, error } = await supabase.rpc('avant_vol', { p_evenement: evenement.id })
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else setEcarts(data ?? [])
  }
  async function chargerListe() {
    const { data, error } = await supabase.from('exercices').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('created_at', { ascending: false })
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else setListe(data ?? [])
  }
  useEffect(() => {
    chargerAvantVol()
    chargerListe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  const chauds = (ecarts ?? []).filter((e) => e.gravite === 'chaud').length

  if (ouvert) {
    return (
      <Exercice
        id={ouvert}
        evenement={evenement}
        membre={membre}
        peutModifier={peutModifier}
        setMessage={setMessage}
        onRetour={() => {
          setOuvert(null)
          chargerListe()
        }}
      />
    )
  }

  return (
    <div className="exo">
      <div className="onglets">
        {[
          ['exercices', `Exercices (${liste.length})`],
          ['avantvol', `Avant-vol (${ecarts?.length ?? '…'})`]
        ].map(([k, l]) => (
          <button key={k} className={`module ${onglet === k ? 'actif' : ''}`} onClick={() => setOnglet(k)}>{l}</button>
        ))}
      </div>

      {onglet === 'avantvol' && (
        <section>
          <div className="etat prc-cadrans">
            <Cadran libelle="À corriger" v={chauds} etat={chauds ? 'chaud' : ''} />
            <Cadran libelle="À vérifier" v={(ecarts?.length ?? 0) - chauds} etat={(ecarts?.length ?? 0) - chauds ? 'veille' : ''} />
            <Cadran libelle="Jouables en exercice" v={(ecarts ?? []).filter((e) => e.stimulus).length} />
          </div>
          {ecarts && ecarts.length === 0 && <p className="aide">Rien à signaler : le dispositif encodé est cohérent sur ce que l'avant-vol sait vérifier.</p>}
          <div className="prc-liste">
            {(ecarts ?? []).map((e, i) => (
              <div key={i} className="prc-ligne exo-ecart">
                <span className={`prc-jeton ${e.gravite}`}>{e.titre}</span>
                <span>
                  {e.detail}
                  <span className="sourdine exo-source"> — {e.table_source}{e.objectif ? ` · objectif ${e.objectif}` : ''}</span>
                  {e.stimulus && <span className="exo-stimulus-apercu">« {e.stimulus} »</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="aide">
            Requêtes déterministes sur ce qui est encodé : chaque écart cite sa table. Ce qui est corrigé disparaît au prochain passage ;
            ce qui reste devient un piège dans le prochain exercice généré. Rien ne remplace la relecture du dossier de sécurité.
          </p>
        </section>
      )}

      {onglet === 'exercices' && (
        <section>
          {peutCreer && (
            <div className="actions-missions">
              <button className="action-creer" onClick={() => setCreer((v) => !v)}>{creer ? 'Fermer' : '+ Nouvel exercice'}</button>
            </div>
          )}
          {creer && (
            <Cadrer
              evenement={evenement}
              ecarts={ecarts ?? []}
              setMessage={setMessage}
              onFait={(id) => {
                setCreer(false)
                chargerListe()
                setOuvert(id)
              }}
            />
          )}
          {liste.length === 0 ? (
            <p className="vide">Aucun exercice. Cadre-en un : l'outil le génère depuis le dispositif encodé.</p>
          ) : (
            <div className="prc-liste">
              {liste.map((x) => (
                <button key={x.id} className="prc-ligne exo-item" onClick={() => setOuvert(x.id)}>
                  <span className={`prc-jeton ${x.statut === 'en_cours' ? 'chaud' : x.statut === 'termine' ? '' : 'veille'}`}>
                    {x.statut === 'preparation' ? 'préparation' : x.statut === 'en_cours' ? 'en cours' : 'terminé'}
                  </span>
                  <strong>{x.titre}</strong>
                  <span className="sourdine">{FORMATS.find(([k]) => k === x.format)?.[1]} · {x.duree_min} min{x.date_prevue ? ` · ${fr(x.date_prevue)}` : ''}</span>
                  <span className="ligne-mission-chevron">›</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cadrer et générer                                                   */

function Cadrer({ evenement, ecarts, setMessage, onFait }) {
  const [catalogue, setCatalogue] = useState([])
  const [titre, setTitre] = useState(`Exercice ${evenement.nom}`)
  const [format, setFormat] = useState('table')
  const [duree, setDuree] = useState(90)
  const [date, setDate] = useState('')
  const [choisis, setChoisis] = useState(() => new Set(['ALERTE', 'MISSION', 'SECOURS', 'RADIO']))
  const [pieges, setPieges] = useState(4)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    supabase.rpc('exercice_objectifs_catalogue').then(({ data }) => setCatalogue(data ?? []))
  }, [])

  // Les objectifs qu'au moins un écart de l'avant-vol servirait : proposés en premier.
  const suggeres = useMemo(() => new Set(ecarts.map((e) => e.objectif).filter(Boolean)), [ecarts])

  function basculer(code) {
    setChoisis((s) => {
      const n = new Set(s)
      n.has(code) ? n.delete(code) : n.add(code)
      return n
    })
  }

  async function generer() {
    if (choisis.size < 2) {
      setMessage?.({ type: 'erreur', texte: 'Choisis au moins deux objectifs.' })
      return
    }
    setOccupe(true)
    const { data, error } = await supabase.rpc('generer_exercice', {
      p_evenement: evenement.id,
      p_titre: titre.trim() || `Exercice ${evenement.nom}`,
      p_format: format,
      p_duree_min: Number(duree),
      p_objectifs: [...choisis],
      p_date: date ? new Date(date).toISOString() : null,
      p_max_pieges: Number(pieges)
    })
    setOccupe(false)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else onFait(data)
  }

  return (
    <div className="formulaire">
      <div className="pave-titre" style={{ marginTop: 0 }}>Cadrer l'exercice</div>
      <label htmlFor="exo-titre">Titre</label>
      <input id="exo-titre" value={titre} onChange={(e) => setTitre(e.target.value)} />
      <div className="saisie-rapide">
        <div style={{ flex: 1 }}>
          <label htmlFor="exo-format">Format</label>
          <select id="exo-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map(([k, l]) => <option key={k} value={k} disabled={k === 'outil'}>{l}</option>)}
          </select>
          <p className="aide" style={{ marginTop: 4 }}>{FORMATS.find(([k]) => k === format)?.[2]}</p>
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="exo-duree">Durée (min)</label>
          <select id="exo-duree" value={duree} onChange={(e) => setDuree(e.target.value)}>
            {[45, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="exo-date">Date prévue</label>
          <input id="exo-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label>Objectifs (2 à 6) — ceux marqués ● correspondent à des écarts trouvés par l'avant-vol</label>
      <div className="exo-objectifs">
        {catalogue.map((o) => (
          <label key={o.code} className={`impl-calque ${choisis.has(o.code) ? '' : 'masque'}`}>
            <input type="checkbox" checked={choisis.has(o.code)} onChange={() => basculer(o.code)} disabled={!choisis.has(o.code) && choisis.size >= 6} />
            {suggeres.has(o.code) && <span className="exo-point">●</span>}
            <strong>{o.code}</strong> {o.intitule} <span className="mono">{o.discipline}</span>
          </label>
        ))}
      </div>
      <label htmlFor="exo-pieges">Pièges issus de l'avant-vol</label>
      <select id="exo-pieges" value={pieges} onChange={(e) => setPieges(e.target.value)}>
        {[0, 2, 4, 6].map((n) => <option key={n} value={n}>{n === 0 ? 'Aucun' : n}</option>)}
      </select>
      <p className="aide">
        Le générateur choisit 2 à 4 trames selon la durée et les objectifs, les remplit avec les lieux, canaux, groupes et seuils encodés,
        et place les pièges entre les stimuli. Tu pourras tout relire, réécrire ou retirer avant de jouer.
      </p>
      <button disabled={occupe} onClick={generer} style={{ marginTop: 8 }}>{occupe ? 'Génération…' : 'Générer l’exercice'}</button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un exercice : conducteur, grille, écarts, synthèse                   */

function Exercice({ id, evenement, membre, peutModifier, setMessage, onRetour }) {
  const [x, setX] = useState(null)
  const [objectifs, setObjectifs] = useState([])
  const [stimuli, setStimuli] = useState([])
  const [actions, setActions] = useState([])
  const [sources, setSources] = useState([])
  const [observations, setObservations] = useState([])
  const [ecarts, setEcarts] = useState([])
  const [vue, setVue] = useState('conducteur')
  const [notes, setNotes] = useState(false)
  const [tic, setTic] = useState(0)
  const [edition, setEdition] = useState(null) // stimulus en cours de réécriture

  async function charger() {
    const [a, b, c, d, e] = await Promise.all([
      supabase.from('exercices').select('*').eq('id', id).single(),
      supabase.from('exercice_objectifs').select('*').eq('exercice_id', id).order('ordre'),
      supabase.from('exercice_stimuli').select('*').eq('exercice_id', id).order('ordre'),
      supabase.from('exercice_observations').select('*').eq('exercice_id', id),
      supabase.from('exercice_ecarts').select('*').eq('exercice_id', id).order('created_at')
    ])
    const err = [a, b, c, d, e].find((r) => r.error)?.error
    if (err) {
      setMessage?.({ type: 'erreur', texte: texteErreur(err) })
      return
    }
    setX(a.data)
    setObjectifs(b.data ?? [])
    setStimuli(c.data ?? [])
    setObservations(d.data ?? [])
    setEcarts(e.data ?? [])
    const ids = (c.data ?? []).map((s) => s.id)
    if (ids.length) {
      const [{ data: acts }, { data: srcs }] = await Promise.all([
        supabase.from('exercice_actions_attendues').select('*').in('stimulus_id', ids).order('ordre'),
        supabase.from('exercice_sources').select('*').in('stimulus_id', ids)
      ])
      setActions(acts ?? [])
      setSources(srcs ?? [])
    } else {
      setActions([])
      setSources([])
    }
  }
  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Chronomètre : une seconde, tant que l'exercice est en cours.
  useEffect(() => {
    if (x?.statut !== 'en_cours') return
    const t = setInterval(() => setTic((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [x?.statut])

  const ecoule = x?.debut_reel ? Math.max(0, (Date.now() - new Date(x.debut_reel).getTime()) / 1000) : 0
  const objectifParId = Object.fromEntries(objectifs.map((o) => [o.id, o]))
  const obsParAction = useMemo(() => {
    const m = new Map()
    for (const o of observations) m.set(o.action_id, o)
    return m
  }, [observations])
  const sourcesParStimulus = useMemo(() => {
    const m = new Map()
    for (const s of sources) m.set(s.stimulus_id, [...(m.get(s.stimulus_id) ?? []), s])
    return m
  }, [sources])

  async function majExercice(champs) {
    const refus = await modifierOuRefuser('exercices', champs, { id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else charger()
  }
  async function lancer(s) {
    const refus = await modifierOuRefuser('exercice_stimuli', { statut: 'lance', lance_le: new Date().toISOString() }, { id: s.id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else charger()
  }
  async function annulerStimulus(s) {
    const refus = await modifierOuRefuser('exercice_stimuli', { statut: s.statut === 'annule' ? 'prevu' : 'annule' }, { id: s.id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else charger()
  }
  async function enregistrerStimulus(s, champs) {
    const refus = await modifierOuRefuser('exercice_stimuli', champs, { id: s.id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else {
      setEdition(null)
      charger()
    }
  }
  async function observer(action, faite, note) {
    const existante = obsParAction.get(action.id)
    const ligne = { exercice_id: id, action_id: action.id, faite, note: note ?? existante?.note ?? null, observe_par: membre?.nom_affiche ?? null, observe_le: new Date().toISOString() }
    const { error } = existante
      ? await supabase.from('exercice_observations').update(ligne).eq('id', existante.id)
      : await supabase.from('exercice_observations').insert(ligne)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else charger()
  }
  async function ajouterEcart(constat, action_id = null) {
    const { error } = await supabase.from('exercice_ecarts').insert({ exercice_id: id, action_id, constat, created_by: membre?.user_id ?? null })
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else charger()
  }
  async function majEcart(e, champs) {
    const refus = await modifierOuRefuser('exercice_ecarts', champs, { id: e.id })
    if (refus) setMessage?.({ type: 'erreur', texte: refus })
    else charger()
  }

  function imprimer() {
    document.body.classList.add('impression-exercice')
    setTimeout(() => {
      window.print()
      setTimeout(() => document.body.classList.remove('impression-exercice'), 300)
    }, 200)
  }

  if (!x) return <p className="aide">Chargement…</p>

  const lances = stimuli.filter((s) => s.statut === 'lance').length
  const actives = actions.filter((a) => stimuli.find((s) => s.id === a.stimulus_id)?.statut !== 'annule')
  const faites = actives.filter((a) => obsParAction.get(a.id)?.faite === true).length
  const manquees = actives.filter((a) => obsParAction.get(a.id)?.faite === false)
  const prochain = stimuli.find((s) => s.statut === 'prevu')

  return (
    <div className="exo exo-fiche">
      <div className="impl-barre">
        <div className="ligne-boutons">
          <button className="discret" onClick={onRetour}>‹ Exercices</button>
          <span className={`prc-jeton ${x.statut === 'en_cours' ? 'chaud' : x.statut === 'termine' ? '' : 'veille'}`}>
            {x.statut === 'preparation' ? 'préparation' : x.statut === 'en_cours' ? 'en cours' : 'terminé'}
          </span>
          {x.statut === 'en_cours' && <span className="mono exo-chrono">{mm(ecoule)}</span>}
          {peutModifier && x.statut === 'preparation' && (
            <button onClick={() => { if (window.confirm('Démarrer l’exercice ? Le chronomètre part maintenant.')) majExercice({ statut: 'en_cours', debut_reel: new Date().toISOString() }) }}>Démarrer</button>
          )}
          {peutModifier && x.statut === 'en_cours' && (
            <button onClick={() => { if (window.confirm('Terminer l’exercice ? Il devient une preuve figée.')) majExercice({ statut: 'termine', fin_reel: new Date().toISOString() }) }}>Terminer</button>
          )}
          <button className="discret" onClick={imprimer}>Imprimer</button>
        </div>
        <div className="onglets">
          {[
            ['conducteur', `Conducteur (${lances}/${stimuli.length})`],
            ['objectifs', `Objectifs (${objectifs.length})`],
            ['ecarts', `Écarts (${ecarts.length})`],
            ['synthese', 'Synthèse']
          ].map(([k, l]) => (
            <button key={k} className={`module ${vue === k ? 'actif' : ''}`} onClick={() => setVue(k)}>{l}</button>
          ))}
        </div>
      </div>

      <h2 className="exo-titre">{x.titre} <span className="sourdine">— {evenement.nom} · {FORMATS.find(([k]) => k === x.format)?.[1]} · {x.duree_min} min</span></h2>

      {vue === 'conducteur' && (
        <section>
          <div className="exo-bandeau-exercice">EXERCICE — aucun de ces messages n'est réel. Préfixer chaque annonce par « Exercice, exercice ».</div>
          <div className="ligne-boutons">
            <label className="case-a-cocher"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Notes de l'animateur</label>
            {prochain && x.statut === 'en_cours' && (
              <span className="aide" style={{ margin: 0 }}>
                Prochain : t+{prochain.t_min} min{ecoule / 60 >= prochain.t_min ? ' — c’est le moment' : ` (dans ${Math.ceil(prochain.t_min - ecoule / 60)} min)`}
              </span>
            )}
          </div>
          <div className="exo-stimuli">
            {stimuli.map((s) => {
              const acts = actions.filter((a) => a.stimulus_id === s.id)
              const src = sourcesParStimulus.get(s.id) ?? []
              const enRetard = x.statut === 'en_cours' && s.statut === 'prevu' && ecoule / 60 >= s.t_min
              return (
                <article key={s.id} className={`exo-stimulus ${s.statut} ${s.piege ? 'piege' : ''} ${enRetard ? 'a-lancer' : ''}`}>
                  <header className="exo-stimulus-tete">
                    <span className="mono exo-t">t+{String(s.t_min).padStart(2, '0')}</span>
                    <span className="prc-jeton">{CANAUX[s.canal] ?? s.canal ?? '—'}</span>
                    <span className="exo-emetteur">{s.emetteur}</span>
                    {s.piege && <span className="prc-jeton veille">piège</span>}
                    {s.statut === 'lance' && <span className="sourdine mono">lancé {new Date(s.lance_le).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>}
                    {s.statut === 'annule' && <span className="sourdine">retiré</span>}
                    <span style={{ marginLeft: 'auto' }} className="ligne-boutons exo-actions-stimulus">
                      {peutModifier && x.statut === 'en_cours' && s.statut === 'prevu' && <button onClick={() => lancer(s)}>Lancer</button>}
                      {peutModifier && x.statut !== 'termine' && <button className="discret" onClick={() => setEdition(edition === s.id ? null : s.id)}>Réécrire</button>}
                      {peutModifier && x.statut !== 'termine' && s.statut !== 'lance' && <button className="discret" onClick={() => annulerStimulus(s)}>{s.statut === 'annule' ? 'Remettre' : 'Retirer'}</button>}
                    </span>
                  </header>
                  {edition === s.id ? (
                    <EditionStimulus s={s} onAnnuler={() => setEdition(null)} onEnregistrer={(champs) => enregistrerStimulus(s, champs)} />
                  ) : (
                    <p className="exo-texte">{s.texte}</p>
                  )}
                  {notes && s.note_animateur && <p className="exo-note">{s.note_animateur}</p>}
                  {notes && src.length > 0 && (
                    <p className="exo-sources">
                      Inspiré de : {src.map((q) => q.table_source === 'exercice_trames' ? `trame ${q.code_controle}` : `${q.code_controle}${q.detail ? ` (${q.detail})` : ''}`).join(' · ')}
                    </p>
                  )}
                  {acts.length > 0 && s.statut !== 'annule' && (
                    <ul className="exo-grille">
                      {acts.map((a) => {
                        const o = obsParAction.get(a.id)
                        return (
                          <li key={a.id} className={o?.faite === true ? 'faite' : o?.faite === false ? 'manquee' : ''}>
                            <span className="exo-coches">
                              <button className={`exo-coche ${o?.faite === true ? 'oui' : ''}`} disabled={!peutModifier || x.statut === 'preparation'} onClick={() => observer(a, true)} aria-label="Fait">✓</button>
                              <button className={`exo-coche ${o?.faite === false ? 'non' : ''}`} disabled={!peutModifier || x.statut === 'preparation'} onClick={() => observer(a, false)} aria-label="Pas fait">✗</button>
                            </span>
                            <span className="exo-action">
                              {a.action}
                              {a.outil && <span className="sourdine"> — {a.outil}</span>}
                              {a.objectif_id && objectifParId[a.objectif_id] && <span className="mono exo-obj"> {objectifParId[a.objectif_id].code}</span>}
                              {a.critere_auto && <span className="sourdine exo-critere"> · v2 : {a.critere_auto}</span>}
                            </span>
                            {o?.faite === false && x.statut !== 'preparation' && peutModifier && !ecarts.some((e) => e.action_id === a.id) && (
                              <button className="discret" onClick={() => ajouterEcart(`${a.action} — non fait${o.observe_par ? ` (observé par ${o.observe_par})` : ''}`, a.id)}>→ écart</button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </article>
              )
            })}
          </div>
          {x.statut === 'preparation' && <p className="aide">Relis, réécris ou retire ce qui ne convient pas (un piège trop sensible, un ton à ajuster). La grille se coche une fois l'exercice démarré.</p>}
        </section>
      )}

      {vue === 'objectifs' && (
        <section>
          <div className="prc-liste">
            {objectifs.map((o) => {
              const acts = actives.filter((a) => a.objectif_id === o.id)
              const ok = acts.filter((a) => obsParAction.get(a.id)?.faite === true).length
              const ko = acts.filter((a) => obsParAction.get(a.id)?.faite === false).length
              return (
                <div key={o.id} className="prc-ligne">
                  <span className="prc-jeton">{o.code}</span>
                  <span>{o.intitule} <span className="sourdine">— {o.discipline}</span></span>
                  <span className="mono" style={{ marginLeft: 'auto' }}>{ok} ✓ · {ko} ✗ · {acts.length - ok - ko} ?</span>
                </div>
              )
            })}
          </div>
          <p className="aide">Contexte lu dans le dispositif : {Object.entries(x.contexte ?? {}).map(([k, v]) => `${k} = ${v}`).join(' · ')}</p>
        </section>
      )}

      {vue === 'ecarts' && (
        <section>
          {peutModifier && <NouvelEcart onAjouter={(c) => ajouterEcart(c)} />}
          {manquees.length > 0 && (
            <p className="aide">
              {manquees.length} action(s) attendue(s) non faite(s) dans la grille : chacune peut devenir un écart d'un clic depuis le conducteur.
            </p>
          )}
          {ecarts.length === 0 ? (
            <p className="vide">Aucun écart consigné.</p>
          ) : (
            <div className="exo-ecarts">
              {ecarts.map((e) => (
                <div key={e.id} className={`impl-props exo-ecart-fiche gravite-${e.gravite}`}>
                  <div className="impl-props-tete">
                    <span className={`prc-jeton ${e.gravite === 'critique' ? 'chaud' : e.gravite === 'majeur' ? 'veille' : ''}`}>{e.gravite}</span>
                    <span className="prc-jeton">{e.statut === 'ouvert' ? 'ouvert' : e.statut === 'en_cours' ? 'en cours' : 'fermé'}</span>
                  </div>
                  <p style={{ margin: 0 }}><strong>{e.constat}</strong></p>
                  {peutModifier ? (
                    <>
                      <div className="impl-deux">
                        <label>
                          Gravité
                          <select value={e.gravite} onChange={(ev) => majEcart(e, { gravite: ev.target.value })}>
                            <option value="mineur">mineur</option><option value="majeur">majeur</option><option value="critique">critique</option>
                          </select>
                        </label>
                        <label>
                          Statut
                          <select value={e.statut} onChange={(ev) => majEcart(e, { statut: ev.target.value })}>
                            <option value="ouvert">ouvert</option><option value="en_cours">en cours</option><option value="ferme">fermé</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Action corrective
                        <input defaultValue={e.action_corrective ?? ''} onBlur={(ev) => ev.target.value !== (e.action_corrective ?? '') && majEcart(e, { action_corrective: ev.target.value || null })} placeholder="Ce qu'on change dans le dispositif" />
                      </label>
                      <div className="impl-deux">
                        <label>
                          Responsable
                          <input defaultValue={e.responsable ?? ''} onBlur={(ev) => ev.target.value !== (e.responsable ?? '') && majEcart(e, { responsable: ev.target.value || null })} />
                        </label>
                        <label>
                          Échéance
                          <input type="date" defaultValue={e.echeance ?? ''} onBlur={(ev) => ev.target.value !== (e.echeance ?? '') && majEcart(e, { echeance: ev.target.value || null })} />
                        </label>
                      </div>
                    </>
                  ) : (
                    <p className="aide">{e.action_corrective ?? '—'} · {e.responsable ?? '—'} · {e.echeance ?? '—'}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="aide">La synthèse parle du dispositif et des actions, jamais des personnes : les observations nominatives restent à l'animateur.</p>
        </section>
      )}

      {vue === 'synthese' && (
        <section className="exo-synthese">
          <div className="etat prc-cadrans">
            <Cadran libelle="Stimuli joués" v={`${lances}/${stimuli.filter((s) => s.statut !== 'annule').length}`} />
            <Cadran libelle="Actions attendues faites" v={`${faites}/${actives.length}`} etat={actives.length && faites < actives.length ? 'veille' : ''} />
            <Cadran libelle="Écarts" v={ecarts.length} etat={ecarts.some((e) => e.gravite === 'critique') ? 'chaud' : ecarts.length ? 'veille' : ''} />
            <Cadran libelle="Durée réelle" v={x.debut_reel && x.fin_reel ? `${Math.round((new Date(x.fin_reel) - new Date(x.debut_reel)) / 60000)} min` : '—'} />
          </div>
          <h4 className="prc-titre">Par objectif</h4>
          <table className="tableau">
            <thead><tr><th>Objectif</th><th>Attendu</th><th>Fait</th><th>Non fait</th><th>Non observé</th></tr></thead>
            <tbody>
              {objectifs.map((o) => {
                const acts = actives.filter((a) => a.objectif_id === o.id)
                const ok = acts.filter((a) => obsParAction.get(a.id)?.faite === true).length
                const ko = acts.filter((a) => obsParAction.get(a.id)?.faite === false).length
                return <tr key={o.id}><td>{o.code} — {o.intitule}</td><td className="mono">{acts.length}</td><td className="mono">{ok}</td><td className="mono">{ko}</td><td className="mono">{acts.length - ok - ko}</td></tr>
              })}
            </tbody>
          </table>
          <h4 className="prc-titre">Écarts et actions correctives</h4>
          {ecarts.length === 0 ? <p className="aide">Aucun.</p> : (
            <table className="tableau">
              <thead><tr><th>Constat</th><th>Gravité</th><th>Action corrective</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr></thead>
              <tbody>
                {ecarts.map((e) => <tr key={e.id}><td>{e.constat}</td><td>{e.gravite}</td><td>{e.action_corrective ?? '—'}</td><td>{e.responsable ?? '—'}</td><td>{e.echeance ?? '—'}</td><td>{e.statut}</td></tr>)}
              </tbody>
            </table>
          )}
          <h4 className="prc-titre">Non testé</h4>
          <p className="aide">
            Un exercice réussi ne certifie rien. Les écarts de l'avant-vol qui n'ont pas été joués restent à corriger ; les objectifs du catalogue non choisis
            ({['ALERTE','MISSION','RADIO','SECOURS','METEO','EVAC','RECHERCHE','TECH','INFO','LOG'].filter((c) => !objectifs.some((o) => o.code === c)).join(', ') || 'aucun'}) n'ont pas été testés.
          </p>
          <label>
            Synthèse libre du directeur d'exercice
            <textarea rows={6} defaultValue={x.synthese ?? ''} disabled={!peutModifier} onBlur={(e) => e.target.value !== (x.synthese ?? '') && majExercice({ synthese: e.target.value || null })} placeholder="Ce qui s'est bien passé, ce qui a coincé, ce qu'on change." />
          </label>
          <p className="aide">Généré par Eventware le {new Date().toLocaleDateString('fr-BE')} depuis le dispositif encodé de {evenement.nom}. Imprimer pour la trace datée.</p>
        </section>
      )}
    </div>
  )
}

function EditionStimulus({ s, onAnnuler, onEnregistrer }) {
  const [texte, setTexte] = useState(s.texte)
  const [note, setNote] = useState(s.note_animateur ?? '')
  const [t, setT] = useState(s.t_min)
  const [emetteur, setEmetteur] = useState(s.emetteur ?? '')
  return (
    <div className="exo-edition">
      <div className="impl-deux">
        <label>t+ (min)<input type="number" min="0" value={t} onChange={(e) => setT(e.target.value)} /></label>
        <label>Émetteur<input value={emetteur} onChange={(e) => setEmetteur(e.target.value)} /></label>
      </div>
      <label>Texte à lire<textarea rows={3} value={texte} onChange={(e) => setTexte(e.target.value)} /></label>
      <label>Note pour l'animateur<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="ligne-boutons">
        <button onClick={() => onEnregistrer({ texte: texte.trim(), note_animateur: note.trim() || null, t_min: Number(t) || 0, emetteur: emetteur.trim() || null })} disabled={!texte.trim()}>Enregistrer</button>
        <button className="discret" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  )
}

function NouvelEcart({ onAjouter }) {
  const [c, setC] = useState('')
  return (
    <div className="ligne-boutons" style={{ alignItems: 'stretch' }}>
      <input value={c} onChange={(e) => setC(e.target.value)} placeholder="Écart constaté (dispositif, procédure, outil — pas une personne)" style={{ flex: 1, margin: 0 }} />
      <button disabled={!c.trim()} onClick={() => { onAjouter(c.trim()); setC('') }}>Ajouter</button>
    </div>
  )
}

function Cadran({ libelle, v, etat = '' }) {
  return (
    <div className={`cadran ${etat}`}>
      <span className="cadran-libelle">{libelle}</span>
      <span className="cadran-valeur">{v}</span>
    </div>
  )
}
