import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { ecrireOuEmpiler } from './fileEcritures'
import { texteErreur } from './erreurs'

/**
 * Précurseur — la charge des lieux (migration 114, maquette de Ren du
 * 14/10 « Précurseur — tableau de charge »).
 *
 * Aucune saisie propre : les « grains » sont les demandes logistique et
 * sécurité déjà rattachées à un lieu. La base calcule tout (vues
 * `prc_*`) ; cet écran ne fait que lire, et permet deux gestes :
 *   — résoudre une demande depuis la liste (même écriture que Situation,
 *     par la file hors ligne) ;
 *   — décrire de quoi dépend chaque lieu (onglet Dépendances), sans quoi
 *     aucune grappe ne peut apparaître.
 *
 * Les résidus s'estompent avec le temps, pas seulement quand une demande
 * bouge : l'écran demande à la base de recalculer les grappes à
 * l'ouverture puis toutes les deux minutes, comme le prévoit le module.
 *
 * Droits : lecture = missions:lire ; dépendances et capacités =
 * precurseur:creer/modifier/supprimer (le coordinateur l'a d'office).
 */

const RAFRAICHIR_MS = 60_000
const RECALCULER_MS = 120_000
const NIVEAUX = ['froid', 'ok', 'veille', 'chaud']

const fr = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d).replace('.', ','))
const hhmm = (t) =>
  t ? new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : ''

