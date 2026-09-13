import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Participant from './Participant'
import Autorite from './Autorite'
import Dashboard from './Dashboard'
import Memento from './Memento'
import Securite from './Securite'
import Logistique from './Logistique'
import Parcours from './Parcours'
import Rh from './Rh'
import Analyse from './Analyse'
import PlanImplantation from './PlanImplantation'
import QrCodes from './QrCodes'
import ImportCsv from './ImportCsv'
import ImportKml from './ImportKml'
import Bandeau from './Bandeau'
import Roles from './Roles'
import Situation from './Situation'
import AccesAutorite from './AccesAutorite'
import Plateforme from './Plateforme'
import Planning from './Planning'
import Preparation from './Preparation'
import Invitations, { RejoindreParCode } from './Invitations'
import Membres from './Membres'
import MonCompte from './MonCompte'
import LogoEvenement from './LogoEvenement'
import Point0 from './Point0'
import Diffusion from './Diffusion'
import VitrineAdmin from './VitrineAdmin'
import { appliquerIconeEvenement } from './logoPwa'
import BoutonsFlottants from './BoutonsFlottants'
import BarreOnglets from './BarreOnglets'
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
  ['preparation', 'Préparation'],
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
    { clef: 'preparation', libelle: 'Préparation', module: 'preparation',     besoin: ['rh', 'lire'] },
  { clef: 'planning',   libelle: 'Planning',     module: null,                besoin: null },
  { clef: 'securite',   libelle: 'Sécurité',     module: 'securite',          besoin: ['missions', 'creer'] },
  { clef: 'logistique', libelle: 'Logistique',   module: 'logistique',        besoin: ['logistique', 'lire'] },
  { clef: 'parcours',   libelle: 'Parcours',     module: 'parcours',          besoin: ['parcours', 'lire'] },
  { clef: 'rh',         libelle: 'Bénévoles',    module: 'rh',                besoin: ['rh', 'creer'] },
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

/**
 * Rattrapage du nom manquant.
 *
 * Le nom est demandé à l'inscription depuis peu, mais les comptes créés
 * avant — et les membres ajoutés à la main — n'en ont pas. Ils
 * apparaissent « sans nom » dans Bénévoles, et le PC ne sait pas qui
 * répond à la radio. C'est une information de sécurité, pas de confort :
 * on la demande avant d'ouvrir l'application, une fois, en un champ.
 */
