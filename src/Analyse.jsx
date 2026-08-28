import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const NATURES = [
  ['dysfonctionnement', 'Dysfonctionnement'],
  ['reussite', 'Ce qui a marché'],
  ['suggestion', 'Suggestion'],
  ['risque', 'Risque identifié']
]

const IMPACTS = [
  ['mineur', 'Mineur'],
  ['gene', 'Gêne'],
  ['bloquant', 'Bloquant'],
  ['dangereux', 'Dangereux']
]

export default function Analyse({ evenement, membre }) {
  const [onglet, setOnglet] = useState('synthese')
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
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'synthese' ? (
        <Synthese evenement={evenement} setMessage={setMessage} />
      ) : (
        <Constats evenement={evenement} membre={membre} setMessage={setMessage} />
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
    if (error) setMessage({ type: 'erreur', texte: error.message })
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

      <p className="aide">
        Toutes ces valeurs sortent des données réelles, sans ressaisie. Le REX 2026 avait dû
        être reconstitué à la main faute d'horodatage et d'assignataire dans l'export.
      </p>
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

export function Constats({ evenement, membre, setMessage, compact }) {
  const [lignes, setLignes] = useState([])
  const [f, setF] = useState({
    nature: 'dysfonctionnement',
    module: 'securite',
    constat: '',
    impact: 'gene',
    proposition: ''
  })

  async function charger() {
    const { data, error } = await supabase
      .from('rex_entrees')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: error.message })
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
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ ...f, constat: '', proposition: '' })
      charger()
    }
  }

  return (
    <>
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
            {['securite', 'logistique', 'rh', 'parcours', 'noyau'].map((m) => (
              <option key={m}>{m}</option>
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

      {compact ? null : lignes.length === 0 ? (
        <p className="vide">Aucun constat.</p>
      ) : (
        lignes.map((r) => (
          <div
            className={`carte ${['bloquant', 'dangereux'].includes(r.impact) ? 'urgent' : ''}`}
            key={r.id}
          >
            <div className="titre">{r.constat}</div>
            <div className="meta">
              <span className="jeton">{r.nature}</span>
              <span className={['bloquant', 'dangereux'].includes(r.impact) ? 'alerte-texte' : ''}>
                {r.impact}
              </span>
              {r.module && <span>{r.module}</span>}
              {r.phase && <span>{r.phase}</span>}
            </div>
            {r.proposition && <p className="aide">→ {r.proposition}</p>}
          </div>
        ))
      )}
    </>
  )
}
