import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Trace from './Trace'

const STATUTS = [
  ['inscrit', 'Inscrit'],
  ['parti', 'Parti'],
  ['en_cours', 'En cours'],
  ['arrive', 'Arrivé'],
  ['abandon', 'Abandon']
]

export default function Parcours({ evenement, membre }) {
  const [vue, setVue] = useState('qg')
  const [message, setMessage] = useState(null)

  return (
    <div className="bloc securite dom-mousse">
      <h2>Parcours</h2>

      <div className="onglets">
        <button
          className={`module ${vue === 'qg' ? 'actif' : ''}`}
          onClick={() => setVue('qg')}
        >
          Suivi QG
        </button>
        <button
          className={`module ${vue === 'terrain' ? 'actif' : ''}`}
          onClick={() => setVue('terrain')}
        >
          Pointage terrain
        </button>
        <button
          className={`module ${vue === 'trace' ? 'actif' : ''}`}
          onClick={() => setVue('trace')}
        >
          Trace
        </button>
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {vue === 'qg' && <SuiviQg evenement={evenement} setMessage={setMessage} />}
      {vue === 'terrain' && (
        <Pointage evenement={evenement} membre={membre} setMessage={setMessage} />
      )}
      {vue === 'trace' && <Trace evenement={evenement} setMessage={setMessage} />}
    </div>
  )
}

/* ================================================================== */
/* Vue QG                                                              */
/* ================================================================== */