function NomManquant({ membre, session, onFait }) {
  const [nom, setNom] = useState(
    () => session.user.user_metadata?.nom ?? ''
  )
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  async function enregistrer() {
    if (!nom.trim()) return
    setOccupe(true)
    setErreur(null)
    // Sur le compte ET sur l'adhésion : le compte pour les prochains
    // événements, l'adhésion pour celui-ci.
    await supabase.auth.updateUser({ data: { nom: nom.trim() } })
    const { error } = await supabase
      .from('membres_evenement')
      .update({ nom_affiche: nom.trim() })
      .eq('id', membre.id)
    if (error) setErreur(error.message)
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="corps">
      <main className="travail">
        <section className="bloc dom-violet">
          <h2>Comment t'appelles-tu ?</h2>
          <p className="aide" style={{ marginTop: 0 }}>
            C'est le nom que verra le poste de commandement dans les listes et sur les
            missions. Sans lui, tu apparais « sans nom » et personne ne sait qui répond.
          </p>
          {erreur && <div className="message erreur">{erreur}</div>}
          <div className="saisie-rapide">
            <input
              value={nom}
              autoFocus
              autoComplete="name"
              onChange={(e) => setNom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nom.trim() && enregistrer()}
              placeholder="Nom et prénom"
            />
            <button disabled={occupe || !nom.trim()} onClick={enregistrer}>
              Continuer
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}


function Connexion({ theme, setTheme }) {
  const [email, setEmail] = useState('')
    const [nom, setNom] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [message, setMessage] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function agir(mode) {
    setOccupe(true)
    setMessage(null)
    const { data, error } =
      mode === 'creer'
          ? await supabase.auth.signUp({
              email,
              password: motDePasse,
              // Porté par le COMPTE : une personne qui rejoint trois
              // événements ne doit pas se renommer trois fois.
              options: { data: { nom: nom.trim() } }
            })
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

          <label htmlFor="nom">Nom et prénom</label>
          <input
            id="nom"
            autoComplete="name"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Uniquement pour créer un compte"
          />
          <p className="aide" style={{ marginTop: -4 }}>
            C'est ce nom que verra le poste de commandement. Sans lui, tu apparais « sans
            nom » dans les listes, et personne ne sait qui répond à la radio.
          </p>

        <button className="principal" disabled={occupe || !pret} onClick={() => agir('entrer')}>
          Se connecter
        </button>
        <button className="discret" disabled={occupe || !pret || !nom.trim()} onClick={() => agir('creer')}>
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
  const [compteOuvert, setCompteOuvert] = useState(false)
  // Sous-onglet demandé lors d'une navigation ciblée — ex. le pavé
  // « Signalements ouverts » doit ouvrir directement Sécurité sur son
  // onglet Signalements, pas sur l'onglet par défaut.
  const [ongletCible, setOngletCible] = useState(null)

  function aller(clef, sousOnglet) {
    setEcran(clef)
    setOngletCible(sousOnglet ?? null)
  }
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
        'id, nom, slug, geometrie, phase, jeton_public, point_0_lat, point_0_lon, province, commune, organisation_id, mode_parcours, modules, logo_url, membres_evenement(id, role, user_id, nom_affiche, perimetre, paves, equipe_id)'
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

  // Un identifiant demandé mais introuvable ne doit PAS basculer en
  // silence sur un autre événement : c'est ce repli qui faisait
  // « ouvrir le mauvais » quand la liste était périmée. On ne retombe
  // sur le premier que si rien n'a été demandé.
  const trouve = evenements.find((e) => e.id === courantId)
  const courant = trouve ?? (courantId ? null : evenements[0]) ?? null
  const moi = courant?.membres_evenement.find((m) => m.user_id === session.user.id)

  // Filet de sécurité du point précédent : sans repli silencieux, un
  // identifiant périmé dans le stockage local (événement supprimé, ou
  // accès retiré) laisserait l'utilisateur devant « créer votre premier
  // événement » alors qu'il en a cinq. On l'oublie et on repart sur le
  // premier disponible.
  useEffect(() => {
    if (chargement || !courantId || trouve) return
    if (evenements.length === 0) return
    localStorage.removeItem('eventware.evenement')
    setCourantId(null)
  }, [chargement, courantId, trouve, evenements.length])

  useEffect(() => {
    if (courant) appliquerIconeEvenement(courant.nom, courant.logo_url)
  }, [courant?.id, courant?.logo_url])

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
        {/* Sur téléphone, le nom de l'application ne figure nulle part
            ailleurs : l'app est lancée depuis l'écran d'accueil, sans
            barre d'adresse pour dire où l'on est. */}
        <span className="marque-mobile">Eventware 2.0</span>

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
          <button
            className="discret sortie deconnexion"
            onClick={() => supabase.auth.signOut()}
          >
            Quitter
          </button>
        </div>

        <div className="barre-bas">
          {courant && (
            <span className={`plaque phase-${courant.phase}`}>{courant.phase}</span>
          )}
          {moi && <span className="plaque role">{moi.role}</span>}
          <span className="pousse" />
          <button
            className="lien"
            title={session.user.email}
            onClick={() => setCompteOuvert(true)}
          >
            Mon compte
          </button>
        </div>

      </div>

      <Bandeau evenement={courant} />

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {/* Le compte s'ouvre par-dessus le contenu plutôt que dans un
          écran de navigation : il ne fait pas partie du travail, on y
          passe et on revient. Et il reste joignable par TOUS les rôles,
          y compris ceux qui n'atteignent pas les Réglages. */}
      {compteOuvert && courant && moi ? (
        <div className="corps">
          <main className="travail">
            <div className="ligne-boutons" style={{ marginBottom: 10 }}>
              <button className="discret" onClick={() => setCompteOuvert(false)}>
                ← Retour
              </button>
            </div>
            <MonCompte
              session={session}
              membre={moi}
              evenement={courant}
              setMessage={setMessage}
              onRecharger={charger}
            />
          </main>
        </div>
      ) : 
      !courant ? (
        <>
          <RejoindreParCode onRejoint={async (id) => { await charger(); if (id) setCourantId(id) }} />
          <PremierEvenement session={session} onFait={charger} setMessage={setMessage} />
        </>
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
      ) : !moi.nom_affiche ? (
        <NomManquant membre={moi} session={session} onFait={charger} />
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
              ongletCible={ongletCible}
              evenement={courant}
              membre={moi}
              session={session}
              peut={peut}
              toutPouvoir={toutPouvoir}
              onAller={aller}
              onOuvrirEvenement={async (id) => {
                // La liste date de la connexion ; l'événement vient peut-être
                // d'être créé. Sans ce rechargement, il reste introuvable.
                await charger()
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

      {/* Même liste d'écrans que la navigation par plaques, même filtre
          de capacités : la barre du bas n'ouvre rien de plus que ce à
          quoi la personne a droit. Elle n'apparaît que sous 700 px. */}
      {courant && moi && pret && (
        <BarreOnglets ecrans={visibles} ecran={ecran} onAller={aller} />
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


/* ================================================================== */
/* Aiguillage                                                          */
/* ================================================================== */

function Ecran({ clef, ongletCible, evenement, membre, session, peut, toutPouvoir, exploitant, onAller, onOuvrirEvenement, onRecharger, setMessage }) {
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
        <Dashboard
          evenement={evenement}
          membre={membre}
          session={session}
          peut={peut}
          toutPouvoir={toutPouvoir}
          onFait={onRecharger}
          onAller={onAller}
          setMessage={setMessage}
        />
      )
    case 'memento':
      return <Memento evenement={evenement} />
    case 'preparation':
      return (
        <Preparation
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )
    case 'planning':
      return <Planning evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} />
    case 'securite':
      return (
        <Securite
          evenement={evenement}
          membre={membre}
          session={session}
          peut={peut}
          toutPouvoir={toutPouvoir}
          exploitant={exploitant}
          ongletCible={ongletCible}
        />
      )
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
          membre={membre}
          evenement={evenement}
          session={session}
          exploitant={exploitant}
          peut={peut}
          toutPouvoir={toutPouvoir}
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

function Reglages({ evenement, membre, session, exploitant, peut, toutPouvoir, onRecharger, setMessage }) {
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
          <LogoEvenement evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

          <Point0 evenement={evenement} onFait={onRecharger} setMessage={setMessage} />

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
          <Invitations evenement={evenement} setMessage={setMessage} />
          <Membres
            evenement={evenement}
            membre={membre}
            setMessage={setMessage}
            onRecharger={onRecharger}
          />
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
              phase={evenement.phase}
              peut={peut}
              toutPouvoir={toutPouvoir}
              onFait={() => setCompteur((c) => c + 1)}
            />
          </section>

          <ImportKml evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'partage' && (
        <>
          <AccesAutorite evenement={evenement} setMessage={setMessage} />
          <VitrineAdmin evenement={evenement} setMessage={setMessage} />
          {evenement.modules?.sos_participants && <QrCodes evenement={evenement} />}
          <Diffusion evenement={evenement} setMessage={setMessage} />
        </>
      )}

      {panneau === 'compte' && (
        <MonCompte
          session={session}
          membre={membre}
          evenement={evenement}
          setMessage={setMessage}
          onRecharger={onRecharger}
        />
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
          // Les entrées supprimées ne sont plus comptées : le compteur
          // annonçait un référentiel plus fourni que l'écran ne le montre.
          .is('deleted_at', null)
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
