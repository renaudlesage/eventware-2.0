import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const ONGLETS = [
  ['journal', 'Main courante'],
  ['missions', 'Missions'],
  ['recherches', 'Recherches'],
  ['fiches', 'Fiches réflexe']
]

export default function Securite({ evenement, membre }) {
  const [onglet, setOnglet] = useState('journal')
  const [message, setMessage] = useState(null)

  return (
    <div className="securite">
      <h2>Sécurité</h2>

      <div className="onglets">
        {ONGLETS.map(([k, l]) => (
          <button
            key={k}
            className={`module ${onglet === k ? 'actif' : ''}`}
            onClick={() => setOnglet(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'journal' && <Journal evenement={evenement} setMessage={setMessage} />}
      {onglet === 'missions' && (
        <Missions evenement={evenement} membre={membre} setMessage={setMessage} />
      )}
      {onglet === 'recherches' && (
        <Recherches evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'fiches' && <Fiches evenement={evenement} />}
    </div>
  )
}

/* ================================================================== */
/* Main courante                                                       */
/* ================================================================== */

function Journal({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [texte, setTexte] = useState('')
  const [filtre, setFiltre] = useState('tout')
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('journal')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('horodatage', { ascending: false })
      .limit(200)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function ajouter() {
    if (!texte.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('journal').insert({
      evenement_id: evenement.id,
      source: 'saisie',
      module: 'securite',
      categorie: 'observation',
      texte: texte.trim(),
      phase: evenement.phase
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setTexte('')
      charger()
    }
    setOccupe(false)
  }

  const visibles = lignes.filter((l) =>
    filtre === 'tout'
      ? true
      : filtre === 'saisie'
        ? l.source === 'saisie'
        : l.importance === 'majeur'
  )

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ajouter()}
          placeholder="Observation, décision, appel radio…"
        />
        <button disabled={occupe || !texte.trim()} onClick={ajouter}>
          Inscrire
        </button>
      </div>

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['tout', 'Tout'],
          ['majeur', 'Majeur'],
          ['saisie', 'Saisies']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucune entrée.</p>
      ) : (
        <ul className="chrono">
          {visibles.map((l) => (
            <li key={l.id} className={`imp-${l.importance} src-${l.source}`}>
              <span className="heure mono">
                {new Date(l.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {l.texte}
                {l.module && <span className="tag">{l.module}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="aide">
        Les entrées grises sont écrites automatiquement par les autres modules. Rien ne peut
        être modifié ni supprimé : une main courante qui se réécrit n'a aucune valeur.
      </p>
    </>
  )
}

/* ================================================================== */
/* Missions                                                            */
/* ================================================================== */

const STATUTS_MISSION = [
  ['a_traiter', 'À traiter'],
  ['attribuee', 'Attribuée'],
  ['en_cours', 'En cours'],
  ['resolue', 'Résolue'],
  ['annulee', 'Annulée']
]

const PRIORITES = ['P1', 'P2', 'P3', 'P4']

function Missions({ evenement, membre, setMessage }) {
  const [missions, setMissions] = useState([])
  const [equipes, setEquipes] = useState([])
  const [masquerClos, setMasquerClos] = useState(true)
  const [titre, setTitre] = useState('')
  const [priorite, setPriorite] = useState('P3')
  const [module, setModule] = useState('securite')
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const [m, e] = await Promise.all([
      supabase
        .from('missions')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('created_at', { ascending: false }),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id)
    ])
    if (m.error) setMessage({ type: 'erreur', texte: m.error.message })
    else setMissions(m.data ?? [])
    setEquipes(e.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function creer() {
    setOccupe(true)
    const { error } = await supabase.from('missions').insert({
      evenement_id: evenement.id,
      module,
      titre: titre.trim(),
      priorite,
      phase: evenement.phase
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setTitre('')
      charger()
    }
    setOccupe(false)
  }

  async function modifier(id, champs) {
    const { error, count } = await supabase
      .from('missions')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    // RLS filtre silencieusement : zéro ligne touchée = refus, pas succès
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  const visibles = masquerClos
    ? missions.filter((m) => !['resolue', 'annulee'].includes(m.statut))
    : missions

  const ouvertes = missions.filter((m) => !['resolue', 'annulee'].includes(m.statut))
  const p1 = ouvertes.filter((m) => m.priorite === 'P1').length

  return (
    <>
      <div className="compteurs">
        <span>
          Ouvertes <strong>{ouvertes.length}</strong>
        </span>
        <span className={p1 ? 'alerte-texte' : ''}>
          P1 <strong>{p1}</strong>
        </span>
        <span>
          Total <strong>{missions.length}</strong>
        </span>
      </div>

      <div className="saisie-rapide">
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && titre.trim() && creer()}
          placeholder="Nouvelle mission…"
        />
        <select
          value={priorite}
          onChange={(e) => setPriorite(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {PRIORITES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          value={module}
          onChange={(e) => setModule(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {['securite', 'logistique', 'sanitaire', 'parcours', 'montage'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <button disabled={occupe || !titre.trim()} onClick={creer}>
          Créer
        </button>
      </div>

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button className="discret" onClick={() => setMasquerClos(!masquerClos)}>
          {masquerClos ? 'Afficher les clôturées' : 'Masquer les clôturées'}
        </button>
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucune mission ouverte.</p>
      ) : (
        visibles.map((m) => (
          <div className="carte" key={m.id}>
            <div className="titre">
              <span className="mono">{m.reference}</span>{' '}
              <span className={`jeton prio-${m.priorite}`}>{m.priorite}</span> {m.titre}
            </div>
            {m.description && <p style={{ margin: '4px 0' }}>{m.description}</p>}
            <div className="meta">
              <span>{m.module}</span>
              {m.signalement_id && <span>issue d'un signalement</span>}
              {m.delai_reel_min != null && <span>{m.delai_reel_min} min</span>}
              {m.latitude && (
                <span className="mono">
                  {m.latitude.toFixed(4)} · {m.longitude.toFixed(4)}
                </span>
              )}
            </div>
            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <select
                value={m.statut}
                onChange={(e) => modifier(m.id, { statut: e.target.value })}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                {STATUTS_MISSION.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                value={m.equipe_id ?? ''}
                onChange={(e) => modifier(m.id, { equipe_id: e.target.value || null })}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                <option value="">— équipe —</option>
                {equipes.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))
      )}
    </>
  )
}

/* ================================================================== */
/* Recherches de personne                                              */
/* ================================================================== */

function Recherches({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({
    nom: '',
    age_approx: '',
    description: '',
    dernier_lieu: '',
    point_regroupement: '',
    accompagnant_nom: '',
    accompagnant_tel: ''
  })
  const [occupe, setOccupe] = useState(false)

  async function charger() {
    const { data, error } = await supabase
      .from('recherches')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 15000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function declarer() {
    setOccupe(true)
    const numero = lignes.length + 1
    const { error } = await supabase.from('recherches').insert({
      evenement_id: evenement.id,
      reference: 'REC-' + String(numero).padStart(2, '0'),
      ...f,
      age_approx: f.age_approx ? Number(f.age_approx) : null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({
        nom: '',
        age_approx: '',
        description: '',
        dernier_lieu: '',
        point_regroupement: '',
        accompagnant_nom: '',
        accompagnant_tel: ''
      })
      setOuvrir(false)
      charger()
    }
    setOccupe(false)
  }

  async function cloturer(id, circonstances) {
    const { error } = await supabase
      .from('recherches')
      .update({ statut: 'retrouve', retrouve_le: new Date().toISOString(), circonstances })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  const actives = lignes.filter((l) => l.statut === 'en_cours')

  return (
    <>
      {actives.length > 0 && (
        <div className="message erreur">
          {actives.length} recherche(s) en cours — diffusion à toutes les équipes
        </div>
      )}

      <button className="discret" onClick={() => setOuvrir(!ouvrir)}>
        {ouvrir ? 'Annuler' : 'Déclarer une recherche'}
      </button>

      {ouvrir && (
        <div className="formulaire">
          {[
            ['nom', 'Nom / prénom'],
            ['age_approx', 'Âge approximatif'],
            ['description', 'Description — vêtements, signes distinctifs'],
            ['dernier_lieu', 'Vu pour la dernière fois'],
            ['point_regroupement', 'Point de regroupement'],
            ['accompagnant_nom', 'Accompagnant'],
            ['accompagnant_tel', 'Téléphone accompagnant']
          ].map(([k, l]) => (
            <div key={k}>
              <label htmlFor={k}>{l}</label>
              <input
                id={k}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </div>
          ))}
          <button disabled={occupe || !f.description.trim()} onClick={declarer}>
            Déclarer et diffuser
          </button>
          <p className="aide">
            La description compte plus que le nom : c'est elle qui permet de reconnaître la
            personne sur le terrain.
          </p>
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="vide">Aucune recherche.</p>
      ) : (
        lignes.map((l) => (
          <div className={`carte ${l.statut === 'en_cours' ? 'urgent' : ''}`} key={l.id}>
            <div className="titre">
              <span className="mono">{l.reference}</span> — {l.nom || 'Personne non identifiée'}
              {l.age_approx ? `, ${l.age_approx} ans` : ''}
            </div>
            <p style={{ margin: '4px 0' }}>{l.description}</p>
            <div className="meta">
              {l.dernier_lieu && <span>vu·e : {l.dernier_lieu}</span>}
              {l.point_regroupement && <span>regroupement : {l.point_regroupement}</span>}
              {l.accompagnant_tel && <span>{l.accompagnant_tel}</span>}
              <span className="jeton">{l.statut}</span>
            </div>
            {l.statut === 'en_cours' && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button
                  onClick={() => {
                    const c = prompt('Circonstances ?')
                    if (c !== null) cloturer(l.id, c)
                  }}
                >
                  Retrouvé·e
                </button>
              </div>
            )}
            {l.circonstances && <p className="aide">{l.circonstances}</p>}
          </div>
        ))
      )}
    </>
  )
}

/* ================================================================== */
/* Fiches réflexe                                                      */
/* ================================================================== */

function Fiches({ evenement }) {
  const [fiches, setFiches] = useState(null)
  const [ouverte, setOuverte] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [note, setNote] = useState(null)

  async function charger() {
    const { data } = await supabase
      .from('fiches_reflexe')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('ordre')
    setFiches(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function installerPack() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('installer_fiches_standard', {
      p_evenement: evenement.id
    })
    setNote(
      error
        ? error.message
        : `${data} fiche(s) installée(s). Adapte-les à ton site : une fiche générique ne vaut que comme point de départ.`
    )
    setOccupe(false)
    charger()
  }

  if (fiches === null) return <p className="vide">…</p>

  const entete = (
    <>
      {note && <div className="message">{note}</div>}
      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button className="discret" disabled={occupe} onClick={installerPack}>
          Installer le pack standard (8 fiches)
        </button>
      </div>
    </>
  )

  if (!fiches.length)
    return (
      <>
        {entete}
        <p className="vide">
          Aucune fiche réflexe. Les conduites à tenir doivent être disponibles avant
          l'événement, pas pendant.
        </p>
      </>
    )

  return (
    <>
      {entete}
      {fiches.map((fi) => (
    <div className="carte" key={fi.id}>
      <div
        className="titre"
        style={{ cursor: 'pointer' }}
        onClick={() => setOuverte(ouverte === fi.id ? null : fi.id)}
      >
        <span className="mono">{fi.code}</span> — {fi.titre}
      </div>
      {fi.declencheur && <div className="meta"><span>{fi.declencheur}</span></div>}
      {ouverte === fi.id && (
        <div style={{ marginTop: 10 }}>
          <ol className="liste-pave">
            {(fi.conduite ?? []).map((etape, i) => (
              <li key={i}>{etape}</li>
            ))}
          </ol>
          {(fi.a_ne_pas_faire ?? []).length > 0 && (
            <>
              <div className="pave-titre" style={{ marginTop: 10 }}>
                À ne pas faire
              </div>
              <ul className="liste-pave">
                {fi.a_ne_pas_faire.map((x, i) => (
                  <li key={i} className="alerte-texte">
                    {x}
                  </li>
                ))}
              </ul>
            </>
          )}
          {fi.contacts && <p className="aide">{fi.contacts}</p>}
        </div>
      )}
    </div>
      ))}
    </>
  )
}
