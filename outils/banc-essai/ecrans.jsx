import { createRoot } from 'react-dom/client'
import Securite from '../../src/Securite.jsx'
import { useState } from 'react'
import Recherche, { BoutonRecherche } from '../../src/Recherche.jsx'
import { useObjetVise } from '../../src/objetVise.js'
import { ecrireRoute } from '../../src/route.js'
import Situation from '../../src/Situation.jsx'
import Terrain from '../../src/Terrain.jsx'
import Autorite from '../../src/Autorite.jsx'
import AvisAutorite from '../../src/AvisAutorite.jsx'
import BoutonsFlottants from '../../src/BoutonsFlottants.jsx'
import Participant from '../../src/Participant.jsx'
import PagePoste from '../../src/PagePoste.jsx'
import ColonneSituation from '../../src/ColonneSituation.jsx'
import Logistique from '../../src/Logistique.jsx'
import Implantation from '../../src/Implantation.jsx'
import PlanImplantation from '../../src/PlanImplantation.jsx'
import Planning from '../../src/Planning.jsx'
import Point0 from '../../src/Point0.jsx'
import Dashboard from '../../src/Dashboard.jsx'
import Preparation from '../../src/Preparation.jsx'
import Reglages from '../../src/Reglages.jsx'
import Rh from '../../src/Rh.jsx'
import Parcours from '../../src/Parcours.jsx'
import Analyse from '../../src/Analyse.jsx'
import Memento from '../../src/Memento.jsx'
import BandeauEtat from '../../src/BandeauEtat.jsx'
import BarreOnglets from '../../src/BarreOnglets.jsx'
import { DONNEES } from './faux-supabase.js'

/**
 * Les écrans montés par le banc d'essai, avec un événement et un
 * membre factices. Les données viennent de faux-supabase.js.
 */
const evenement = { id: 'ev1', nom: 'Essai', phase: 'exploitation', jeton_public: 'j', modules: { sos_participants: true, securite: true, logistique: true, parcours: true, talkie: true, talkie_reponses_auto: true, talkie_transcription_serveur: true }, point_0_lat: 50.38, point_0_lon: 5.61, geometrie: 'parcours' }
const membre = { id: 'mb1', nom_affiche: 'Ren', user_id: 'u1' }
const session = { user: { id: 'u1' } }
const peut = () => true

// (169) La recherche, montée comme dans le poste : un résultat écrit l'adresse, remonte l'écran et amène la ligne.
function EssaiRecherche() {
  const [vise, setVise] = useState({ n: 0, rubrique: null, objet: null })
  useObjetVise(vise.objet, vise.n)
  return (
    <>
      <BoutonRecherche onOuvrir={() => window.dispatchEvent(new Event('eventware:recherche'))} />
      <Recherche
        evenement={evenement}
        ecransPermis={['securite', 'memento']}
        onAller={(ecran, rubrique, objet) => {
          window.__aller = [ecran, rubrique, objet]
          ecrireRoute({ ecran, rubrique, objet })
          setVise((v) => ({ n: v.n + 1, rubrique, objet }))
        }}
      />
      <Securite key={vise.n} evenement={evenement} membre={membre} session={session} peut={peut} toutPouvoir ongletCible={vise.rubrique} />
    </>
  )
}