function depuis(t) {
  if (!t) return ''
  const min = Math.round((Date.now() - new Date(t).getTime()) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  return `il y a ${h} h ${String(min % 60).padStart(2, '0')}`
}

export default function Precurseur({ evenement, peut, toutPouvoir }) {
  const [onglet, setOnglet] = useState('charge')
  const [donnees, setDonnees] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [retour, setRetour] = useState(null)
  const [occupe, setOccupe] = useState(null)
  const [tous, setTous] = useState(false)

  const peutResoudre = toutPouvoir || peut?.('missions', 'modifier')
  const peutRegler =
    toutPouvoir || peut?.('precurseur', 'creer') || peut?.('precurseur', 'modifier')

  async function charger() {
    const ev = evenement.id
    const [syn, grappes, lieux, deps, demandes, journal, memoire, caps, tousLieux] =
      await Promise.all([
        supabase.rpc('prc_synthese', { p_evenement: ev }),
        supabase.from('prc_grappes_actives').select('*').eq('evenement_id', ev).order('charge', { ascending: false }),
        supabase.from('prc_charge_lieu').select('*').eq('evenement_id', ev).order('charge_totale', { ascending: false }),
        supabase.from('prc_dependances').select('*').eq('evenement_id', ev),
        supabase.from('prc_contributions').select('*').eq('evenement_id', ev).order('poids', { ascending: false }).limit(60),
        supabase.from('journal').select('id, horodatage, texte, importance').eq('evenement_id', ev).eq('module', 'precurseur').order('horodatage', { ascending: false }).limit(15),
        supabase.from('prc_memoire_types').select('*').eq('evenement_id', ev).order('incidents_precedes', { ascending: false }),
        supabase.from('prc_capacites').select('*').eq('evenement_id', ev),
        supabase.from('lieux').select('id, code, nom').eq('evenement_id', ev).is('deleted_at', null).order('nom')
      ])
    const e = [syn, grappes, lieux, deps, demandes].find((r) => r.error)
    if (e) {
      setErreur(texteErreur(e.error))
      return
    }
    setErreur(null)
    setDonnees({
      syn: syn.data?.[0] ?? null,
      grappes: grappes.data ?? [],
      lieux: lieux.data ?? [],
      deps: deps.data ?? [],
      demandes: demandes.data ?? [],
      journal: journal.data ?? [],
      memoire: memoire.data ?? [],
      capacites: caps.data ?? [],
      tousLieux: tousLieux.data ?? []
    })
  }

  async function recalculer() {
    // Les résidus s'estompent : la base réévalue les grappes et écrit en
    // main courante ce qui naît ou se résorbe. Un refus (non-membre) est
    // sans conséquence ici : la lecture suit de toute façon.
    await supabase.rpc('prc_actualiser_grappes', { p_evenement: evenement.id })
    await charger()
  }

  useEffect(() => {
    let vivant = true
    recalculer()
    const lire = setInterval(() => vivant && charger(), RAFRAICHIR_MS)
    const calc = setInterval(() => vivant && recalculer(), RECALCULER_MS)
    return () => {
      vivant = false
      clearInterval(lire)
      clearInterval(calc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  async function resoudre(d) {
    setOccupe(d.mission_id)
    setRetour(null)
    const r = await ecrireOuEmpiler({
      nature: 'update',
      table: 'missions',
      id: d.mission_id,
      champs: { statut: 'resolue' },
      libelle: `${d.reference ?? ''} — résolue`
    })
    setOccupe(null)
    if (r.statut === 'refus') setRetour({ type: 'erreur', texte: `${d.reference} : ${r.message}` })
    else if (r.statut === 'enfile')
      setRetour({ type: 'info', texte: `${d.reference} : réseau indisponible, la résolution partira au retour du signal.` })
    charger()
  }

  return (
    <div className="bloc precurseur dom-ardoise">
      <h2>Charge des lieux</h2>
      <p className="aide">
        Calculée à partir des demandes logistique et sécurité rattachées à un lieu. Une grappe,
        ce sont des lieux qui dépendent les uns des autres et sont tous chargés en même temps :
        une demande de plus peut s'y propager.
      </p>

      <div className="onglets">
        <button className={`module ${onglet === 'charge' ? 'actif' : ''}`} onClick={() => setOnglet('charge')}>
          Charge
        </button>
        <button className={`module ${onglet === 'dependances' ? 'actif' : ''}`} onClick={() => setOnglet('dependances')}>
          Dépendances
        </button>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {retour && <div className={`message ${retour.type === 'erreur' ? 'erreur' : ''}`}>{retour.texte}</div>}
      {!donnees && !erreur && <p className="aide">Calcul en cours…</p>}

      {donnees && onglet === 'charge' && (
        <Charge
          d={donnees}
          tous={tous}
          setTous={setTous}
          peutResoudre={peutResoudre}
          occupe={occupe}
          onResoudre={resoudre}
          onDependances={() => setOnglet('dependances')}
        />
      )}
      {donnees && onglet === 'dependances' && (
        <Dependances evenement={evenement} d={donnees} peutRegler={peutRegler} onFait={recalculer} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Charge                                                              */

function Charge({ d, tous, setTous, peutResoudre, occupe, onResoudre, onDependances }) {
  const { syn, grappes, lieux, deps, demandes, journal, memoire } = d
  const nom = useMemo(() => Object.fromEntries(lieux.map((l) => [l.lieu_id, l.nom])), [lieux])
  const enGrappe = useMemo(() => new Set(grappes.flatMap((g) => g.lieux)), [grappes])

  // 76 lieux à BFMF : on ne montre que ceux qui portent quelque chose —
  // une charge, une dépendance — sauf demande expresse.
  const relies = new Set(deps.flatMap((x) => [x.amont_lieu_id, x.aval_lieu_id]))
  const visibles = tous
    ? lieux
    : lieux.filter((l) => Number(l.charge_totale) > 0 || relies.has(l.lieu_id))

  const cadrans = [
    ['Lieux au niveau 3', syn?.lieux_niveau_3, syn?.lieux_niveau_3 ? 'chaud' : '', 'prêts à s’ébouler'],
    ['Grappes', grappes.length, grappes.length ? 'chaud' : '', 'risque de cascade'],
    ['Demandes ouvertes', syn?.demandes_ouvertes, '', 'logistique et sécurité'],
    ['En retard', syn?.demandes_en_retard, syn?.demandes_en_retard ? 'veille' : '', 'délai cible dépassé'],
    ['Sans lieu', syn?.demandes_sans_lieu, syn?.demandes_sans_lieu ? 'veille' : '', 'angle mort : ne chargent aucun lieu']
  ]

  return (
    <>
      <div className="etat prc-cadrans" role="group" aria-label="Synthèse de charge">
        {cadrans.map(([libelle, v, etat, aide]) => (
          <div key={libelle} className={`cadran ${etat}`}>
            <span className="cadran-libelle">{libelle}</span>
            <span className="cadran-valeur">{v ?? '…'}</span>
            <span className="prc-aide">{aide}</span>
          </div>
        ))}
      </div>

      {grappes.length > 0 ? (
        <section aria-label="Grappes détectées" className="prc-grappes">
          {grappes.map((g) => (
            <div key={g.signature} className="prc-grappe">
              <div className="prc-grappe-texte">
                <div className="prc-surtitre chaud">
                  Grappe détectée · {g.lieux.length} lieux dépendants · depuis {hhmm(g.depuis)}
                </div>
                <div className="prc-grappe-noms">{g.noms.join(' · ')}</div>
                <div className="aide">
                  Une demande de plus sur l'un de ces lieux peut se propager aux autres. Inscrit en
                  main courante.
                </div>
              </div>
              <div className="prc-grappe-charge">
                <span className="cadran-libelle">Charge cumulée</span>
                <span className="prc-chiffre chaud">{fr(g.charge, 1)}</span>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="prc-sans-grappe">
          <span className="prc-surtitre ok">Aucune grappe</span>
          <span className="aide">
            {deps.length
              ? 'Les lieux chargés sont isolés : pas de risque de cascade détecté.'
              : 'Aucune dépendance entre lieux n’est décrite : sans elles, aucune grappe ne peut apparaître.'}
          </span>
          {!deps.length && (
            <button className="discret" onClick={onDependances}>
              Décrire les dépendances
            </button>
          )}
        </section>
      )}

      <div className="prc-colonnes">
        <section className="prc-lieux" aria-labelledby="prc-t-lieux">
          <div className="prc-titre-ligne">
            <h3 id="prc-t-lieux" className="prc-titre">Charge par lieu</h3>
            <label className="case-a-cocher">
              <input type="checkbox" checked={tous} onChange={(e) => setTous(e.target.checked)} />
              Tous les lieux ({lieux.length})
            </label>
          </div>
          {visibles.length === 0 && (
            <p className="aide">Aucun lieu ne porte de charge pour l'instant.</p>
          )}
          <div className="prc-grille">
            {visibles.map((l) => {
              const recoit = deps.filter((x) => x.aval_lieu_id === l.lieu_id)
              const pese = deps.filter((x) => x.amont_lieu_id === l.lieu_id)
              const etat = NIVEAUX[l.niveau] ?? 'froid'
              return (
                <article key={l.lieu_id} className={`prc-lieu ${l.niveau === 3 ? 'chaud' : ''}`}>
                  <div className="prc-lieu-tete">
                    <h4>{l.nom}</h4>
                    {enGrappe.has(l.lieu_id) && <span className="prc-jeton chaud">Grappe</span>}
                    {l.code && <span className="prc-jeton">{l.code}</span>}
                  </div>
                  <div className="prc-niveau">
                    <span className="prc-grains" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className={`prc-grain ${i < l.niveau ? etat : ''}`} />
                      ))}
                    </span>
                    <span className={`prc-niveau-texte ${etat}`}>Niveau {l.niveau}</span>
                    <span className="prc-capacite">capacité {fr(l.capacite, 1)}</span>
                  </div>
                  <dl className="prc-chiffres">
                    <div>
                      <dt>Propre</dt>
                      <dd>{fr(l.charge_propre)}</dd>
                    </div>
                    <div>
                      <dt>Reportée</dt>
                      <dd>{fr(l.charge_induite)}</dd>
                    </div>
                    <div>
                      <dt>Demandes</dt>
                      <dd>
                        {l.demandes_ouvertes}
                        {l.residus ? ` + ${l.residus} r.` : ''}
                      </dd>
                    </div>
                  </dl>
                  <div className="prc-liens">
                    <div>
                      Reçoit de :{' '}
                      <span>
                        {recoit.map((x) => `${nom[x.amont_lieu_id] ?? '?'} ×${fr(x.poids, 1)}`).join(', ') || '—'}
                      </span>
                    </div>
                    <div>
                      Pèse sur : <span>{pese.map((x) => nom[x.aval_lieu_id] ?? '?').join(', ') || '—'}</span>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <aside className="prc-cote">
          <section aria-labelledby="prc-t-demandes">
            <h3 id="prc-t-demandes" className="prc-titre">Demandes logistique et sécurité</h3>
            <div className="prc-liste">
              {demandes.length === 0 && <div className="prc-ligne aide">Aucune demande ne pèse.</div>}
              {demandes.map((x) => {
                const ouverte = x.etat === 'ouverte'
                return (
                  <div key={x.mission_id} className={`prc-ligne ${ouverte ? '' : 'residu'}`}>
                    <div className="prc-ligne-texte">
                      <div>
                        <span className="mono sourdine">{x.reference}</span> <strong>{x.titre}</strong>
                      </div>
                      <div className="aide">
                        {x.module === 'securite' ? 'Sécurité' : 'Logistique'} · {x.priorite} ·{' '}
                        {x.lieu_id ? nom[x.lieu_id] ?? 'lieu inactif' : 'sans lieu'} ·{' '}
                        {ouverte ? depuis(x.created_at) : `résolue ${depuis(x.resolue_le)}`}
                        {ouverte && x.en_retard ? ' · en retard' : ''}
                        {x.bloquant ? ' · bloquante' : ''}
                      </div>
                    </div>
                    <div className="prc-ligne-droite">
                      <span className={`mono prc-poids ${ouverte ? (x.en_retard ? 'veille' : '') : 'froid'}`}>
                        {ouverte ? 'poids' : 'résidu'} {fr(x.poids)}
                      </span>
                      {ouverte && peutResoudre && (
                        <button
                          className="discret"
                          disabled={occupe === x.mission_id}
                          onClick={() => onResoudre(x)}
                          aria-label={`Résoudre ${x.reference} : ${x.titre}`}
                        >
                          Résoudre
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="aide">
              Une demande ouverte pèse selon sa priorité (P1 = 3 … P4 = 0,5), ×1,5 si elle dépasse son
              délai cible, +1 si bloquante. Résolue, elle garde la moitié de son poids, qui
              s'estompe : cinq réappros au même bar en deux heures restent une tension.
            </p>
          </section>

          <section aria-labelledby="prc-t-mc">
            <h3 id="prc-t-mc" className="prc-titre">Main courante · Précurseur</h3>
            <div className="prc-liste">
              {journal.length === 0 && <div className="prc-ligne aide">Rien d'inscrit pour l'instant.</div>}
              {journal.map((j) => (
                <div key={j.id} className="prc-ligne">
                  <span className="mono sourdine">{hhmm(j.horodatage)}</span>
                  <span className={j.importance === 'majeur' ? 'prc-majeur' : ''}>{j.texte}</span>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="prc-t-memoire">
            <h3 id="prc-t-memoire" className="prc-titre">Mémoire · avant les incidents P1</h3>
            <div className="prc-liste prc-memoire">
              <p className="aide">
                Demandes créées dans les 3 h précédant un incident sécurité P1, sur le même lieu ou
                un lieu dont il dépend. Calculé seul, sans saisie.
              </p>
              {memoire.length === 0 ? (
                <p className="aide">Aucun incident P1 rattaché à un lieu pour l'instant.</p>
              ) : (
                <div className="prc-tableau">
                  <span className="cadran-libelle">Type de demande</span>
                  <span className="cadran-libelle droite">Incidents</span>
                  <span className="cadran-libelle droite">Avance</span>
                  {memoire.map((m) => (
                    <FragmentMemoire key={m.precurseur_type} m={m} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}

function FragmentMemoire({ m }) {
  return (
    <>
      <span>{m.precurseur_type}</span>
      <span className="mono droite">{m.incidents_precedes}</span>
      <span className="mono droite">{m.avance_moyenne_min} min</span>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Dépendances et capacités                                            */

function Dependances({ evenement, d, peutRegler, onFait }) {
  const { deps, tousLieux, capacites, lieux } = d
  const nom = Object.fromEntries(tousLieux.map((l) => [l.id, l.code ? `${l.nom} (${l.code})` : l.nom]))
  const [f, setF] = useState({ amont: '', aval: '', poids: '0.5', note: '' })
  const [cap, setCap] = useState({ lieu: '', valeur: '3' })
  const [erreur, setErreur] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function executer(promesse) {
    setOccupe(true)
    setErreur(null)
    const { error } = await promesse
    setOccupe(false)
    if (error) {
      setErreur(texteErreur(error))
      return false
    }
    await onFait()
    return true
  }

  async function ajouter(e) {
    e.preventDefault()
    if (!f.amont || !f.aval || f.amont === f.aval) return
    const ok = await executer(
      supabase.from('prc_dependances').insert({
        evenement_id: evenement.id,
        amont_lieu_id: f.amont,
        aval_lieu_id: f.aval,
        poids: Number(f.poids),
        note: f.note.trim() || null
      })
    )
    if (ok) setF({ amont: '', aval: '', poids: '0.5', note: '' })
  }

  async function regler(e) {
    e.preventDefault()
    if (!cap.lieu) return
    const ok = await executer(
      supabase
        .from('prc_capacites')
        .upsert({ lieu_id: cap.lieu, evenement_id: evenement.id, capacite: Number(cap.valeur) }, { onConflict: 'lieu_id' })
    )
    if (ok) setCap({ lieu: '', valeur: '3' })
  }

  const choixLieu = (valeur, onChange, libelle) => (
    <select value={valeur} onChange={(e) => onChange(e.target.value)} aria-label={libelle} required>
      <option value="">— {libelle} —</option>
      {tousLieux.map((l) => (
        <option key={l.id} value={l.id}>
          {nom[l.id]}
        </option>
      ))}
    </select>
  )

  const chargeDe = Object.fromEntries(lieux.map((l) => [l.lieu_id, l]))

  return (
    <>
      <p className="aide">
        « B dépend de A » : quand A se charge, une part de sa charge se reporte sur B (le poids,
        de 0,1 à 1). Exemple : la scène dépend du groupe électrogène à 0,6. Sans dépendance
        décrite, aucune grappe ne peut apparaître.
      </p>
      {erreur && <div className="message erreur">{erreur}</div>}

      <section>
        <h3 className="prc-titre">Dépendances ({deps.length})</h3>
        {deps.length === 0 && <p className="aide">Aucune pour l'instant.</p>}
        <div className="prc-liste">
          {deps.map((x) => (
            <div key={x.id} className="prc-ligne">
              <div className="prc-ligne-texte">
                <div>
                  <strong>{nom[x.aval_lieu_id] ?? '?'}</strong> dépend de <strong>{nom[x.amont_lieu_id] ?? '?'}</strong>
                </div>
                {x.note && <div className="aide">{x.note}</div>}
              </div>
              <div className="prc-ligne-droite">
                <span className="mono">×{fr(x.poids, 1)}</span>
                {peutRegler && (
                  <button
                    className="discret"
                    disabled={occupe}
                    onClick={() => executer(supabase.from('prc_dependances').delete().eq('id', x.id))}
                    aria-label={`Retirer : ${nom[x.aval_lieu_id]} dépend de ${nom[x.amont_lieu_id]}`}
                  >
                    Retirer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {peutRegler && (
          <form className="formulaire prc-form" onSubmit={ajouter}>
            {choixLieu(f.aval, (v) => setF({ ...f, aval: v }), 'Ce lieu…')}
            <span className="aide">dépend de</span>
            {choixLieu(f.amont, (v) => setF({ ...f, amont: v }), '…ce lieu')}
            <label>
              Poids
              <input
                type="number"
                min="0.1"
                max="1"
                step="0.1"
                value={f.poids}
                onChange={(e) => setF({ ...f, poids: e.target.value })}
              />
            </label>
            <input
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
              placeholder="Pourquoi (facultatif) — ex. alimente l'éclairage"
            />
            <button disabled={occupe || !f.amont || !f.aval || f.amont === f.aval}>Ajouter</button>
          </form>
        )}
      </section>

      <section>
        <h3 className="prc-titre">Capacités</h3>
        <p className="aide">
          Par défaut, un lieu passe au niveau 3 à une charge de 3. Un lieu plus fragile (un poste
          de secours à deux personnes) se règle plus bas ; un lieu robuste, plus haut.
        </p>
        <div className="prc-liste">
          {capacites.length === 0 && <div className="prc-ligne aide">Toutes à 3.</div>}
          {capacites.map((c) => (
            <div key={c.lieu_id} className="prc-ligne">
              <div className="prc-ligne-texte">
                <strong>{nom[c.lieu_id] ?? '?'}</strong>
                {chargeDe[c.lieu_id] && (
                  <span className="aide">charge actuelle {fr(chargeDe[c.lieu_id].charge_totale)}</span>
                )}
              </div>
              <div className="prc-ligne-droite">
                <span className="mono">{fr(c.capacite, 1)}</span>
                {peutRegler && (
                  <button
                    className="discret"
                    disabled={occupe}
                    onClick={() => executer(supabase.from('prc_capacites').delete().eq('lieu_id', c.lieu_id))}
                    aria-label={`Remettre ${nom[c.lieu_id]} à la capacité par défaut`}
                  >
                    Remettre à 3
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {peutRegler && (
          <form className="formulaire prc-form" onSubmit={regler}>
            {choixLieu(cap.lieu, (v) => setCap({ ...cap, lieu: v }), 'Lieu')}
            <label>
              Capacité
              <input
                type="number"
                min="0.5"
                max="99"
                step="0.5"
                value={cap.valeur}
                onChange={(e) => setCap({ ...cap, valeur: e.target.value })}
              />
            </label>
            <button disabled={occupe || !cap.lieu}>Régler</button>
          </form>
        )}
      </section>
    </>
  )
}
