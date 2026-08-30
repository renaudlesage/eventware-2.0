import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Participant from './Participant'
import Autorite from './Autorite'
import Dashboard from './Dashboard'
import Terrain from './Terrain'
import Memento from './Memento'
import Securite from './Securite'
import Logistique from './Logistique'
import Parcours from './Parcours'
import Rh from './Rh'
import Analyse, { Constats } from './Analyse'
import PlanImplantation from './PlanImplantation'
import PcOps from './PcOps'
import QrCodes from './QrCodes'
import ImportCsv from './ImportCsv'
import ImportKml from './ImportKml'
import Bandeau, { GestionAlertes } from './Bandeau'
import Roles from './Roles'
import Situation from './Situation'
import AccesAutorite from './AccesAutorite'
import Plateforme from './Plateforme'
import Planning from './Planning'
import BoutonsFlottants from './BoutonsFlottants'
import { RESSOURCES } from './colonnesImport'
import { useCapacites } from './capacites'
import { Icone, DOMAINES } from './icones'

const PHASES = ['preparation', 'montage', 'exploitation', 'demontage', 'cloture']

const GEOMETRIES = [
  ['site_ferme', 'Site fermé'],
  ['parcours', 'Parcours'],
  ['hybride', 'Hybride']
]

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
/*
 * Chaque écran déclare la CAPACITÉ qui l'ouvre, pas une liste de rôles.
 * Un rôle inventé par un client obtient ainsi ses écrans sans qu'une
 * ligne de code soit écrite — c'était l'objet de la migration 025.
 *
 * `besoin: null` = ouvert à tout membre.
 */
