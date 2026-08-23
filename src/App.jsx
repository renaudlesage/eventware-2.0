import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Participant from './Participant'
import Dashboard from './Dashboard'
import Terrain from './Terrain'
import Memento from './Memento'
import Securite from './Securite'
import Logistique from './Logistique'
import Parcours from './Parcours'
import Rh from './Rh'
import Analyse from './Analyse'
import PlanImplantation from './PlanImplantation'
import PcOps from './PcOps'
import QrCodes from './QrCodes'
import ImportCsv from './ImportCsv'
import Bandeau, { GestionAlertes } from './Bandeau'
import { RESSOURCES } from './colonnesImport'

const PHASES = ['preparation', 'montage', 'exploitation', 'demontage', 'cloture']

const GEOMETRIES = [
  ['site_ferme', 'Site fermé'],
  ['parcours', 'Parcours'],
  ['hybride', 'Hybride']
]

const ROLES = ['coordinateur', 'chef_equipe', 'benevole', 'observateur']

const MODULES = [
  ['securite', 'Sécurité'],
  ['logistique', 'Logistique'],
  ['rh', 'Bénévoles'],
  ['parcours', 'Parcours'],
  ['sos_participants', 'SOS participants'],
  ['plan_implantation', "Plan d'implantation"],
  ['analyse', 'Analyse / REX']
]

/*
 * Navigation.
 *
 * `roles` liste qui VOIT l'écran. C'est une couche d'affichage, pas de
 * sécurité : les données restent protégées par RLS quoi qu'il arrive.
 * Mais un écran qu'on n'a pas à utiliser ne doit pas encombrer la
 * navigation — un bénévole qui découvre l'app le samedi matin doit
 * trouver ses trois écrans, pas onze.
 */
const TOUS = ['admin', 'coordinateur', 'chef_equipe', 'benevole', 'observateur']
const ENCADREMENT = ['admin', 'coordinateur', 'chef_equipe']
const DIRECTION = ['admin', 'coordinateur']

const ECRANS = [
  { clef: 'accueil', libelle: 'Poste', module: null, roles: TOUS },
  { clef: 'terrain', libelle: 'Mon terrain', module: null,
    roles: ['admin', 'coordinateur', 'chef_equipe', 'benevole'] },
  { clef: 'memento', libelle: 'Mémento', module: null, roles: TOUS },
  { clef: 'securite', libelle: 'Sécurité', module: 'securite', roles: ENCADREMENT },
  { clef: 'sos', libelle: 'Signalements', module: 'sos_participants', roles: ENCADREMENT },
  { clef: 'logistique', libelle: 'Logistique', module: 'logistique',
    roles: ['admin', 'coordinateur', 'chef_equipe', 'benevole'] },
  { clef: 'parcours', libelle: 'Parcours', module: 'parcours',
    roles: ['admin', 'coordinateur', 'chef_equipe', 'benevole'] },
  { clef: 'rh', libelle: 'Bénévoles', module: 'rh', roles: ENCADREMENT },
  { clef: 'plan', libelle: 'Implantation', module: 'plan_implantation', roles: TOUS },
  { clef: 'analyse', libelle: 'Analyse', module: 'analyse', roles: DIRECTION },
  { clef: 'reglages', libelle: 'Réglages', module: null, roles: ['admin'] }
]

