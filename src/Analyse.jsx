import { useArbitrageLot, LIBELLE_IMPACT } from './ArbitrageConstats'
import { LIBELLE_PHASE } from './phases'
import { useRubriqueRoute } from './route'
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { DOMAINES, NATURES_REX, IMPACTS_REX } from './libelles'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import EvaluationsFournisseurs from './EvaluationsFournisseurs'
import Message from './Message'

// (11/11, audit M5) Natures et impacts partagés avec le bouton flottant : les mêmes mots partout.
const NATURES = NATURES_REX
const IMPACTS = IMPACTS_REX

const STATUTS_REX = [
  ['a_arbitrer', 'À arbitrer'],
  ['retenu', 'Retenu'],
  ['rejete', 'Rejeté'],
  ['realise', 'Réalisé']
]

export default function Analyse({ evenement, membre, peut, toutPouvoir, ongletCible }) {
  const [onglet, setOnglet] = useState('synthese')
  useRubriqueRoute('analyse', onglet, setOnglet, ongletCible, ['synthese', 'constats'])
  const [message, setMessage] = useState(null)

  return (
    <div className="bloc securite dom-ardoise">
      <h2>Analyse / REX</h2>

      <div className="onglets">
        <button
          className={`module ${onglet === 'synthese' ? 'actif' : ''}`}
          onClick={() => setOnglet('synthese')}
        >
          Synthèse
        </button>
        <button
          className={`module ${onglet === 'constats' ? 'actif' : ''}`}
          onClick={() => setOnglet('constats')}
        >
          Constats
        </button>
      </div>

      {message && (
        <Message message={message} onFermer={() => setMessage(null)} />
      )}

      {onglet === 'synthese' ? (
        <>
          <Synthese evenement={evenement} setMessage={setMessage} />
          <Familles evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} />
          <MemoireLieux evenement={evenement} />
          <EvaluationsFournisseurs evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} />
        </>
      ) : (
        <Constats
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* Synthèse                                                            */
/* ================================================================== */

function Synthese({ evenement, setMessage }) {
  const [s, setS] = useState(null)

  async function charger() {
    const { data, error } = await supabase.rpc('rex_synthese', {
      p_evenement: evenement.id
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setS(data)
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  if (!s) return <p className="vide">Calcul…</p>

  const duree =
    s.journal?.debut && s.journal?.fin
      ? Math.round(
          (new Date(s.journal.fin) - new Date(s.journal.debut)) / 3600000
        )
      : null

  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 14 }}>
        <button className="discret" onClick={charger}>
          Recalculer
        </button>
        <button className="discret" onClick={() => exporter(evenement, s)}>
          Exporter (CSV)
        </button>
      </div>

      <div className="grille-paves">
        <Bloc titre="Signalements">
          <Chiffre v={s.signalements?.total} l="reçus" />
          <Detail
            l="délai médian de prise en charge"
            v={fmt(s.signalements?.delai_median_prise_en_charge_min, ' min')}
          />
          <Detail l="sans position GPS" v={s.signalements?.sans_position} />
          <Repartition data={s.signalements?.par_type} />
        </Bloc>

        <Bloc titre="Missions">
          <Chiffre v={s.missions?.total} l="au total" />
          <Detail l="encore ouvertes" v={s.missions?.ouvertes} alerte={s.missions?.ouvertes > 0} />
          <Detail l="part de P1" v={fmt(s.missions?.part_p1_pct, ' %')} alerte={s.missions?.part_p1_pct > 25} />
          <Detail l="délai médian" v={fmt(s.missions?.delai_median_min, ' min')} />
          <Detail l="non attribuées" v={s.missions?.non_attribuees} alerte={s.missions?.non_attribuees > 0} />
          <Repartition data={s.missions?.par_module} />
        </Bloc>

        <Bloc titre="Logistique">
          <Chiffre v={s.logistique?.jauge_max} l="jauge maximale" />
          <Detail l="mouvements de stock" v={s.logistique?.mouvements} />
          <Detail l="articles sous seuil" v={s.logistique?.articles_sous_seuil} alerte={s.logistique?.articles_sous_seuil > 0} />
          <Detail l="biens non rendus" v={s.logistique?.biens_non_rendus} alerte={s.logistique?.biens_non_rendus > 0} />
          <Detail l="transports" v={s.logistique?.transports} />
        </Bloc>

        <Bloc titre="Parcours">
          <Chiffre v={s.parcours?.groupes} l="groupes" />
          <Detail l="arrivés" v={s.parcours?.arrives} />
          <Detail l="abandons" v={s.parcours?.abandons} alerte={s.parcours?.abandons > 0} />
          <Detail l="pointages" v={s.parcours?.passages} />
          <Detail
            l="partis sans pointage"
            v={s.parcours?.groupes_sans_pointage}
            alerte={s.parcours?.groupes_sans_pointage > 0}
          />
        </Bloc>

        <Bloc titre="Bénévoles">
          <Chiffre v={fmt(s.rh?.taux_presence_pct, ' %')} l="taux de présence" />
          <Detail l="besoin total" v={s.rh?.besoin_total} />
          <Detail l="confirmés" v={s.rh?.confirmes} />
          <Detail l="présents" v={s.rh?.presents} />
          <Detail l="défections" v={s.rh?.defections} alerte={s.rh?.defections > 0} />
        </Bloc>

        <Bloc titre="Main courante">
          <Chiffre v={s.journal?.entrees} l="entrées" />
          <Detail l="saisies humaines" v={s.journal?.saisies} />
          <Detail l="automatiques" v={s.journal?.automatiques} />
          <Detail l="majeures" v={s.journal?.majeures} />
          {duree != null && <Detail l="durée couverte" v={duree + ' h'} />}
        </Bloc>
      </div>

    </>
  )
}

function Bloc({ titre, children }) {
  return (
    <div className="pave">
      <div className="pave-titre">{titre}</div>
      {children}
    </div>
  )
}

function Chiffre({ v, l }) {
  return (
    <>
      <div className="grand">{v ?? '—'}</div>
      <div className="meta">
        <span>{l}</span>
      </div>
    </>
  )
}

function Detail({ l, v, alerte }) {
  if (v === null || v === undefined) return null
  return (
    <div className={`detail-metrique ${alerte ? 'alerte-texte' : ''}`}>
      <span>{l}</span>
      <strong>{v}</strong>
    </div>
  )
}

function Repartition({ data }) {
  if (!data || !Object.keys(data).length) return null
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  return (
    <div className="repartition">
      {Object.entries(data)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (
          <div className="barre-ligne" key={k}>
            <span className="barre-lib">{k}</span>
            <span className="barre">
              <span style={{ width: `${(n / total) * 100}%` }} />
            </span>
            <span className="mono">{n}</span>
          </div>
        ))}
    </div>
  )
}

const fmt = (v, suffixe = '') => (v === null || v === undefined ? null : v + suffixe)

function exporter(evenement, s) {
  const lignes = [['domaine', 'indicateur', 'valeur']]
  for (const [domaine, bloc] of Object.entries(s)) {
    for (const [k, v] of Object.entries(bloc ?? {})) {
      if (v && typeof v === 'object') {
        for (const [k2, v2] of Object.entries(v)) lignes.push([domaine, `${k}.${k2}`, v2])
      } else {
        lignes.push([domaine, k, v])
      }
    }
  }
  const csv = lignes.map((l) => l.join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `rex-${evenement.slug}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ================================================================== */
/* Constats                                                            */
/* ================================================================== */

export function Constats({ evenement, membre, peut, toutPouvoir, setMessage, compact }) {
  const [lignes, setLignes] = useState([])
  // (167) tous | eventware | humain : ce qu'Eventware a proposé se lit à part, ou mêlé au reste.
  const [filtre, setFiltre] = useState('tous')
  const [proposition, setProposition] = useState(false)
  const [f, setF] = useState({
    nature: 'dysfonctionnement',
    module: 'securite',
    constat: '',
    impact: 'gene',
    proposition: ''
  })

  // Consigner insère un constat ; arbitrer (statut, porteur, échéance) le modifie.
  const peutConsigner = toutPouvoir || peut?.('analyse', 'creer')
  const peutArbitrer = toutPouvoir || peut?.('analyse', 'modifier')

  async function charger() {
    const { data, error } = await supabase
      .from('rex_entrees')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function ajouter() {
    if (!f.constat.trim()) return
    const { error } = await supabase.from('rex_entrees').insert({
      evenement_id: evenement.id,
      ...f,
      phase: evenement.phase,
      membre_id: membre.id
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ ...f, constat: '', proposition: '' })
      charger()
    }
  }

  async function arbitrer(id, champs) {
    const refus = await modifierOuRefuser('rex_entrees', champs, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  // (167) Eventware relit l'événement — demandes, SOS, vocaux, météo, créneaux —
  // et dépose ses constats « à arbitrer ». Rejouable : un constat arbitré ne
  // bouge plus, un constat rejeté ne revient pas. Jamais un prénom dedans.
  async function proposer() {
    setProposition(true)
    const { data, error } = await supabase.rpc('rex_proposer', { p_evenement: evenement.id })
    setProposition(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const n = Number(Array.isArray(data) ? data[0] : data) || 0
    setMessage({ type: 'succes', texte: n ? `Eventware propose ${n} constat${n > 1 ? 's' : ''} — à arbitrer comme les autres.` : 'Rien de nouveau : les constats d’Eventware sont déjà à jour.' })
    if (n) setFiltre('eventware')
    charger()
  }

  const nbAuto = lignes.filter((r) => r.source === 'eventware').length
  // (169) L'arbitrage en lot : filtres, sélection multiple, doublons, report vers l'édition suivante.
  const lot = useArbitrageLot({ evenement, lignes, charger, setMessage, actif: !!peutArbitrer && !compact })
  const visibles = lot.filtrer(lignes.filter((r) => filtre === 'tous' || (filtre === 'eventware' ? r.source === 'eventware' : r.source !== 'eventware')))

  return (
    <>
      {peutArbitrer && !compact && (
        <div className="rex-eventware">
          <button className="discret" disabled={proposition} onClick={proposer}>
            {proposition ? 'Relecture…' : 'Proposer les constats d’Eventware'}
          </button>
          <span className="aide">
            Relit les demandes, les SOS, les messages vocaux, la météo et les créneaux, et consigne ce que les chiffres disent :
            des constats à arbitrer, sans jamais nommer quelqu’un. Se fait aussi tout seul à la clôture.
          </span>
        </div>
      )}
      {peutConsigner && (
        <div className="formulaire">
          <div className="saisie-rapide">
            <select
              value={f.nature}
              onChange={(e) => setF({ ...f, nature: e.target.value })}
              style={{ width: 'auto', marginBottom: 0 }}
            >
              {NATURES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={f.module}
              onChange={(e) => setF({ ...f, module: e.target.value })}
              style={{ width: 'auto', marginBottom: 0 }}
            >
              {DOMAINES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={f.impact}
              onChange={(e) => setF({ ...f, impact: e.target.value })}
              style={{ width: 'auto', marginBottom: 0 }}
            >
              {IMPACTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <input
            value={f.constat}
            onChange={(e) => setF({ ...f, constat: e.target.value })}
            placeholder="Ce que tu constates, maintenant"
          />
          <input
            value={f.proposition}
            onChange={(e) => setF({ ...f, proposition: e.target.value })}
            placeholder="Ce qu'il faudrait changer (facultatif)"
          />
          <button disabled={!f.constat.trim()} onClick={ajouter}>
            Consigner
          </button>
          <p className="aide">
            À remplir pendant, pas après. Un constat noté sur le moment vaut dix reconstitués
            de mémoire trois semaines plus tard. Un constat bloquant ou dangereux remonte
            aussitôt dans la main courante.
          </p>
        </div>
      )}

      {!compact && nbAuto > 0 && (
        <div className="onglets rex-filtre">
          {[['tous', `Tous (${lignes.length})`], ['eventware', `Proposés par Eventware (${nbAuto})`], ['humain', `Consignés (${lignes.length - nbAuto})`]].map(([v, l]) => (
            <button key={v} className={`module ${filtre === v ? 'actif' : ''}`} onClick={() => setFiltre(v)}>{l}</button>
          ))}
        </div>
      )}

      {!compact && lignes.length > 0 && lot.barre?.(visibles)}
      {!compact && lot.barreLot}
      {!compact && lot.doublons}

      {compact ? null : lignes.length === 0 ? (
        <p className="vide">Aucun constat pour l’instant. Consigne le premier ci-dessus{peutArbitrer ? ', ou laisse Eventware proposer les siens' : ''}.</p>
      ) : visibles.length === 0 ? (
        <p className="vide">Aucun constat ne correspond à ces filtres. Passe sur « Tous » pour tout revoir.</p>
      ) : (
        visibles.map((r) => (
          <div
            className={`carte ${['bloquant', 'dangereux'].includes(r.impact) ? 'urgent' : ''} ${r.source === 'eventware' ? 'rex-auto' : ''}`}
            key={r.id}
            data-objet={r.id}
          >
            <div className="titre rex-titre">{lot.caseCarte(r)}<span>{r.constat}</span></div>
            <div className="meta">
              {r.source === 'eventware' && <span className="prc-jeton auto" title="constat calculé par Eventware à partir des données de l’événement">proposé par Eventware</span>}
              <span className="jeton">{NATURES.find(([v]) => v === r.nature)?.[1] ?? r.nature}</span>
              <span className={['bloquant', 'dangereux'].includes(r.impact) ? 'alerte-texte' : ''}>
                {LIBELLE_IMPACT[r.impact] ?? r.impact}
              </span>
              {r.module && <span>{DOMAINES.find(([v]) => v === r.module)?.[1] ?? r.module}</span>}
              {r.phase && <span>{LIBELLE_PHASE[r.phase] ?? r.phase}</span>}
              {r.objet_type === 'jalons' && r.objet_ref && <span className="prc-jeton">reporté : {r.objet_ref}</span>}
            </div>
            {r.proposition && <p className="aide">→ {r.proposition}</p>}

            {/* Sans droit d'arbitrage, l'arbitrage se lit quand même :
                statut, porteur, échéance — un constat sans suite visible
                est un constat qu'on re-signale. */}
            {!peutArbitrer && (r.statut || r.porteur || r.echeance) && (
              <div className="meta" style={{ marginTop: 6 }}>
                {r.statut && (
                  <span>{STATUTS_REX.find(([v]) => v === r.statut)?.[1] ?? r.statut}</span>
                )}
                {r.porteur && <span>porté par {r.porteur}</span>}
                {r.echeance && (
                  <span>pour le {new Date(r.echeance).toLocaleDateString('fr-BE')}</span>
                )}
              </div>
            )}

            {peutArbitrer && (
              <>
                <div className="ligne-boutons" style={{ marginTop: 8 }}>
                  {STATUTS_REX.map(([v, l]) => (
                    <button
                      key={v}
                      className={`module ${r.statut === v ? 'actif' : ''}`}
                      onClick={() => arbitrer(r.id, { statut: v })}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <div className="saisie-rapide" style={{ marginTop: 6 }}>
                  <input
                    defaultValue={r.porteur ?? ''}
                    placeholder="Porteur"
                    onBlur={(e) => arbitrer(r.id, { porteur: e.target.value.trim() || null })}
                  />
                  <input
                    type="date"
                    defaultValue={r.echeance ?? ''}
                    onBlur={(e) => arbitrer(r.id, { echeance: e.target.value || null })}
                    style={{ flex: '0 1 150px' }}
                  />
                </div>
              </>
            )}
          </div>
        ))
      )}
    </>
  )
}

/* ================================================================== */
/* (167) Ce qui revient : les familles de demandes                     */
/* ================================================================== */

// Les demandes rangées par famille (jetons, boissons, sanitaires…) :
// combien, tous les combien, où. Une famille qui revient toutes les
// 30 min aux mêmes lieux se prévient par une ronde, pas par dix demandes.
function Familles({ evenement, peut, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState(null)
  const [rattachement, setRattachement] = useState(false)
  const peutRattacher = toutPouvoir || peut?.('missions', 'modifier')

  async function charger() {
    const { data, error } = await supabase.rpc('familles_evenement', { p_evenement: evenement.id })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }
  useEffect(() => {
    charger()
  }, [evenement.id])

  // Les demandes sans lieu qui en nomment un dans leur texte reçoivent ce lieu :
  // c'est ce qui donne aux lieux leur mémoire.
  async function rattacher() {
    setRattachement(true)
    const { data, error } = await supabase.rpc('rattacher_demandes_lieux', { p_evenement: evenement.id })
    setRattachement(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const n = Number(Array.isArray(data) ? data[0] : data) || 0
    setMessage({ type: 'succes', texte: n ? `${n} demande${n > 1 ? 's' : ''} rattachée${n > 1 ? 's' : ''} à un lieu d’après leur texte.` : 'Aucune demande sans lieu ne nomme un lieu dans son texte.' })
    charger()
  }

  if (!lignes || !lignes.length) return null
  return (
    <Bloc titre="Ce qui revient — familles de demandes">
      <table className="familles-demande">
        <thead>
          <tr><th>Famille</th><th>Demandes</th><th>Tous les</th><th>Surtout à</th></tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.famille}>
              <td>
                {l.libelle}
                {l.ronde && l.n >= 3 && <span className="prc-jeton auto" style={{ marginLeft: 6 }}>ronde</span>}
              </td>
              <td>{l.n}</td>
              <td>{l.intervalle_median_min != null ? `${l.intervalle_median_min} min` : '—'}</td>
              <td>{l.lieux ?? <span className="aide" style={{ margin: 0 }}>sans lieu</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="aide">
        « Proposer les constats d’Eventware » (onglet Constats) écrit au REX les rondes à prévoir.
        {peutRattacher && (
          <>
            {' '}
            <button className="lien" disabled={rattachement} onClick={rattacher}>
              {rattachement ? 'Rattachement…' : 'Rattacher les demandes sans lieu d’après leur texte'}
            </button>
          </>
        )}
      </p>
    </Bloc>
  )
}

/* ================================================================== */
/* (167) La mémoire des lieux                                          */
/* ================================================================== */

// Ce que chaque lieu a vécu aux éditions précédentes (chaîne
// lieu_precedent_id, posée par « Reconduire » ou par Réglages › Données).
function MemoireLieux({ evenement }) {
  const [lignes, setLignes] = useState([])
  useEffect(() => {
    supabase.rpc('memoire_lieux', { p_evenement: evenement.id }).then(({ data }) => setLignes(data ?? []))
  }, [evenement.id])
  if (!lignes.length) return null
  return (
    <Bloc titre="Mémoire des lieux — éditions précédentes">
      {lignes.map((l) => (
        <div className="carte memoire-lieu" key={l.lieu_id}>
          <div className="titre">{l.nom}</div>
          <div className="meta">
            <span>{l.demandes} demande{l.demandes > 1 ? 's' : ''}</span>
            {l.signalements > 0 && <span>{l.signalements} SOS</span>}
            {l.rex > 0 && <span>{l.rex} constat{l.rex > 1 ? 's' : ''} retenu{l.rex > 1 ? 's' : ''}</span>}
            <span>{l.editions} édition{l.editions > 1 ? 's' : ''} en arrière</span>
          </div>
          {(l.familles ?? []).length > 0 && (
            <p className="aide">{l.familles.slice(0, 4).map((f) => `${f.libelle.toLowerCase()} ×${f.n}`).join(', ')}</p>
          )}
          {(l.constats ?? []).map((c, i) => <p className="aide" key={i}>→ {c}</p>)}
        </div>
      ))}
    </Bloc>
  )
}