const ECRANS = [
  // « Situation » est la vue d'ensemble du PC : elle suppose de pouvoir
  // agir sur l'ensemble, pas seulement de lire.
  { clef: 'situation',  libelle: 'Situation',    module: null,                besoin: ['missions', 'creer'] },
  // « Mon poste » réunit les pavés personnels et les missions : un
  // bénévole n'a pas à naviguer entre deux écrans qui le concernent tous
  // les deux.
  { clef: 'accueil',    libelle: 'Mon poste',    module: null,                besoin: null },
  { clef: 'memento',    libelle: 'Mémento',      module: null,                besoin: null },
  { clef: 'planning',   libelle: 'Planning',     module: null,                besoin: null },
  { clef: 'securite',   libelle: 'Sécurité',     module: 'securite',          besoin: ['missions', 'creer'] },
  { clef: 'sos',        libelle: 'Signalements', module: 'sos_participants',  besoin: ['missions', 'creer'] },
  { clef: 'logistique', libelle: 'Logistique',   module: 'logistique',        besoin: ['logistique', 'lire'] },
  { clef: 'parcours',   libelle: 'Parcours',     module: 'parcours',          besoin: ['parcours', 'lire'] },
  { clef: 'rh',         libelle: 'Bénévoles',    module: 'rh',                besoin: ['rh', 'lire'] },
  { clef: 'plan',       libelle: 'Implantation', module: 'plan_implantation', besoin: ['plan_implantation', 'lire'] },
  { clef: 'analyse',    libelle: 'Analyse',      module: 'analyse',           besoin: ['analyse', 'modifier'] },
  { clef: 'reglages',   libelle: 'Réglages',     module: null,                besoin: 'tout_pouvoir' },
  // Console de l'éditeur : hors événement, réservée à l'exploitant.
  { clef: 'plateforme', libelle: 'Plateforme',   module: null,                besoin: 'exploitant' }
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
  const jetonAutorite = parametres.get('autorite')

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
  if (jetonAutorite) return <Autorite jeton={jetonAutorite} />
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
  const [ecran, setEcran] = useState('situation')
  const [message, setMessage] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [exploitant, setExploitant] = useState(false)

  useEffect(() => {
    supabase.rpc('est_exploitant').then(({ data }) => setExploitant(data === true))
  }, [session.user.id])

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

  const { peut, toutPouvoir, pret } = useCapacites(courant?.id, courant?.phase)

  const visibles = ECRANS.filter((e) => {
    if (e.module && !courant?.modules?.[e.module]) return false
    if (!moi) return false
    if (e.besoin === 'exploitant') return exploitant
    if (e.besoin === 'tout_pouvoir') return toutPouvoir
    if (e.besoin === null) return true
    return toutPouvoir || peut(e.besoin[0], e.besoin[1])
  })

  useEffect(() => {
    if (!pret || !courant) return
    // L'écran d'ouverture est la situation pour qui y a droit, son poste sinon.
    if (!visibles.some((e) => e.clef === ecran)) {
      setEcran(visibles.some((e) => e.clef === 'situation') ? 'situation' : 'accueil')
    }
  }, [courantId, pret, exploitant, JSON.stringify(courant?.modules)])

  if (chargement) return <div className="attente">Chargement…</div>

  return (
    <div className="poste">
      <div className="tete">
        <div className="barre-haut">
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
          <span className="pousse" />
          <Reseau />
          <BasculeTheme theme={theme} setTheme={setTheme} compact />
          <button className="discret sortie" onClick={() => supabase.auth.signOut()}>
            Quitter
          </button>
        </div>

        <div className="barre-bas">
          {courant && (
            <span className={`plaque phase-${courant.phase}`}>{courant.phase}</span>
          )}
          {moi && <span className="plaque role">{moi.role}</span>}
          <span className="pousse" />
          <span className="compte" title={session.user.email}>
            {session.user.email}
          </span>
        </div>

      {courant && moi && pret && (
        <BandeauEtat evenement={courant} peut={peut} toutPouvoir={toutPouvoir} onAller={setEcran} />
      )}
      </div>

      <Bandeau evenement={courant} />

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {!courant ? (
        <PremierEvenement session={session} onFait={charger} setMessage={setMessage} />
      ) : !moi ? (
        <div className="corps">
          <main className="travail">
            <section className="bloc">
              <h2>{courant.nom}</h2>
              {exploitant ? (
                <>
                  <p className="aide">
                    Tu vois cet événement en tant qu'exploitant de la plateforme, mais tu
                    n'en fais pas partie. Pour intervenir, rattache-toi au dispositif —
                    l'opération est inscrite dans la main courante du client.
                  </p>
                  <RejoindreEvenement
                    evenement={courant}
                    onFait={charger}
                    setMessage={setMessage}
                  />
                </>
              ) : (
                <p className="aide">
                  Tu n'es pas membre de cet événement. Demande à son coordinateur de
                  t'ajouter, en lui transmettant ton identifiant.
                </p>
              )}
            </section>
          </main>
        </div>
      ) : (
        <div className="corps">
          <nav className="plaques" aria-label="Modules">
            {visibles.map((e) => (
              <button
                key={e.clef}
                className={`plaque-nav dom-${DOMAINES[e.clef]?.teinte ?? 'gris'} ${
                  ecran === e.clef ? 'actif' : ''
                }`}
                onClick={() => setEcran(e.clef)}
              >
                <Icone domaine={e.clef} />
                <span>{e.libelle}</span>
              </button>
            ))}
          </nav>

          <main className="travail">
            <Ecran
              exploitant={exploitant}
              clef={ecran}
              evenement={courant}
              membre={moi}
              session={session}
              peut={peut}
              toutPouvoir={toutPouvoir}
              onAller={setEcran}
              onOuvrirEvenement={(id) => {
                setCourantId(id)
                setEcran('situation')
              }}
              onRecharger={charger}
              setMessage={setMessage}
            />
          </main>
        </div>
      )}

      {courant && moi && pret && (
        <BoutonsFlottants
          evenement={courant}
          membre={moi}
          peut={peut}
          toutPouvoir={toutPouvoir}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* Bandeau d'état — ce qu'on regarde toutes les trente secondes        */
/* ================================================================== */

/* Témoin de réseau : sa place est dans la barre, pas parmi les
   compteurs — ce n'est pas une charge de travail, c'est un état. */
function Reseau() {
  const [enLigne, setEnLigne] = useState(navigator.onLine)

  useEffect(() => {
    const on = () => setEnLigne(true)
    const off = () => setEnLigne(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return (
    <span className={`temoin ${enLigne ? '' : 'coupe'}`}>
      {enLigne ? 'en ligne' : 'hors réseau'}
    </span>
  )
}

function BandeauEtat({ evenement, peut, toutPouvoir, onAller }) {
  const [c, setC] = useState({})

  async function compter() {
    const m = evenement.modules ?? {}
    const taches = [
      supabase
        .from('maydays')
        .select('id', { count: 'exact', head: true })
        .eq('evenement_id', evenement.id)
        .in('statut', ['emis', 'accuse', 'en_cours'])
        .then(({ count }) => ['mayday', count ?? 0]),
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
    return () => clearInterval(t)
  }, [evenement.id, JSON.stringify(evenement.modules)])

  // Un cadran ne s'affiche que si la personne peut agir dessus.
  const encadrement = toutPouvoir || peut('missions', 'creer')

  const cases = [
    { clef: 'mayday', libelle: 'Mayday', valeur: c.mayday, vers: 'securite', pour: encadrement },
    { clef: 'p1', libelle: 'P1 ouvertes', valeur: c.p1, vers: 'securite', pour: encadrement },
    { clef: 'sos', libelle: 'Signalements', valeur: c.sos, vers: 'sos', pour: encadrement },
    { clef: 'retards', libelle: 'Sans nouvelles', valeur: c.retards, vers: 'parcours', pour: encadrement },
    { clef: 'manque', libelle: 'Postes à couvrir', valeur: c.manque, vers: 'rh', pour: encadrement }
  ].filter((x) => x.valeur !== undefined && x.pour)

  // Un cadran isolé n'est pas un tableau de bord : sans vue d'ensemble à
  // surveiller, le bandeau ne fait qu'occuper le haut de l'écran.
  if (cases.length < 2) return null

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
    </div>
  )
}

/* ================================================================== */
/* Aiguillage                                                          */
/* ================================================================== */

function Ecran({ clef, evenement, membre, session, peut, toutPouvoir, exploitant, onAller, onOuvrirEvenement, onRecharger, setMessage }) {
  switch (clef) {
    case 'situation':
      return (
        <Situation
          evenement={evenement}
          peut={peut}
          toutPouvoir={toutPouvoir}
          onAller={onAller}
        />
      )
    case 'accueil':
      return (
        <>
          <Dashboard
            evenement={evenement}
            membre={membre}
            peut={peut}
            onFait={onRecharger}
            onAller={onAller}
          />

          <Terrain evenement={evenement} membre={membre} />

          {/* Le REX à chaud reste ouvert à tous, y compris à qui n'a pas
              accès à l'écran Analyse : celui qui constate le problème est
              rarement celui qui exploitera les chiffres. */}
          {evenement.modules?.analyse && (toutPouvoir || peut('analyse', 'creer')) && (
            <section className="bloc rex-chaud">
              <h2>Signaler un constat</h2>
              <p className="aide">
                Quelque chose qui coince, qui a bien marché, ou qui mériterait de changer
                l'an prochain. À noter maintenant : un constat écrit sur le moment vaut dix
                reconstitués de mémoire trois semaines plus tard.
              </p>
              <Constats
                evenement={evenement}
                membre={membre}
                setMessage={setMessage}
                compact
              />
            </section>
          )}

          {(toutPouvoir || peut('alertes', 'creer')) && (
            <GestionAlertes evenement={evenement} setMessage={setMessage} />
          )}
          {/* Sortie de secours : accessible à TOUS les rôles, y compris ceux
              qui n'ont pas accès aux Réglages, et sans dépendre de la mise en
              page de la barre du haut. */}
          <section className="bloc session-bloc">
            <h2>Mon compte</h2>
            <p className="aide">Connecté en tant que {session.user.email}.</p>
            <div className="identite">
              <span className="etiquette">Mon identifiant</span>
              <code>{session.user.id}</code>
            </div>
            <button className="discret" onClick={() => supabase.auth.signOut()}>
              Se déconnecter
            </button>
          </section>
        </>
      )
    case 'memento':
      return <Memento evenement={evenement} />
    case 'planning':
      return <Planning evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} />
    case 'securite':
      return <Securite evenement={evenement} membre={membre} session={session} />
    case 'sos':
      return <PcOps evenement={evenement} />
    case 'logistique':
      return <Logistique evenement={evenement} membre={membre} />
    case 'parcours':
      return <Parcours evenement={evenement} membre={membre} />
    case 'rh':
      return <Rh evenement={evenement} membre={membre} peut={peut} />
    case 'plan':
      return <PlanImplantation evenement={evenement} membre={membre} />
    case 'analyse':
      return <Analyse evenement={evenement} membre={membre} />
    case 'plateforme':
      return (
        <Plateforme
          session={session}
          setMessage={setMessage}
          onOuvrir={onOuvrirEvenement}
        />
      )
    case 'reglages':
      return (
        <Reglages
          evenement={evenement}
          session={session}
          exploitant={exploitant}
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

/*
 * Réglages de l'événement.
 *
 * Regroupés par ce qu'on vient y faire, et non par ordre d'apparition
 * dans le développement : sept sections empilées obligeaient à parcourir
 * tout l'écran pour trouver une case.
 *
 * « Rôles » a rejoint « Équipe » : composer un rôle et l'attribuer sont
 * la même tâche, séparée en deux écrans elle devenait pénible.
 */
const PANNEAUX = [
  ['dispositif', 'Dispositif'],
  ['equipe', 'Équipe'],
  ['donnees', 'Données'],
  ['partage', 'Partage'],
  ['compte', 'Mon compte']
]

function Reglages({ evenement, session, exploitant, onRecharger, setMessage }) {
  const [panneau, setPanneau] = useState('dispositif')
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
      <div className="onglets">
        {PANNEAUX.map(([k, l]) => (
          <button
            key={k}
            className={`module ${panneau === k ? 'actif' : ''}`}
            onClick={() => setPanneau(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {panneau === 'dispositif' && (
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
              La phase ouvre et ferme des droits d'écriture. Elle est réversible : on
              repasse en montage le vendredi soir sans que ce soit un incident.
            </p>
          </section>

          <section className="bloc">
            <h2>Modules</h2>
            <div className="plaques">
              {MODULES.map(([k, libelle]) => (
                <button
                  key={k}
                  disabled={occupe || !exploitant}
                  className={`plaque-nav ${evenement.modules?.[k] ? 'actif' : ''}`}
                  onClick={() => basculerModule(k)}
                  title={!exploitant ? 'Relève de la souscription' : undefined}
                >
                  {libelle}
                </button>
              ))}
            </div>
            <p className="aide">
              {exploitant
                ? "Un module éteint disparaît de la navigation et cesse de recevoir des données. Le SOS n'enregistre rien tant qu'il est éteint, même si le lien circule."
                : "Les modules relèvent de la souscription : leur activation se règle avec l'éditeur, pas depuis l'événement."}
            </p>
          </section>
        </>
      )}

      {panneau === 'equipe' && (
        <>
          <section className="bloc">
            <h2>Ajouter un membre</h2>
            <AjoutMembre
              evenementId={evenement.id}
              onFait={onRecharger}
              setMessage={setMessage}
            />
            <p className="aide">
              L'identifiant se trouve sur l'écran « Mon compte » de la personne, qu'elle
              t'envoie après avoir créé son compte.
            </p>
          </section>

          <Roles evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'donnees' && (
        <>
          <section className="bloc">
            <h2>Référentiels</h2>
            <Compteurs evenementId={evenement.id} cle={compteur} />
            <ImportCsv
              evenementId={evenement.id}
              onFait={() => setCompteur((c) => c + 1)}
            />
          </section>

          <ImportKml evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'partage' && (
        <>
          <AccesAutorite evenement={evenement} setMessage={setMessage} />
          {evenement.modules?.sos_participants && <QrCodes evenement={evenement} />}
        </>
      )}

      {panneau === 'compte' && (
        <section className="bloc">
          <h2>Mon compte</h2>
          <p className="aide">Connecté en tant que {session.user.email}.</p>
          <div className="identite">
            <span className="etiquette">Mon identifiant</span>
            <code>{session.user.id}</code>
            <p className="aide">
              À transmettre à l'administrateur d'un autre événement pour y être ajouté.
            </p>
          </div>
          <button className="discret" onClick={() => supabase.auth.signOut()}>
            Se déconnecter
          </button>
        </section>
      )}
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
  const [roleId, setRoleId] = useState('')
  const [roles, setRoles] = useState([])
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    supabase
      .from('roles')
      .select('id, code, libelle')
      .eq('evenement_id', evenementId)
      .is('deleted_at', null)
      .order('ordre')
      .then(({ data }) => {
        setRoles(data ?? [])
        setRoleId((r) => r || data?.find((x) => x.code === 'benevole')?.id || '')
      })
  }, [evenementId])

  async function ajouter() {
    setOccupe(true)
    const choisi = roles.find((r) => r.id === roleId)
    const { error } = await supabase.from('membres_evenement').insert({
      evenement_id: evenementId,
      user_id: userId.trim(),
      role_id: roleId || null,
      // colonne héritée, conservée le temps de la transition
      role: ['admin','coordinateur','chef_equipe','benevole','observateur']
        .includes(choisi?.code) ? choisi.code : 'benevole',
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
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        style={{ width: 'auto', marginBottom: 0 }}
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.libelle}
          </option>
        ))}
      </select>
      <button disabled={occupe || !userId.trim() || !roleId} onClick={ajouter}>
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

function RejoindreEvenement({ evenement, onFait, setMessage }) {
  const [role, setRole] = useState('coordinateur')
  const [occupe, setOccupe] = useState(false)

  async function rejoindre() {
    setOccupe(true)
    const { error } = await supabase.rpc('rejoindre_evenement', {
      p_evenement: evenement.id,
      p_role_code: role
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="saisie-rapide">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={{ width: 'auto', marginBottom: 0 }}
      >
        <option value="observateur">en observateur (lecture seule)</option>
        <option value="coordinateur">en coordinateur (tous droits)</option>
      </select>
      <button disabled={occupe} onClick={rejoindre}>
        Rejoindre le dispositif
      </button>
    </div>
  )
}

function BasculeTheme({ theme, setTheme, compact }) {
  const suivant = { auto: 'clair', clair: 'sombre', sombre: 'auto' }
  const libelle = { auto: 'Auto', clair: 'Jour', sombre: 'Nuit' }
  return (
    <button
      className={compact ? 'discret sortie' : 'discret'}
      onClick={() => setTheme(suivant[theme])}
      title="Le QG tourne la nuit, le terrain en plein soleil"
    >
      {libelle[theme]}
    </button>
  )
}
