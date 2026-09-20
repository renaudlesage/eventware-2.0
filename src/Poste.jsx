import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Dashboard from './Dashboard'
import Memento from './Memento'
import Securite from './Securite'
import Logistique from './Logistique'
import Parcours from './Parcours'
import Rh from './Rh'
import Analyse from './Analyse'
import PlanImplantation from './PlanImplantation'
import Bandeau from './Bandeau'
import Situation from './Situation'
import Plateforme from './Plateforme'
import Planning from './Planning'
import Preparation from './Preparation'
import Reglages from './Reglages'
import MonCompte from './MonCompte'
import { RejoindreParCode } from './Invitations'
import { NomManquant, PremierEvenement, RejoindreEvenement } from './Evenements'
import { BasculeTheme } from './Connexion'
import Rail from './Rail'
import BandeauEtat from './BandeauEtat'
import Veille from './Veille'
import Mur from './Mur'
import BoutonsFlottants from './BoutonsFlottants'
import BarreOnglets from './BarreOnglets'
import { appliquerIconeEvenement } from './logoPwa'
import { demarrer, surChangement, enAttente, refusees, rejouer, retirer } from './fileEcritures'
import { useCapacites } from './capacites'
import { usePalier } from './largeur'
import { texteErreur } from './erreurs'

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
  { clef: 'preparation', libelle: 'Préparation', module: 'preparation',       besoin: ['rh', 'lire'] },
  { clef: 'planning',   libelle: 'Planning',     module: null,                besoin: null },
  // Sécurité s'ouvre à tout membre : la main courante, les alertes et
  // les signalements se lisent de plein droit (règle R2 de la 025), et
  // c'est là qu'un bénévole déclare une recherche ou lit une fiche
  // réflexe. Ce qui s'y écrit reste gardé onglet par onglet. La
  // campagne du 20/09 a montré qu'exiger `missions:creer` ici privait
  // le bénévole de tout l'écran (3e-04) alors que le plan de tests —
  // et la matrice — lui en donnaient la lecture.
  { clef: 'securite',   libelle: 'Sécurité',     module: 'securite',          besoin: ['journal', 'lire'] },
  { clef: 'logistique', libelle: 'Logistique',   module: 'logistique',        besoin: ['logistique', 'lire'] },
  { clef: 'parcours',   libelle: 'Parcours',     module: 'parcours',          besoin: ['parcours', 'lire'] },
  // Bénévoles dès la lecture : ses créneaux, son équipe, les fiches de
  // poste concernent chacun. Le pavé « Équipes » de Mon poste y menait
  // déjà — un écran atteignable par un pavé mais absent du menu était
  // une incohérence (2d-07).
  { clef: 'rh',         libelle: 'Bénévoles',    module: 'rh',                besoin: ['rh', 'lire'] },
  { clef: 'plan',       libelle: 'Implantation', module: 'plan_implantation', besoin: ['plan_implantation', 'lire'] },
  // Analyse reste l'écran de l'arbitrage. Qui consigne sans arbitrer
  // retrouve ses constats dans le pavé « Mes constats » de Mon poste.
  { clef: 'analyse',    libelle: 'Analyse',      module: 'analyse',           besoin: ['analyse', 'modifier'] },
  { clef: 'reglages',   libelle: 'Réglages',     module: null,                besoin: 'tout_pouvoir' },
  // Console de l'éditeur : hors événement, réservée à l'exploitant.
  { clef: 'plateforme', libelle: 'Plateforme',   module: null,                besoin: 'exploitant' }
]

/* ================================================================== */
/* Poste de travail                                                    */
/* ================================================================== */

