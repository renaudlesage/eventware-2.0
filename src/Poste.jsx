import { joursDepuisFin } from './ClotureGuidee'
import { LIBELLE_PHASE } from './phases'
import { lireRoute, ecrireRoute, surRoute } from './route'
import Recherche, { BoutonRecherche } from './Recherche'
import TemoinEnregistre from './TemoinEnregistre'
import { useObjetVise } from './objetVise'
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { aParcours } from './libelles'
import { supabase } from './supabaseClient'
import Dashboard from './Dashboard'
import Memento from './Memento'
import Securite from './Securite'
import Bandeau from './Bandeau'
import Situation from './Situation'
import MonCompte from './MonCompte'
import { RejoindreParCode } from './Invitations'
import { NomManquant, PremierEvenement, RejoindreEvenement } from './Evenements'
import { BasculeTheme } from './Connexion'
import Rail from './Rail'
import BandeauEtat from './BandeauEtat'
import Veille from './Veille'
import ColonneSituation from './ColonneSituation'
import Mur from './Mur'
import BoutonsFlottants from './BoutonsFlottants'
import BarreOnglets from './BarreOnglets'
import { appliquerIconeEvenement } from './logoPwa'
import { demarrer, surChangement, enAttente, refusees, rejouer, retirer } from './fileEcritures'
import { useCapacites } from './capacites'
import { usePalier } from './largeur'
import { texteErreur } from './erreurs'
import Message from './Message'

/*
 * (11/11, audit) Les écrans d'encadrement se chargent à la demande : le téléphone d'un bénévole
 * n'a pas à télécharger les Réglages, le plan d'implantation ou l'analyse pour ouvrir « Mon poste ».
 * Ils sont ensuite préchargés en tâche de fond (voir `prechaufferEcrans`), pour rester disponibles
 * hors réseau comme avant.
 */
const CHARGEURS = {
  Logistique: () => import('./Logistique'),
  Parcours: () => import('./Parcours'),
  Rh: () => import('./Rh'),
  Analyse: () => import('./Analyse'),
  Precurseur: () => import('./Precurseur'),
  Exercices: () => import('./Exercices'),
  PlanImplantation: () => import('./PlanImplantation'),
  Plateforme: () => import('./Plateforme'),
  Planning: () => import('./Planning'),
  Preparation: () => import('./Preparation'),
  Reglages: () => import('./Reglages')
}
const Logistique = lazy(CHARGEURS.Logistique)
const Parcours = lazy(CHARGEURS.Parcours)
const Rh = lazy(CHARGEURS.Rh)
const Analyse = lazy(CHARGEURS.Analyse)
const Precurseur = lazy(CHARGEURS.Precurseur)
const Exercices = lazy(CHARGEURS.Exercices)
const PlanImplantation = lazy(CHARGEURS.PlanImplantation)
const Plateforme = lazy(CHARGEURS.Plateforme)
const Planning = lazy(CHARGEURS.Planning)
const Preparation = lazy(CHARGEURS.Preparation)
const Reglages = lazy(CHARGEURS.Reglages)

function prechaufferEcrans() {
  if (navigator.onLine === false) return
  for (const charger of Object.values(CHARGEURS)) charger().catch(() => {})
}

/** Un écran dont le code n'a pas pu être chargé (réseau coupé, version remplacée) : on le dit, on propose de réessayer. */
class GardeEcran extends Component {
  state = { rate: false }
  static getDerivedStateFromError() {
    return { rate: true }
  }
  render() {
    if (!this.state.rate) return this.props.children
    return (
      <div className="message erreur" role="alert">
        Cet écran n'a pas pu s'ouvrir : le réseau est coupé, ou l'application vient d'être mise à jour.{' '}
        <button className="lien" onClick={() => window.location.reload()}>Recharger l'application</button>
      </div>
    )
  }
}

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
const CLEF_EVENEMENTS = 'eventware.evenements.copie'