function SuiviQg({ evenement, setMessage }) {
  const [groupes, setGroupes] = useState([])
  const [retards, setRetards] = useState([])
  const [seuil, setSeuil] = useState(45)
  const [trace, setTrace] = useState(null)
  const [ouvrir, setOuvrir] = useState(false)

  async function charger() {
    const [g, r, t] = await Promise.all([
      supabase
        .from('groupes')
        .select('*, lieux:dernier_lieu_id(nom, pk_km)')
        .eq('evenement_id', evenement.id)
        .order('code'),
      supabase.rpc('groupes_sans_nouvelles', {
        p_evenement: evenement.id,
        p_minutes: seuil
      }),
      supabase
        .from('traces')
        .select('*')
        .eq('evenement_id', evenement.id)
        .eq('actif', true)
        .limit(1)
    ])
    if (g.error) setMessage({ type: 'erreur', texte: g.error.message })
    else setGroupes(g.data ?? [])
    if (!r.error) setRetards(r.data ?? [])
    setTrace(t.data?.[0] ?? null)
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id, seuil])

  async function changerStatut(id, statut) {
    const champs = { statut }
    if (statut === 'parti') champs.depart_reel = new Date().toISOString()
    if (statut === 'arrive') champs.arrivee_reelle = new Date().toISOString()
    const { error, count } = await supabase
      .from('groupes')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  const enRoute = groupes.filter((g) => ['parti', 'en_cours'].includes(g.statut))
  const surLeParcours = enRoute.reduce(
    (n, g) => n + (g.effectif_reel ?? g.effectif_prevu ?? 0),
    0
  )

  return (
    <>
      <div className="compteurs">
        <span>
          Sur le parcours <strong>{surLeParcours}</strong>
        </span>
        <span>
          Groupes en route <strong>{enRoute.length}</strong>
        </span>
        <span className={retards.length ? 'alerte-texte' : ''}>
          Sans nouvelles <strong>{retards.length}</strong>
        </span>
        {trace && (
          <span>
            {trace.nom} · {trace.distance_km} km · D+{trace.denivele_pos}
          </span>
        )}
      </div>

      {retards.length > 0 && (
        <div className="bloc-alerte">
          <div className="pave-titre">Sans nouvelles depuis plus de {seuil} min</div>
          {retards.map((r) => (
            <div className="ligne-retard" key={r.groupe_id}>
              <div>
                <strong>{r.nom}</strong>
                {r.jamais_pointe ? (
                  <span className="jeton alerte-texte"> jamais pointé</span>
                ) : (
                  <span className="mono"> dernier point : {r.dernier_lieu ?? '?'}</span>
                )}
              </div>
              <div className="meta">
                <span className="alerte-texte">{r.minutes_ecoulees} min</span>
                <span>{r.effectif ?? '?'} pers.</span>
                {r.accompagnateur && <span>{r.accompagnateur}</span>}
                {r.contact && (
                  <a className="lien-externe" href={`tel:${r.contact.replace(/\s/g, '')}`}>
                    {r.contact}
                  </a>
                )}
              </div>
            </div>
          ))}
          <p className="aide">
            Un groupe jamais pointé passe avant un groupe en retard : l'absence totale
            d'information est plus inquiétante qu'un retard mesuré.
          </p>
        </div>
      )}

      <div className="ligne-boutons" style={{ margin: '12px 0' }}>
        <label htmlFor="seuil" style={{ margin: 0, alignSelf: 'center' }}>
          Seuil d'alerte
        </label>
        <select
          id="seuil"
          value={seuil}
          onChange={(e) => setSeuil(Number(e.target.value))}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {[20, 30, 45, 60, 90].map((n) => (
            <option key={n} value={n}>
              {n} min
            </option>
          ))}
        </select>
        <button className="discret" onClick={() => setOuvrir(!ouvrir)}>
          {ouvrir ? 'Fermer' : 'Nouveau groupe'}
        </button>
      </div>

      {ouvrir && <FormGroupe evenement={evenement} onFait={() => { setOuvrir(false); charger() }} setMessage={setMessage} />}

      {groupes.length === 0 ? (
        <p className="vide">Aucun groupe.</p>
      ) : (
        groupes.map((g) => {
          const enRetard = retards.some((r) => r.groupe_id === g.id)
          return (
            <div className={`carte ${enRetard ? 'urgent' : ''}`} key={g.id}>
              <div className="titre">
                <span className="mono">{g.code}</span> — {g.nom}
              </div>
              <div className="meta">
                <span>{g.effectif_reel ?? g.effectif_prevu ?? '?'} pers.</span>
                {g.lieux?.nom && (
                  <span>
                    {g.lieux.nom}
                    {g.lieux.pk_km != null && ` · PK ${g.lieux.pk_km}`}
                  </span>
                )}
                {g.dernier_passage && (
                  <span>
                    {new Date(g.dernier_passage).toLocaleTimeString('fr-BE', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                )}
                {(g.accompagnateur_libre || g.contact) && (
                  <span>
                    {g.accompagnateur_libre} {g.contact}
                  </span>
                )}
              </div>
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <select
                  value={g.statut}
                  onChange={(e) => changerStatut(g.id, e.target.value)}
                  style={{ width: 'auto', marginBottom: 0 }}
                >
                  {STATUTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })
      )}
    </>
  )
}

function FormGroupe({ evenement, onFait, setMessage }) {
  const [f, setF] = useState({
    code: '',
    nom: '',
    effectif_prevu: '',
    accompagnateur_libre: '',
    contact: ''
  })

  async function creer() {
    if (!f.code.trim() || !f.nom.trim()) return
    const { error } = await supabase.from('groupes').insert({
      evenement_id: evenement.id,
      ...f,
      effectif_prevu: f.effectif_prevu ? Number(f.effectif_prevu) : null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
  }

  return (
    <div className="formulaire">
      <div className="saisie-rapide">
        <input
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value })}
          placeholder="Code"
          style={{ flex: '0 1 90px' }}
        />
        <input
          value={f.nom}
          onChange={(e) => setF({ ...f, nom: e.target.value })}
          placeholder="Nom du groupe"
        />
        <input
          type="number"
          value={f.effectif_prevu}
          onChange={(e) => setF({ ...f, effectif_prevu: e.target.value })}
          placeholder="Effectif"
          style={{ flex: '0 1 100px' }}
        />
      </div>
      <div className="saisie-rapide">
        <input
          value={f.accompagnateur_libre}
          onChange={(e) => setF({ ...f, accompagnateur_libre: e.target.value })}
          placeholder="Accompagnateur"
        />
        <input
          value={f.contact}
          onChange={(e) => setF({ ...f, contact: e.target.value })}
          placeholder="Téléphone"
        />
        <button onClick={creer}>Créer</button>
      </div>
      <p className="aide">
        Le téléphone de l'accompagnateur est le champ le plus important : c'est la première
        chose qu'on cherche quand un groupe ne donne plus de nouvelles.
      </p>
    </div>
  )
}

/* ================================================================== */
/* Pointage terrain — utilisable d'une main, en marchant                */
/* ================================================================== */

function Pointage({ evenement, membre, setMessage }) {
  const [groupes, setGroupes] = useState([])
  const [lieux, setLieux] = useState([])
  const [groupe, setGroupe] = useState('')
  const [lieu, setLieu] = useState('')
  const [effectif, setEffectif] = useState('')
  const [position, setPosition] = useState(null)
  const [dernier, setDernier] = useState(null)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    supabase
      .from('groupes')
      .select('id, code, nom, effectif_reel, effectif_prevu')
      .eq('evenement_id', evenement.id)
      .in('statut', ['inscrit', 'parti', 'en_cours'])
      .order('code')
      .then(({ data }) => setGroupes(data ?? []))
    supabase
      .from('lieux')
      .select('id, code, nom, pk_km')
      .eq('evenement_id', evenement.id)
      .order('pk_km', { nullsFirst: false })
      .then(({ data }) => setLieux(data ?? []))
  }, [evenement.id])

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setPosition({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude
        }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  async function pointer() {
    if (!groupe) return
    setOccupe(true)
    const { error } = await supabase.from('passages').insert({
      evenement_id: evenement.id,
      groupe_id: groupe,
      lieu_id: lieu || null,
      effectif: effectif ? Number(effectif) : null,
      membre_id: membre.id,
      ...(position ?? {})
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      const g = groupes.find((x) => x.id === groupe)
      setDernier({ nom: g?.nom, heure: new Date() })
      setEffectif('')
    }
    setOccupe(false)
  }

  return (
    <>
      {dernier && (
        <div className="message">
          {dernier.nom} pointé à{' '}
          {dernier.heure.toLocaleTimeString('fr-BE', {
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      )}

      <label htmlFor="grp">Groupe</label>
      <select id="grp" value={groupe} onChange={(e) => setGroupe(e.target.value)}>
        <option value="">— choisir —</option>
        {groupes.map((g) => (
          <option key={g.id} value={g.id}>
            {g.code} · {g.nom}
          </option>
        ))}
      </select>

      <label htmlFor="lieu">Point de passage</label>
      <select id="lieu" value={lieu} onChange={(e) => setLieu(e.target.value)}>
        <option value="">— position GPS seule —</option>
        {lieux.map((l) => (
          <option key={l.id} value={l.id}>
            {l.pk_km != null ? `PK ${l.pk_km} · ` : ''}
            {l.nom}
          </option>
        ))}
      </select>

      <label htmlFor="eff">Effectif constaté (facultatif)</label>
      <input
        id="eff"
        type="number"
        inputMode="numeric"
        value={effectif}
        onChange={(e) => setEffectif(e.target.value)}
        placeholder="compter si le groupe a changé"
      />

      <button
        className="bouton-terrain"
        disabled={occupe || !groupe}
        onClick={pointer}
      >
        Pointer le passage
      </button>

      <p className="aide">
        {position
          ? `Position transmise · ${position.latitude.toFixed(4)} ${position.longitude.toFixed(4)}`
          : 'Position non disponible — le pointage reste valable avec le point de passage choisi.'}
      </p>
    </>
  )
}
