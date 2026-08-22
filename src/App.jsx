import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import ImportCsv from './ImportCsv'
import PcOps from './PcOps'
import Dashboard from './Dashboard'
import Participant from './Participant'
import { RESSOURCES } from './colonnesImport'

const PHASES = ['preparation', 'montage', 'exploitation', 'demontage', 'cloture']
const GEOMETRIES = [
  ['site_ferme', 'Site fermé'],
  ['parcours', 'Parcours'],
  ['hybride', 'Hybride']
]
const ROLES = ['coordinateur', 'chef_equipe', 'benevole', 'observateur']

export default function App() {
  const [session, setSession] = useState(null)
  const [chargement, setChargement] = useState(true)

  // Chemin public : ?sos=<jeton_public>.
  // Aucune authentification, aucun accès aux tables — la page ne sait
  // appeler que les deux fonctions RPC publiques.
  const jetonSos = new URLSearchParams(window.location.search).get('sos')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChargement(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (jetonSos) return <Participant jeton={jetonSos} />

  if (chargement) return <div className="enveloppe">Chargement…</div>

  return (
    <div className="enveloppe">
      <div className="bandeau">
        <h1>Eventware 2.0 — validation du socle</h1>
        {session && (
          <span className="session">
            {session.user.email}
            {' · '}
            <button
              className="discret"
              style={{ padding: '0 4px', border: 'none', fontSize: 12 }}
              onClick={() => supabase.auth.signOut()}
            >
              se déconnecter
            </button>
          </span>
        )}
      </div>
      {session ? <Espace session={session} /> : <Connexion />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

function Connexion() {
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [message, setMessage] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function agir(mode) {
    setOccupe(true)
    setMessage(null)
    const fn =
      mode === 'creer'
        ? supabase.auth.signUp({ email, password: motDePasse })
        : supabase.auth.signInWithPassword({ email, password: motDePasse })
    const { data, error } = await fn
    if (error) {
      setMessage({ type: 'erreur', texte: error.message })
    } else if (mode === 'creer' && !data.session) {
      setMessage({
        type: 'info',
        texte:
          "Compte créé. La confirmation par e-mail est active sur le projet : désactive-la dans Authentication → Sign In / Providers pour tester sans boîte mail."
      })
    }
    setOccupe(false)
  }

  return (
    <section>
      <h2>Accès</h2>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}
      <label htmlFor="email">Adresse e-mail</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
      />
      <label htmlFor="mdp">Mot de passe</label>
      <input
        id="mdp"
        type="password"
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        autoComplete="current-password"
      />
      <div className="ligne-boutons">
        <button disabled={occupe || !email || !motDePasse} onClick={() => agir('entrer')}>
          Se connecter
        </button>
        <button
          className="discret"
          disabled={occupe || !email || !motDePasse}
          onClick={() => agir('creer')}
        >
          Créer un compte
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Espace connecté                                                     */
/* ------------------------------------------------------------------ */

function Espace({ session }) {
  const [evenements, setEvenements] = useState([])
  const [message, setMessage] = useState(null)
  const [selection, setSelection] = useState(null)
  const [compteur, setCompteur] = useState(0)

  async function charger() {
    const { data, error } = await supabase
      .from('evenements')
      .select('id, nom, slug, geometrie, phase, jeton_public, point_0_lat, point_0_lon, modules, membres_evenement(id, role, user_id, nom_affiche, perimetre, paves)')
      .order('nom')

    if (error) return setMessage({ type: 'erreur', texte: error.message })
    setEvenements(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [session.user.id])

  return (
    <>
      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      <section>
        <h2>Mes événements</h2>
        {evenements.length === 0 ? (
          <p className="vide">
            Aucun événement visible. Crée le premier ci-dessous, ou fais-toi ajouter à un
            événement existant.
          </p>
        ) : (
          evenements.map((e) => {
            const moi = e.membres_evenement.find((m) => m.user_id === session.user.id)
            return (
              <div className="carte" key={e.id}>
                <div className="titre">{e.nom}</div>
                <div className="meta">
                  <span>{e.slug}</span>
                  <span>{e.geometrie}</span>
                  <span className="jeton phase">{e.phase}</span>
                  {moi && <span className={`jeton ${moi.role}`}>{moi.role}</span>}
                  <span>{e.membres_evenement.length} membre(s)</span>
                </div>
                {moi && (
                  <Dashboard evenement={e} membre={moi} onFait={charger} />
                )}
                {moi?.role === 'admin' && (
                  <div className="ligne-boutons" style={{ marginTop: 10 }}>
                    <button
                      className="discret"
                      onClick={() => setSelection(selection === e.id ? null : e.id)}
                    >
                      {selection === e.id ? 'Fermer' : 'Ouvrir'}
                    </button>
                    <BasculePhase evenement={e} onFait={charger} setMessage={setMessage} />
                  </div>
                )}
                {selection === e.id && (
                  <div className="detail">
                    <Modules evenement={e} onFait={charger} setMessage={setMessage} />
                    {e.modules?.sos_participants && <PcOps evenement={e} />}
                    <Compteurs evenementId={e.id} cle={compteur} />
                    <ImportCsv
                      evenementId={e.id}
                      onFait={() => setCompteur((c) => c + 1)}
                    />
                    <AjoutMembre
                      evenementId={e.id}
                      onFait={charger}
                      setMessage={setMessage}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>

      <CreationEvenement onFait={charger} setMessage={setMessage} />

      <section>
        <h2>Mon identifiant</h2>
        <p className="vide" style={{ paddingTop: 0 }}>
          À transmettre à un administrateur pour être ajouté à son événement.
        </p>
        <div className="identifiant">{session.user.id}</div>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Modules activés                                                     */
/* ------------------------------------------------------------------ */

const MODULES = [
  ['securite', 'Sécurité'],
  ['logistique', 'Logistique'],
  ['rh', 'Bénévoles'],
  ['sos_participants', 'SOS participants'],
  ['plan_implantation', 'Plan d\'implantation'],
  ['analyse', 'Analyse / REX']
]

function Modules({ evenement, onFait, setMessage }) {
  const [occupe, setOccupe] = useState(false)

  async function basculer(clef) {
    setOccupe(true)
    const modules = { ...evenement.modules, [clef]: !evenement.modules?.[clef] }
    const { error } = await supabase
      .from('evenements')
      .update({ modules })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="modules">
      <h2>Modules</h2>
      <div className="ligne-boutons">
        {MODULES.map(([k, libelle]) => (
          <button
            key={k}
            disabled={occupe}
            className={evenement.modules?.[k] ? 'module actif' : 'module'}
            onClick={() => basculer(k)}
          >
            {libelle}
          </button>
        ))}
      </div>
      <p className="aide">
        Un module désactivé masque ses écrans et ses pavés. Le SOS participants ne reçoit
        rien tant qu'il est éteint, même si le lien circule.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Compteurs de référentiel                                            */
/* ------------------------------------------------------------------ */

function Compteurs({ evenementId, cle }) {
  const [comptes, setComptes] = useState(null)

  useEffect(() => {
    let vivant = true
    async function charger() {
      const entrees = await Promise.all(
        Object.entries(RESSOURCES).map(async ([k, r]) => {
          const { count } = await supabase
            .from(r.table)
            .select('id', { count: 'exact', head: true })
            .eq('evenement_id', evenementId)
          return [r.libelle, count ?? 0]
        })
      )
      if (vivant) setComptes(entrees)
    }
    charger()
    return () => {
      vivant = false
    }
  }, [evenementId, cle])

  if (!comptes) return null

  return (
    <div className="compteurs">
      {comptes.map(([libelle, n]) => (
        <span key={libelle}>
          {libelle} <strong>{n}</strong>
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Création d'événement                                                */
/* ------------------------------------------------------------------ */

function CreationEvenement({ onFait, setMessage }) {
  const [nom, setNom] = useState('')
  const [slug, setSlug] = useState('')
  const [geometrie, setGeometrie] = useState('site_ferme')
  const [occupe, setOccupe] = useState(false)

  async function creer() {
    setOccupe(true)
    setMessage(null)
    const { error } = await supabase
      .from('evenements')
      .insert({ nom, slug, geometrie })
    if (error) {
      setMessage({ type: 'erreur', texte: error.message })
    } else {
      setNom('')
      setSlug('')
      onFait()
    }
    setOccupe(false)
  }

  return (
    <section>
      <h2>Créer un événement</h2>
      <label htmlFor="nom">Nom</label>
      <input
        id="nom"
        value={nom}
        onChange={(e) => {
          setNom(e.target.value)
          setSlug(
            e.target.value
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
          )
        }}
      />
      <label htmlFor="slug">Identifiant court</label>
      <input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      <label htmlFor="geo">Géométrie</label>
      <select id="geo" value={geometrie} onChange={(e) => setGeometrie(e.target.value)}>
        {GEOMETRIES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <button disabled={occupe || !nom || !slug} onClick={creer}>
        Créer l'événement
      </button>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Ajout d'un membre                                                   */
/* ------------------------------------------------------------------ */

function AjoutMembre({ evenementId, onFait, setMessage }) {
  const [userId, setUserId] = useState('')
  const [nomAffiche, setNomAffiche] = useState('')
  const [role, setRole] = useState('benevole')
  const [occupe, setOccupe] = useState(false)

  async function ajouter() {
    setOccupe(true)
    setMessage(null)
    const { error } = await supabase.from('membres_evenement').insert({
      evenement_id: evenementId,
      user_id: userId.trim(),
      role,
      nom_affiche: nomAffiche || null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--trait)' }}>
      <label htmlFor="uid">Identifiant de la personne</label>
      <input
        id="uid"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="collé depuis son écran « Mon identifiant »"
      />
      <label htmlFor="na">Nom affiché</label>
      <input id="na" value={nomAffiche} onChange={(e) => setNomAffiche(e.target.value)} />
      <label htmlFor="role">Rôle</label>
      <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button disabled={occupe || !userId} onClick={ajouter}>
        Ajouter au dispositif
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bascule de phase                                                    */
/* ------------------------------------------------------------------ */

function BasculePhase({ evenement, onFait, setMessage }) {
  const [occupe, setOccupe] = useState(false)

  async function basculer(phase) {
    setOccupe(true)
    setMessage(null)
    const { error } = await supabase
      .from('evenements')
      .update({ phase })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <select
      value={evenement.phase}
      disabled={occupe}
      style={{ width: 'auto', marginBottom: 0 }}
      onChange={(e) => basculer(e.target.value)}
    >
      {PHASES.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  )
}