export default function Poste({ session, theme, setTheme }) {
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
  // Le rail déplié en permanence est un réglage de la personne, rangé
  // comme le thème : dans le stockage local, pas dans l'événement.
  const [railEpingle, setRailEpingle] = useState(
    () => localStorage.getItem('eventware.rail') === 'epingle'
  )
  useEffect(() => {
    localStorage.setItem('eventware.rail', railEpingle ? 'epingle' : 'compact')
  }, [railEpingle])
  const palier = usePalier()
  const [chargement, setChargement] = useState(true)
  const [exploitant, setExploitant] = useState(false)

  useEffect(() => {
    supabase.rpc('est_exploitant').then(({ data }) => setExploitant(data === true))
  }, [session.user.id])

  async function charger() {
    const { data, error } = await supabase
      .from('evenements')
      .select(
        // Les colonnes sont énumérées, pas prises en bloc : ce qui
        // manque ici est invisible partout dans l'application, même
        // correctement enregistré en base. `date_debut`, `date_fin` et
        // la fréquentation manquaient — d'où des champs qui
        // s'affichaient vides et un avertissement qui ne partait jamais.
        'id, nom, slug, geometrie, phase, jeton_public, point_0_lat, point_0_lon, province, commune, organisation_id, mode_parcours, modules, logo_url, date_debut, date_fin, frequentation_min, frequentation_max, membres_evenement(id, role, user_id, nom_affiche, perimetre, paves, equipe_id)'
      )
      .order('nom')
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
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
  // L'encadrement voit le mur ; le terrain garde ses quatre cadrans.
  const encadre = toutPouvoir || peut('missions', 'creer')

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

      {/* Les alertes en tête de page… sauf quand la colonne de veille
          les porte déjà : à partir de 1440 px elles y vivent, à côté du
          journal, et ne sont plus répétées au-dessus du travail. */}
      {!(courant && moi && moi.nom_affiche && !compteOuvert && palier !== 'simple' && palier !== 'mobile') && (
        <Bandeau evenement={courant} />
      )}

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
        <>
          {pret && (
            <BandeauEtat
              evenement={courant}
              membre={moi}
              peut={peut}
              toutPouvoir={toutPouvoir}
              onAller={aller}
              palier={palier}
            />
          )}

          {/* La coquille : rail, travail, et selon la largeur le mur et
              la veille. Les colonnes viennent de la feuille de style ;
              ce qui les remplit vient d'ici — une colonne absente n'a
              rien à charger (voir largeur.js). */}
          <div
            className={`corps palier-${palier} ${railEpingle && palier !== 'mobile' ? 'rail-epingle' : ''} ${
              palier === 'mur' && encadre ? 'avec-mur' : ''
            }`}
          >
            <Rail
              visibles={visibles}
              ecran={ecran}
              onAller={aller}
              palier={palier}
              epingle={railEpingle}
              setEpingle={setRailEpingle}
            />

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

            {palier === 'mur' && encadre && (
              <section className="travail colonne-mur" aria-label="Tableau de bord">
                <Mur evenement={courant} onAller={aller} />
              </section>
            )}

            {(palier === 'veille' || palier === 'mur') && (
              <aside className="veille" aria-label="Veille">
                <Veille
                  evenement={courant}
                  peut={peut}
                  toutPouvoir={toutPouvoir}
                  palier={palier}
                  onAller={aller}
                />
              </aside>
            )}
          </div>
        </>
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
/* Témoin de réseau et aiguillage des écrans                           */
/* ================================================================== */

/* Le bandeau d'état (cadrans) vit dans BandeauEtat.jsx depuis la
   refonte du 20/09.

   Témoin de réseau : sa place est dans la barre, pas parmi les
   compteurs — ce n'est pas une charge de travail, c'est un état.
   Il porte aussi le compte des écritures en attente : hors réseau,
   savoir qu'on est coupé ne suffit pas, il faut savoir ce qui n'est
   pas encore parti. */
function Reseau() {
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  const [attente, setAttente] = useState(0)
  const [bloquees, setBloquees] = useState([])

  useEffect(() => {
    const on = () => setEnLigne(true)
    const off = () => setEnLigne(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)

    demarrer()
    const rafraichir = () => {
      setAttente(enAttente().length)
      setBloquees(refusees())
    }
    rafraichir()
    const desabonner = surChangement(rafraichir)

    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      desabonner()
    }
  }, [])

  return (
    <>
      <span className={`temoin ${enLigne ? '' : 'coupe'}`}>
        {enLigne ? 'en ligne' : 'hors réseau'}
      </span>
      {attente > 0 && (
        <button className="temoin attente" onClick={rejouer} title="Renvoyer maintenant">
          {attente} en attente
        </button>
      )}
      {bloquees.length > 0 && (
        <span
          className="temoin coupe"
          // Le détail au survol : un conflit et un refus de droits
          // demandent deux réactions opposées — refaire le geste en
          // connaissance de cause, ou aller voir quelqu'un.
          title={bloquees.map((o) => `${o.libelle} — ${o.message ?? 'refusée'}`).join('\n')}
        >
          {bloquees.some((o) => o.conflit)
            ? `${bloquees.length} non appliquée(s)`
            : `${bloquees.length} refusée(s)`}
          <button
            className="lien"
            style={{ marginLeft: 6 }}
            onClick={() => bloquees.forEach((o) => retirer(o.cle))}
          >
            ×
          </button>
        </span>
      )}
    </>
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
          ongletCible={ongletCible}
        />
      )
    case 'logistique':
      return (
        <Logistique evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} />
      )
    case 'parcours':
      return <Parcours evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} />
    case 'rh':
      return (
        <Rh
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          onRecharger={onRecharger}
        />
      )
    case 'plan':
      return (
        <PlanImplantation evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} />
      )
    case 'analyse':
      return <Analyse evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} />
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