export default function App() {
  const [session, setSession] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [theme, setTheme] = useState(
    () => localStorage.getItem('eventware.theme') ?? 'auto'
  )

  const parametres = new URLSearchParams(window.location.search)
  const jetonSos = parametres.get('sos')
  const codeLieu = parametres.get('lieu')

  useEffect(() => {
    const racine = document.documentElement
    if (theme === 'auto') racine.removeAttribute('data-theme')
    else racine.setAttribute('data-theme', theme)
    localStorage.setItem('eventware.theme', theme)
  }, [theme])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChargement(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (jetonSos) return <Participant jeton={jetonSos} codeLieu={codeLieu} />
  if (chargement) return <div className="attente">Chargement…</div>
  if (!session) return <Connexion theme={theme} setTheme={setTheme} />

  return <Poste session={session} theme={theme} setTheme={setTheme} />
}

/* ================================================================== */
/* Connexion                                                           */
/* ================================================================== */

function Connexion({ theme, setTheme }) {
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [message, setMessage] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function agir(mode) {
    setOccupe(true)
    setMessage(null)
    const { data, error } =
      mode === 'creer'
        ? await supabase.auth.signUp({ email, password: motDePasse })
        : await supabase.auth.signInWithPassword({ email, password: motDePasse })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (mode === 'creer' && !data.session)
      setMessage({
        type: 'info',
        texte:
          'Compte créé. La confirmation par e-mail est active : désactive-la dans Supabase pour tester sans boîte mail.'
      })
    setOccupe(false)
  }

  const pret = email.trim() && motDePasse.trim()

  return (
    <div className="acces">
      <div className="acces-carte">
        <div className="marque">
          <span className="marque-nom">Eventware</span>
          <span className="marque-suite">2.0</span>
        </div>
        <p className="acces-role">Coordination d'événement</p>

        {message && (
          <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
            {message.texte}
          </div>
        )}

        <label htmlFor="email">Adresse e-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="mdp">Mot de passe</label>
        <input
          id="mdp"
          type="password"
          autoComplete="current-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />

        <button className="principal" disabled={occupe || !pret} onClick={() => agir('entrer')}>
          Se connecter
        </button>
        <button className="discret" disabled={occupe || !pret} onClick={() => agir('creer')}>
          Créer un compte
        </button>

        {!pret && (
          <p className="aide">Saisis une adresse et un mot de passe pour continuer.</p>
        )}

        <BasculeTheme theme={theme} setTheme={setTheme} />
      </div>
    </div>
  )
}

/* ================================================================== */
/* Poste de travail                                                    */
/* ================================================================== */

function Poste({ session, theme, setTheme }) {
  const [evenements, setEvenements] = useState([])
  const [courantId, setCourantId] = useState(
    () => localStorage.getItem('eventware.evenement') ?? null
  )
  const [ecran, setEcran] = useState('accueil')
  const [message, setMessage] = useState(null)
  const [chargement, setChargement] = useState(true)

  async function charger() {
    const { data, error } = await supabase
      .from('evenements')
      .select(
        'id, nom, slug, geometrie, phase, jeton_public, point_0_lat, point_0_lon, modules, membres_evenement(id, role, user_id, nom_affiche, perimetre, paves, equipe_id)'
      )
      .order('nom')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setEvenements(data ?? [])
    setChargement(false)
  }

  useEffect(() => {
    charger()
  }, [session.user.id])

  useEffect(() => {
    if (courantId) localStorage.setItem('eventware.evenement', courantId)
  }, [courantId])

  const courant = evenements.find((e) => e.id === courantId) ?? evenements[0] ?? null
  const moi = courant?.membres_evenement.find((m) => m.user_id === session.user.id)

  const visibles = ECRANS.filter((e) => {
    if (e.module && !courant?.modules?.[e.module]) return false
    if (!moi || !e.roles.includes(moi.role)) return false
    return true
  })

  useEffect(() => {
    if (courant && !visibles.some((e) => e.clef === ecran)) setEcran('accueil')
  }, [courantId, JSON.stringify(courant?.modules)])

  if (chargement) return <div className="attente">Chargement…</div>

  return (
    <div className="poste">
      <div className="tete">
      <header className="barre">
        <div className="marque compacte">
          <span className="marque-nom">Eventware</span>
        </div>

        {evenements.length > 0 && (
          <select
            className="selecteur-evenement"
            value={courant?.id ?? ''}
            onChange={(e) => {
              setCourantId(e.target.value)
              setEcran('accueil')
            }}
          >
            {evenements.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </select>
        )}

        {courant && <span className={`plaque phase-${courant.phase}`}>{courant.phase}</span>}
        {moi && <span className="plaque role">{moi.role}</span>}

        <span className="pousse" />
        <BasculeTheme theme={theme} setTheme={setTheme} compact />
        <button className="lien" onClick={() => supabase.auth.signOut()}>
          Quitter
        </button>
      </header>

      {courant && moi && (
        <BandeauEtat evenement={courant} membre={moi} onAller={setEcran} />
      )}
      </div>

      <Bandeau evenements={evenements} membre={session.user} />

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {!courant ? (
        <PremierEvenement session={session} onFait={charger} setMessage={setMessage} />
      ) : !moi ? (
        <p className="vide">Tu n'es pas membre de cet événement.</p>
      ) : (
        <div className="corps">
          <nav className="plaques" aria-label="Modules">
            {visibles.map((e) => (
              <button
                key={e.clef}
                className={`plaque-nav ${ecran === e.clef ? 'actif' : ''}`}
                onClick={() => setEcran(e.clef)}
              >
                {e.libelle}
              </button>
            ))}
          </nav>

          <main className="travail">
            <Ecran
              clef={ecran}
              evenement={courant}
              membre={moi}
              session={session}
              onRecharger={charger}
              setMessage={setMessage}
            />
          </main>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/* Bandeau d'état — ce qu'on regarde toutes les trente secondes        */
/* ================================================================== */

function BandeauEtat({ evenement, membre, onAller }) {
  const [c, setC] = useState({})
  const [enLigne, setEnLigne] = useState(navigator.onLine)

  async function compter() {
    const m = evenement.modules ?? {}
    const taches = [
      supabase
        .from('missions')
        .select('id', { count: 'exact', head: true })
        .eq('evenement_id', evenement.id)
        .eq('priorite', 'P1')
        .not('statut', 'in', '("resolue","annulee")')
        .then(({ count }) => ['p1', count ?? 0])
    ]

    if (m.sos_participants)
      taches.push(
        supabase
          .from('signalements')
          .select('id', { count: 'exact', head: true })
          .eq('evenement_id', evenement.id)
          .in('statut', ['recu', 'pris_en_charge', 'en_cours'])
          .then(({ count }) => ['sos', count ?? 0])
      )

    if (m.parcours)
      taches.push(
        supabase
          .rpc('groupes_sans_nouvelles', { p_evenement: evenement.id, p_minutes: 45 })
          .then(({ data }) => ['retards', (data ?? []).length])
      )

    if (m.rh)
      taches.push(
        supabase
          .rpc('couverture_creneaux', {
            p_evenement: evenement.id,
            p_depuis: new Date().toISOString()
          })
          .then(({ data }) => [
            'manque',
            (data ?? []).reduce((n, l) => n + (l.manque ?? 0), 0)
          ])
      )

    setC(Object.fromEntries(await Promise.all(taches)))
  }

  useEffect(() => {
    compter()
    const t = setInterval(compter, 25000)
    const on = () => setEnLigne(true)
    const off = () => setEnLigne(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [evenement.id, JSON.stringify(evenement.modules)])

  // Un cadran ne s'affiche que si la personne peut agir dessus.
  const encadrement = ['admin', 'coordinateur', 'chef_equipe'].includes(membre?.role)

  const cases = [
    { clef: 'p1', libelle: 'P1 ouvertes', valeur: c.p1, vers: encadrement ? 'securite' : 'terrain', pour: true },
    { clef: 'sos', libelle: 'Signalements', valeur: c.sos, vers: 'sos', pour: encadrement },
    { clef: 'retards', libelle: 'Sans nouvelles', valeur: c.retards, vers: 'parcours', pour: encadrement },
    { clef: 'manque', libelle: 'Postes à couvrir', valeur: c.manque, vers: 'rh', pour: encadrement }
  ].filter((x) => x.valeur !== undefined && x.pour)

  return (
    <div className="etat">
      {cases.map((x) => (
        <button
          key={x.clef}
          className={`cadran ${x.valeur > 0 ? 'chaud' : ''}`}
          onClick={() => onAller(x.vers)}
        >
          <span className="cadran-valeur">{x.valeur}</span>
          <span className="cadran-libelle">{x.libelle}</span>
        </button>
      ))}
      <div className={`cadran reseau ${enLigne ? '' : 'chaud'}`}>
        <span className="cadran-valeur">{enLigne ? '—' : '!'}</span>
        <span className="cadran-libelle">{enLigne ? 'en ligne' : 'hors réseau'}</span>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Aiguillage                                                          */
/* ================================================================== */

function Ecran({ clef, evenement, membre, session, onRecharger, setMessage }) {
  switch (clef) {
    case 'accueil':
      return (
        <>
          <Dashboard evenement={evenement} membre={membre} onFait={onRecharger} />
          {['admin', 'coordinateur'].includes(membre.role) && (
            <GestionAlertes evenement={evenement} setMessage={setMessage} />
          )}
        </>
      )
    case 'terrain':
      return <Terrain evenement={evenement} membre={membre} />
    case 'memento':
      return <Memento evenement={evenement} />
    case 'securite':
      return <Securite evenement={evenement} membre={membre} />
    case 'sos':
      return (
        <>
          <PcOps evenement={evenement} />
          <QrCodes evenement={evenement} />
        </>
      )
    case 'logistique':
      return <Logistique evenement={evenement} membre={membre} />
    case 'parcours':
      return <Parcours evenement={evenement} membre={membre} />
    case 'rh':
      return <Rh evenement={evenement} membre={membre} />
    case 'plan':
      return <PlanImplantation evenement={evenement} membre={membre} />
    case 'analyse':
      return <Analyse evenement={evenement} membre={membre} />
    case 'reglages':
      return (
        <Reglages
          evenement={evenement}
          session={session}
          onRecharger={onRecharger}
          setMessage={setMessage}
        />
      )
    default:
      return null
  }
}

/* ================================================================== */
/* Réglages                                                            */
/* ================================================================== */

function Reglages({ evenement, session, onRecharger, setMessage }) {
  const [occupe, setOccupe] = useState(false)
  const [compteur, setCompteur] = useState(0)

  async function basculerModule(clef) {
    setOccupe(true)
    const modules = { ...evenement.modules, [clef]: !evenement.modules?.[clef] }
    const { error } = await supabase
      .from('evenements')
      .update({ modules })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onRecharger()
    setOccupe(false)
  }

  async function changerPhase(phase) {
    const { error, count } = await supabase
      .from('evenements')
      .update({ phase }, { count: 'exact' })
      .eq('id', evenement.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Changement refusé.' })
    else onRecharger()
  }

  return (
    <>
      <section className="bloc">
        <h2>Phase</h2>
        <div className="plaques">
          {PHASES.map((p) => (
            <button
              key={p}
              className={`plaque-nav ${evenement.phase === p ? 'actif' : ''}`}
              onClick={() => changerPhase(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="aide">
          La phase ouvre et ferme des droits d'écriture. Elle est réversible : on repasse en
          montage le vendredi soir sans que ce soit un incident.
        </p>
      </section>

      <section className="bloc">
        <h2>Modules</h2>
        <div className="plaques">
          {MODULES.map(([k, libelle]) => (
            <button
              key={k}
              disabled={occupe}
              className={`plaque-nav ${evenement.modules?.[k] ? 'actif' : ''}`}
              onClick={() => basculerModule(k)}
            >
              {libelle}
            </button>
          ))}
        </div>
        <p className="aide">
          Un module éteint disparaît de la navigation et cesse de recevoir des données. Le
          SOS n'enregistre rien tant qu'il est éteint, même si le lien circule.
        </p>
      </section>

      <section className="bloc">
        <h2>Référentiels</h2>
        <Compteurs evenementId={evenement.id} cle={compteur} />
        <ImportCsv evenementId={evenement.id} onFait={() => setCompteur((c) => c + 1)} />
      </section>

      <section className="bloc">
        <h2>Membres</h2>
        <AjoutMembre evenementId={evenement.id} onFait={onRecharger} setMessage={setMessage} />
        <div className="identite">
          <span className="etiquette">Mon identifiant</span>
          <code>{session.user.id}</code>
          <p className="aide">
            À transmettre à un autre administrateur pour être ajouté à son événement.
          </p>
        </div>
      </section>

      <section className="bloc">
        <h2>Nouvel événement</h2>
        <CreationEvenement onFait={onRecharger} setMessage={setMessage} />
      </section>
    </>
  )
}

function Compteurs({ evenementId, cle }) {
  const [comptes, setComptes] = useState(null)

  useEffect(() => {
    let vivant = true
    Promise.all(
      Object.entries(RESSOURCES).map(async ([, r]) => {
        const { count } = await supabase
          .from(r.table)
          .select('id', { count: 'exact', head: true })
          .eq('evenement_id', evenementId)
        return [r.libelle, count ?? 0]
      })
    ).then((e) => vivant && setComptes(e))
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

function AjoutMembre({ evenementId, onFait, setMessage }) {
  const [userId, setUserId] = useState('')
  const [nomAffiche, setNomAffiche] = useState('')
  const [role, setRole] = useState('benevole')
  const [occupe, setOccupe] = useState(false)

  async function ajouter() {
    setOccupe(true)
    const { error } = await supabase.from('membres_evenement').insert({
      evenement_id: evenementId,
      user_id: userId.trim(),
      role,
      nom_affiche: nomAffiche || null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setUserId('')
      setNomAffiche('')
      onFait()
    }
    setOccupe(false)
  }

  return (
    <div className="saisie-rapide">
      <input
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="Identifiant de la personne"
      />
      <input
        value={nomAffiche}
        onChange={(e) => setNomAffiche(e.target.value)}
        placeholder="Nom affiché"
        style={{ flex: '0 1 170px' }}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={{ width: 'auto', marginBottom: 0 }}
      >
        {ROLES.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <button disabled={occupe || !userId.trim()} onClick={ajouter}>
        Ajouter
      </button>
    </div>
  )
}

function CreationEvenement({ onFait, setMessage }) {
  const [nom, setNom] = useState('')
  const [slug, setSlug] = useState('')
  const [geometrie, setGeometrie] = useState('site_ferme')
  const [occupe, setOccupe] = useState(false)

  async function creer() {
    setOccupe(true)
    const { error } = await supabase.from('evenements').insert({ nom, slug, geometrie })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setNom('')
      setSlug('')
      onFait()
    }
    setOccupe(false)
  }

  return (
    <>
      <div className="saisie-rapide">
        <input
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
          placeholder="Nom de l'événement"
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="Identifiant court"
          style={{ flex: '0 1 180px' }}
        />
        <select
          value={geometrie}
          onChange={(e) => setGeometrie(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {GEOMETRIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button disabled={occupe || !nom.trim() || !slug.trim()} onClick={creer}>
          Créer
        </button>
      </div>
      <p className="aide">
        Tu en deviens administrateur. La géométrie détermine les outils proposés : un
        parcours ouvre les bornes kilométriques, un site fermé les zones et les entrées.
      </p>
    </>
  )
}

function PremierEvenement({ session, onFait, setMessage }) {
  return (
    <div className="corps">
      <main className="travail">
        <section className="bloc">
          <h2>Aucun événement</h2>
          <p className="aide">
            Crée le premier, ou fais-toi ajouter à un événement existant en transmettant ton
            identifiant à son administrateur.
          </p>
          <CreationEvenement onFait={onFait} setMessage={setMessage} />
          <div className="identite">
            <span className="etiquette">Mon identifiant</span>
            <code>{session.user.id}</code>
          </div>
        </section>
      </main>
    </div>
  )
}

/* ================================================================== */

function BasculeTheme({ theme, setTheme, compact }) {
  const suivant = { auto: 'clair', clair: 'sombre', sombre: 'auto' }
  const libelle = { auto: 'Auto', clair: 'Jour', sombre: 'Nuit' }
  return (
    <button
      className={compact ? 'lien' : 'discret'}
      onClick={() => setTheme(suivant[theme])}
      title="Le QG tourne la nuit, le terrain en plein soleil"
    >
      {libelle[theme]}
    </button>
  )
}