export const ECRANS = {
  // (31/10) La coquille au téléphone : le bandeau d'état compact, et REX dans le tiroir « Plus ».
  coquille: () => (
    <>
      <BandeauEtat evenement={evenement} membre={membre} peut={peut} toutPouvoir onAller={() => {}} palier="bureau" />
      <BarreOnglets ecran="accueil" onAller={() => {}} rex
        ecrans={[{ clef: 'accueil', libelle: 'Mon poste' }, { clef: 'securite', libelle: 'Sécurité' }, { clef: 'planning', libelle: 'Planning' }, { clef: 'logistique', libelle: 'Logistique' }]} />
      {/* (162) Les boutons flottants, dont « Parler » et « Mes messages ». */}
      <BoutonsFlottants evenement={evenement} membre={membre} peut={peut} toutPouvoir />
    </>
  ),
  // (1/11) La même coquille en préparation : les cadrans changent avec la phase.
  'coquille-preparation': () => (
    <BandeauEtat evenement={{ ...evenement, phase: 'preparation' }} membre={membre} peut={peut} toutPouvoir onAller={() => {}} palier="bureau" />
  ),
  'coquille-montage': () => (
    <BandeauEtat evenement={{ ...evenement, phase: 'montage', modules: { ...evenement.modules, precurseur: true } }} membre={membre} peut={peut} toutPouvoir onAller={() => {}} palier="bureau" />
  ),
  // (31/10) Les écrans qui manquaient au banc : Mon poste, Préparation, Réglages, Bénévoles, Parcours, Analyse, Mémento.
  accueil: () => <Dashboard evenement={{ ...evenement, phase: 'preparation' }} membre={membre} session={session} peut={peut} toutPouvoir onFait={() => {}} onAller={() => {}} setMessage={() => {}} />,
  preparation: () => <Preparation evenement={{ ...evenement, phase: 'preparation', date_debut: '2026-11-11', date_fin: '2026-11-11', date_montage: '2026-11-09', date_demontage: '2026-11-13' }} membre={membre} peut={peut} toutPouvoir setMessage={() => {}} />,
  reglages: () => <Reglages membre={membre} evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1', date_debut: '2026-11-11', date_fin: '2026-11-11', date_montage: '2026-11-09', date_demontage: '2026-11-13' }} session={session} exploitant={false} peut={peut} toutPouvoir onRecharger={() => {}} setMessage={() => {}} />,
  rh: () => <Rh evenement={evenement} membre={membre} peut={peut} toutPouvoir onRecharger={() => {}} />,
  parcours: () => <Parcours evenement={evenement} membre={membre} peut={peut} toutPouvoir />,
  analyse: () => <Analyse evenement={{ ...evenement, organisation_id: 'org1', modules: { ...evenement.modules, analyse: true } }} membre={membre} peut={peut} toutPouvoir />,
  // (2/11) Avec l'organisation : les responsables du profil de sécurité comptent parmi les contacts.
  memento: () => <Memento evenement={{ ...evenement, organisation_id: 'org1' }} />,
  securite: () => <Securite evenement={evenement} membre={membre} session={session} peut={peut} toutPouvoir />,
  situation: () => <Situation evenement={evenement} peut={peut} toutPouvoir onAller={() => {}} />,
  terrain: () => <Terrain evenement={evenement} membre={membre} />,
  autorite: () => <Autorite jeton="jeton-essai" />,
  // (159) La page d'avis d'une discipline sur le dossier déposé, par lien.
  avis: () => <AvisAutorite jeton="jeton-avis" />,
  participant: () => <Participant jeton="jeton-essai" codeLieu={null} />,
  // (169) La demande du bénévole : le pavé « Mes demandes » ouvre le tiroir porté par les boutons flottants.
  demande: () => (
    <>
      <Dashboard evenement={evenement} membre={membre} session={session} peut={(r, a) => a === 'lire'} toutPouvoir={false} onFait={() => {}} onAller={() => {}} setMessage={() => {}} />
      <BoutonsFlottants evenement={evenement} membre={membre} peut={(r, a) => a === 'lire'} toutPouvoir={false} />
    </>
  ),
  // (169) La recherche globale : le champ, les résultats, puis l'ouverture de la demande trouvée dans l'écran Sécurité.
  recherche: () => <EssaiRecherche />,
  // (171) La fiche de poste : l'aperçu de ce que la page du QR masquera.
  'fiche-poste': () => <Rh evenement={evenement} membre={membre} peut={peut} toutPouvoir ongletCible="fiches" />,
  // (168) La page publique du poste, par QR.
  'poste-public': () => <PagePoste jeton="jeton-poste-1" />,
  colonne: () => <ColonneSituation evenement={evenement} palier="large" onAller={() => {}} />,
  // (129) Le Gantt : en préparation, l'onglet par défaut du Planning. Les dates de l'événement posent les bandes et le trait J.
  gantt: () => <Planning evenement={{ ...evenement, phase: 'preparation', date_debut: '2026-11-11', date_fin: '2026-11-11', date_montage: '2026-11-09', date_demontage: '2026-11-13' }} peut={peut} toutPouvoir onAller={() => {}} />,
  // Le même, pour un membre qui ne fait que lire : ni poignées, ni entraînement.
  'gantt-lecture': () => <Planning evenement={{ ...evenement, phase: 'preparation', date_debut: '2026-11-11', date_fin: '2026-11-11' }} peut={(r, a) => a === 'lire'} toutPouvoir={false} onAller={() => {}} />,
  // Le point 0 posé sur la carte (Réglages › Dispositif), sans point encore enregistré.
  point0: () => <Point0 evenement={{ ...evenement, point_0_lat: null, point_0_lon: null }} onFait={() => {}} setMessage={(m) => console.error('message', m?.texte)} />,
  plan: () => <PlanImplantation evenement={evenement} membre={membre} peut={peut} toutPouvoir />,
  // (174) Le bilan « Éléments uniques » du plan : ce qui tombe quand un élément manque.
  'elements-uniques': () => <PlanImplantation evenement={evenement} membre={membre} peut={peut} toutPouvoir ongletCible="b-unique" />,
  logistique: () => <Logistique evenement={evenement} membre={membre} session={session} peut={peut} toutPouvoir />,
  // (130, 131) L'annuaire de l'organisation et les demandes de prix, en préparation ; puis pour un membre qui ne fait que lire.
  fournisseurs: () => <Logistique evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1', date_debut: '2026-11-11', date_fin: '2026-11-11' }} membre={membre} peut={peut} toutPouvoir ongletCible="fournisseurs" />,
  // (138) L'inventaire de l'organisation, en gestion puis en lecture.
  inventaire: () => <Logistique evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1' }} membre={membre} peut={peut} toutPouvoir ongletCible="inventaire" />,
  'inventaire-lecture': () => <Logistique evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1' }} membre={membre} peut={(r, a) => a === 'lire'} toutPouvoir={false} ongletCible="inventaire" />,
  'fournisseurs-lecture': () => <Logistique evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1' }} membre={membre} peut={(r, a) => a === 'lire'} toutPouvoir={false} ongletCible="fournisseurs" />,
  'demandes-prix': () => <Logistique evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1', date_debut: '2026-11-11', date_fin: '2026-11-11' }} membre={membre} peut={peut} toutPouvoir ongletCible="demandes_prix" />,
  'demandes-prix-lecture': () => <Logistique evenement={{ ...evenement, phase: 'preparation', organisation_id: 'org1' }} membre={membre} peut={(r, a) => a === 'lire'} toutPouvoir={false} ongletCible="demandes_prix" />,
  // (27/10) Le point 0 au milieu des objets : la carte s'ouvre dessus, zoomée, et les objets restent à l'écran.
  implantation: () => <Implantation evenement={{ ...evenement, organisation_id: 'org1', point_0_lat: 50.3859, point_0_lon: 5.616 }} elements={DONNEES.elements_plan.slice(0, Number(new URLSearchParams(location.search).get('n') ?? 99))} onRecharger={() => {}} peutCreer peutModifier setMessage={(m) => console.error('message', m?.texte)} />
}

const quoi = new URLSearchParams(location.search).get('ecran')
createRoot(document.getElementById('racine')).render(ECRANS[quoi] ? ECRANS[quoi]() : <p>écran inconnu : {quoi}</p>)