// (11/11, audit M5) Le rôle tel qu'on le dit, pas tel qu'il est codé.
const ROLES_CONNUS = { coordinateur: 'Coordinateur', benevole: 'Bénévole', chef_equipe: 'Chef d’équipe', chef_etape: 'Chef d’étape', observateur: 'Observateur', regisseur: 'Régisseur', benevole_entree: 'Bénévole à l’entrée', admin: 'Administrateur' }
const libelleRole = (code) => ROLES_CONNUS[code] ?? (code ?? '').replace(/_/g, ' ')

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
  // Précurseur (114) : lecture dès missions:lire, comme les vues de la
  // base ; les réglages de l'écran restent gardés par `precurseur`.
  { clef: 'precurseur', libelle: 'Charge',       module: 'precurseur',        besoin: ['missions', 'lire'] },
  // Exercice sur mesure (120) : le contrôle avant-vol et les exercices
  // générés depuis le dispositif encodé. Gardé par `exercices`.
  { clef: 'exercices',  libelle: 'Exercices',    module: 'exercices',         besoin: ['exercices', 'lire'] },
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
  const [courantId, setCourantId] = useState(() => {
    // Ouverture par une notification (?evenement=…) : droit sur l'événement concerné, puis l'adresse redevient propre.
    const p = new URLSearchParams(window.location.search)
    const demande = p.get('evenement')
    if (demande) {
      p.delete('evenement')
      const reste = p.toString()
      try { window.history.replaceState(window.history.state, '', window.location.pathname + (reste ? `?${reste}` : '') + window.location.hash) } catch { /* adresse non modifiable */ }
      return demande
    }
    return localStorage.getItem('eventware.evenement') ?? null
  })
  // Les écrans chargés à la demande sont préchargés peu après l'ouverture : ils restent ouvrables hors réseau.
  useEffect(() => {
    const t = setTimeout(prechaufferEcrans, 2500)
    window.addEventListener('online', prechaufferEcrans)
    return () => { clearTimeout(t); window.removeEventListener('online', prechaufferEcrans) }
  }, [])
  // Un clic sur une notification, application ouverte sur un autre événement.
  useEffect(() => {
    const changer = (e) => { if (e.detail) setCourantId(e.detail) }
    window.addEventListener('eventware:evenement', changer)
    return () => window.removeEventListener('eventware:evenement', changer)
  }, [])
  // (138) Arrivée par l'étiquette d'un article (?materiel=INV-0001) : droit sur Logistique › Matériel.
  const parEtiquette = new URLSearchParams(window.location.search).has('materiel')
  // (11/11, audit M1) L'écran d'ouverture vient de l'adresse quand elle en porte un :
  // un rechargement, un lien copié ou le bouton Retour ramènent au bon endroit.
  const routeInitiale = lireRoute()
  const [ecran, setEcran] = useState(parEtiquette ? 'logistique' : routeInitiale.ecran ?? 'situation')
  const [compteOuvert, setCompteOuvert] = useState(false)
  const [codeInvitation, setCodeInvitation] = useState(() => new URLSearchParams(window.location.search).has('code'))
  // Sous-onglet demandé lors d'une navigation ciblée — ex. le pavé
  // « Signalements ouverts » doit ouvrir directement Sécurité sur son
  // onglet Signalements, pas sur l'onglet par défaut.
  const [ongletCible, setOngletCible] = useState(parEtiquette ? 'inventaire' : routeInitiale.rubrique)
  // L'objet visé dans la rubrique (référence d'une demande, d'un jalon…), et un
  // compteur qui remonte l'écran à chaque navigation ciblée : recliquer un cadran
  // ramène bien à sa rubrique, même si on en était parti entre-temps.
  const [objetCible, setObjetCible] = useState(parEtiquette ? null : routeInitiale.objet)
  const [visee, setVisee] = useState(0)
  // (28/10) La colonne de veille et le mur ne vivent que sur Situation :
  // partout ailleurs (plan, planning, logistique…), le travail prend
  // toute la largeur.
  const pleinTravail = ecran !== 'situation'

  function aller(clef, sousOnglet, objet) {
    setEcran(clef)
    setOngletCible(sousOnglet ?? null)
    setObjetCible(objet ?? null)
    setCompteOuvert(false)
    if (sousOnglet || objet) setVisee((n) => n + 1)
    ecrireRoute({ ecran: clef, rubrique: sousOnglet ?? null, objet: objet ?? null })
    window.scrollTo?.(0, 0)
  }

  // Le bouton Retour, un lien collé dans la barre d'adresse, une étiquette : l'adresse commande.
  useEffect(() => surRoute((r, origine) => {
    // Nos propres écritures d'adresse ont déjà mis l'état à jour.
    if (origine !== 'navigateur' || !r.ecran) return
    setEcran(r.ecran)
    setOngletCible(r.rubrique)
    setObjetCible(r.objet)
    setCompteOuvert(false)
    setVisee((n) => n + 1)
  }), [])
  const [message, setMessage] = useState(null)
  // (27/10) Sur un téléphone, le message vit en haut de la page et un
  // formulaire en bas : une erreur arrivait hors de vue, et « Ajouter »
  // semblait ne rien faire. Une erreur invisible se fait voir.
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
  // Heure de la copie locale quand le serveur ne répond pas (null : données fraîches).
  const [depuis, setDepuis] = useState(null)
  const [echec, setEchec] = useState(false)
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
        'id, nom, slug, geometrie, phase, jeton_public, point_0_lat, point_0_lon, province, commune, organisation_id, mode_parcours, modules, logo_url, date_debut, date_fin, date_montage, date_demontage, frequentation_min, frequentation_max, telephone_qg, edition_precedente_id, membres_evenement(id, role, user_id, nom_affiche, perimetre, paves, equipe_id)'
      )
      .order('nom')
    if (error) {
      // (11/11, audit C3) Sans réseau au démarrage, l'application affichait « Aucun
      // événement, crée le premier » et le Mémento devenait inatteignable. On reprend
      // la liste connue de cet appareil, et on le dit.
      let garde = null
      try { garde = JSON.parse(localStorage.getItem(CLEF_EVENEMENTS) ?? 'null') } catch { /* rien de gardé */ }
      if (garde?.utilisateur === session.user.id && garde.evenements?.length) {
        setEvenements((actuels) => (actuels.length ? actuels : garde.evenements))
        setDepuis(garde.quand)
        setEchec(false)
      } else {
        // Ni réseau ni copie : on le dit, plutôt que de proposer de créer un événement.
        setEchec(true)
      }
    } else {
      setEvenements(data ?? [])
      setDepuis(null)
      setEchec(false)
      try { localStorage.setItem(CLEF_EVENEMENTS, JSON.stringify({ utilisateur: session.user.id, quand: new Date().toISOString(), evenements: data ?? [] })) } catch { /* stockage plein */ }
    }
    setChargement(false)
  }

  // Tant qu'on travaille sur une copie, on retente au retour du signal.
  useEffect(() => {
    if (!depuis && !echec) return undefined
    const retenter = () => { if (!document.hidden) charger() }
    window.addEventListener('online', retenter)
    document.addEventListener('visibilitychange', retenter)
    const t = setInterval(retenter, 30000)
    return () => { window.removeEventListener('online', retenter); document.removeEventListener('visibilitychange', retenter); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depuis, echec])

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
    // Un site fermé n'a pas de parcours, module souscrit ou non (Point 0).
    if (e.clef === 'parcours' && !aParcours(courant)) return false
    if (!moi) return false
    if (e.besoin === 'exploitant') return exploitant
    if (e.besoin === 'tout_pouvoir') return toutPouvoir
    if (e.besoin === null) return true
    return toutPouvoir || peut(e.besoin[0], e.besoin[1])
  })
  // Un lien direct (#securite/missions/SEC-014) amène la ligne à l'écran dès qu'elle est affichée.
  useObjetVise(objetCible, `${ecran}:${visee}`)

  // Dépend de la LISTE des écrans visibles, pas de ce qui la produit
  // (audit du 19/09) : un changement de phase change les capacités, donc
  // les écrans ; avant, il laissait l'utilisateur sur un écran devenu
  // invisible.
  const clefsVisibles = visibles.map((e) => e.clef).join(',')
  // La recherche ne propose que des résultats dont l'écran est ouvert à la personne.
  const ecransPermis = useMemo(() => clefsVisibles.split(','), [clefsVisibles])
  useEffect(() => {
    if (!pret || !courant) return
    // L'écran d'ouverture est la situation pour qui y a droit, son poste sinon.
    if (!visibles.some((e) => e.clef === ecran)) {
      const repli = visibles.some((e) => e.clef === 'situation') ? 'situation' : 'accueil'
      setEcran(repli)
      ecrireRoute({ ecran: repli }, { remplacer: true })
    } else if (!lireRoute().ecran) {
      // Première ouverture sans adresse : on l'écrit, pour que Retour ait un point de départ.
      ecrireRoute({ ecran }, { remplacer: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courantId, pret, clefsVisibles, ecran])

  // (169) Rappel de clôture : une fois par jour au plus, une fois « Plus tard » pressé.
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const joursFin = courant ? joursDepuisFin(courant) : 0
  const [rappelCloture, setRappelCloture] = useState(null)
  useEffect(() => {
    try { setRappelCloture(courant ? localStorage.getItem(`eventware.rappel-cloture.${courant.id}`) : null) } catch { setRappelCloture(null) }
  }, [courant?.id])

  // Le titre de l'onglet suit l'écran : « Sécurité — BFMF 2027 ».
  const libelleEcran = visibles.find((e) => e.clef === ecran)?.libelle
  useEffect(() => {
    document.title = courant ? `${libelleEcran ?? 'Eventware'} — ${courant.nom}` : 'Eventware'
  }, [libelleEcran, courant?.nom])

  if (chargement) return <div className="attente" role="status">Chargement…</div>

  return (
    <div className={`poste ${pleinTravail ? 'plein-travail' : ''}`}>
      <header className="tete">
        {/* Sur téléphone, le nom de l'application ne figure nulle part
            ailleurs : l'app est lancée depuis l'écran d'accueil, sans
            barre d'adresse pour dire où l'on est. */}
        <span className="marque-mobile">Eventware 2.0</span>

        <div className="barre-haut">
          {evenements.length > 0 && (
            <select
              className="selecteur-evenement"
              aria-label="Événement"
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
          {courant && <BoutonRecherche onOuvrir={() => window.dispatchEvent(new Event('eventware:recherche'))} />}
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
            <span className={`plaque phase-${courant.phase}`}>{LIBELLE_PHASE[courant.phase] ?? courant.phase}</span>
          )}
          {moi && <span className="plaque role">{libelleRole(moi.role)}</span>}
          <span className="pousse" />
          <button
            className="lien"
            title={session.user.email}
            onClick={() => setCompteOuvert(true)}
          >
            Mon compte
          </button>
        </div>

      </header>

      {/* (11/11, audit C1) Les alertes en tête de page, à toutes les largeurs et
          sur tous les écrans. Elles étaient masquées dès 1440 px au motif que la
          colonne de veille les portait ; or cette colonne n'existe que sur la
          Situation : ailleurs, une alerte active n'apparaissait nulle part, et
          « Bien reçu » non plus. */}
      <Bandeau evenement={courant} membre={moi} />

      {/* Un lien d'invitation (?code=) ouvert par quelqu'un qui a déjà un événement. */}
      {codeInvitation && courant && !compteOuvert && (
        <RejoindreParCode onRejoint={async (id) => { setCodeInvitation(false); await charger(); if (id) { setCourantId(id); aller('accueil') } }} />
      )}

      {/* (169) L'événement est terminé et pas clôturé : on le rappelle à qui peut clôturer. */}
      {courant && toutPouvoir && joursFin > 0 && rappelCloture !== aujourdhui && ecran !== 'reglages' && (
        <div className="message rappel-cloture" role="status">
          « {courant.nom} » est terminé depuis {joursFin} jours et n’est pas clôturé. Les délais appris et les constats d’Eventware attendent la clôture.{' '}
          <button className="lien" onClick={() => aller('reglages', 'dispositif')}>Voir ce qui reste ouvert</button>{' · '}
          <button className="lien" onClick={() => { try { localStorage.setItem(`eventware.rappel-cloture.${courant.id}`, aujourdhui) } catch { /* sans stockage */ } setRappelCloture(aujourdhui) }}>Plus tard</button>
        </div>
      )}

      {depuis && (
        <div className="message hors-reseau" role="status">
          Hors réseau : tu vois l’application telle qu’elle était le {new Date(depuis).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.
          Le Mémento reste lisible ; ce que tu envoies est gardé sur cet appareil et partira au retour du signal.
        </div>
      )}

      {message && (
        <Message message={message} onFermer={() => setMessage(null)} />
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
            {/* (11/11, audit M2) Rejoindre un autre événement par code : la saisie
                n'existait que pour qui n'en avait aucun. */}
            <RejoindreParCode onRejoint={async (id) => { await charger(); if (id) { setCourantId(id); setCompteOuvert(false); aller('accueil') } }} />
          </main>
        </div>
      ) : 
      !courant && echec ? (
        <div className="corps">
          <main className="travail">
            <section className="bloc">
              <h2>Réseau indisponible</h2>
              <p>Tes événements n’ont pas pu être chargés, et cet appareil n’en garde pas encore de copie.</p>
              <p className="aide">En cas d’urgence vitale, appelle le 112. Dès que le signal revient, réessaie.</p>
              <button onClick={charger}>Réessayer</button>
            </section>
          </main>
        </div>
      ) : !courant ? (
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
              palier === 'mur' && encadre && !pleinTravail ? 'avec-mur' : ''
            } ${pleinTravail ? 'plein-travail' : ''}`}
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
              {/* (11/11, audit M18) Le titre de la page, pour les lecteurs d'écran et l'onglet du navigateur. */}
              <h1 className="sr-seul">{visibles.find((e) => e.clef === ecran)?.libelle ?? 'Eventware'} — {courant.nom}</h1>
              <GardeEcran key={ecran}>
              <Suspense fallback={<p className="vide" role="status">Chargement de l'écran…</p>}>
              <Ecran
                key={`${ecran}:${visee}`}
                exploitant={exploitant}
                clef={ecran}
                ongletCible={ongletCible}
                objetCible={objetCible}
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
              </Suspense>
              </GardeEcran>
            </main>

            {palier === 'mur' && encadre && !pleinTravail && (
              <section className="travail colonne-mur" aria-label="Tableau de bord">
                <Mur evenement={courant} onAller={aller} />
              </section>
            )}

            {(palier === 'veille' || palier === 'mur') && !pleinTravail && (
              <aside className="veille" aria-label="Veille">
                {/* Sur Situation, la veille serait de la redite (alertes,
                    journal et météo y sont déjà) : la colonne montre la
                    carte tactique et ce que Situation n'a pas (24/09). */}
                {ecran === 'situation' ? (
                  <ColonneSituation evenement={courant} palier={palier} onAller={aller} />
                ) : (
                  <Veille
                    evenement={courant}
                    membre={moi}
                    peut={peut}
                    toutPouvoir={toutPouvoir}
                    palier={palier}
                    onAller={aller}
                  />
                )}
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
      <TemoinEnregistre />
      {courant && moi && pret && (
        <Recherche evenement={courant} ecransPermis={ecransPermis} onAller={aller} />
      )}
      {courant && moi && pret && (
        <BarreOnglets ecrans={visibles} ecran={ecran} onAller={aller}
          rex={!!courant.modules?.analyse && (toutPouvoir || peut('analyse', 'creer'))}
          demande={!!courant.modules?.logistique && courant.phase !== 'cloture'} />
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

function Ecran({ clef, ongletCible, objetCible, evenement, membre, session, peut, toutPouvoir, exploitant, onAller, onOuvrirEvenement, onRecharger, setMessage }) {
  switch (clef) {
    case 'situation':
      return (
        <Situation
          evenement={evenement}
          membre={membre}
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
      return <Memento evenement={evenement} ongletCible={ongletCible} />
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
      return <Planning evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} onAller={onAller} ongletCible={ongletCible} objetCible={objetCible} />
    case 'securite':
      return (
        <Securite
          evenement={evenement}
          membre={membre}
          session={session}
          peut={peut}
          toutPouvoir={toutPouvoir}
          ongletCible={ongletCible}
          objetCible={objetCible}
        />
      )
    case 'logistique':
      return (
        <Logistique evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} ongletCible={ongletCible} objetCible={objetCible} />
      )
    case 'parcours':
      return <Parcours evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} ongletCible={ongletCible} />
    case 'rh':
      return (
        <Rh
          evenement={evenement}
          membre={membre}
          peut={peut}
          toutPouvoir={toutPouvoir}
          onRecharger={onRecharger}
          ongletCible={ongletCible}
        />
      )
    case 'plan':
      return (
        <PlanImplantation evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} ongletCible={ongletCible} />
      )
    case 'precurseur':
      return <Precurseur evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} ongletCible={ongletCible} />
    case 'exercices':
      return <Exercices evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} ongletCible={ongletCible} />
    case 'analyse':
      return <Analyse evenement={evenement} membre={membre} peut={peut} toutPouvoir={toutPouvoir} ongletCible={ongletCible} />
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
          ongletCible={ongletCible}
          onAller={onAller}
        />
      )
    default:
      return null
  }
}
