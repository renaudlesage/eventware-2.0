import { createRoot } from 'react-dom/client'
import Securite from '../../src/Securite.jsx'
import Situation from '../../src/Situation.jsx'
import Terrain from '../../src/Terrain.jsx'
import Autorite from '../../src/Autorite.jsx'
import Participant from '../../src/Participant.jsx'
import ColonneSituation from '../../src/ColonneSituation.jsx'
import Logistique from '../../src/Logistique.jsx'
import Implantation from '../../src/Implantation.jsx'
import PlanImplantation from '../../src/PlanImplantation.jsx'
import Planning from '../../src/Planning.jsx'
import Point0 from '../../src/Point0.jsx'
import { DONNEES } from './faux-supabase.js'

/**
 * Les écrans montés par le banc d'essai, avec un événement et un
 * membre factices. Les données viennent de faux-supabase.js.
 */
const evenement = { id: 'ev1', nom: 'Essai', phase: 'exploitation', jeton_public: 'j', modules: { sos_participants: true, securite: true, logistique: true, parcours: true }, point_0_lat: 50.38, point_0_lon: 5.61, geometrie: 'parcours' }
const membre = { id: 'mb1', nom_affiche: 'Ren', user_id: 'u1' }
const session = { user: { id: 'u1' } }
const peut = () => true

export const ECRANS = {
  securite: () => <Securite evenement={evenement} membre={membre} session={session} peut={peut} toutPouvoir />,
  situation: () => <Situation evenement={evenement} peut={peut} toutPouvoir onAller={() => {}} />,
  terrain: () => <Terrain evenement={evenement} membre={membre} />,
  autorite: () => <Autorite jeton="jeton-essai" />,
  participant: () => <Participant jeton="jeton-essai" codeLieu={null} />,
  colonne: () => <ColonneSituation evenement={evenement} palier="large" onAller={() => {}} />,
  // (129) Le Gantt : en préparation, l'onglet par défaut du Planning. Les dates de l'événement posent les bandes et le trait J.
  gantt: () => <Planning evenement={{ ...evenement, phase: 'preparation', date_debut: '2026-11-11', date_fin: '2026-11-11', date_montage: '2026-11-09', date_demontage: '2026-11-13' }} peut={peut} toutPouvoir onAller={() => {}} />,
  // Le même, pour un membre qui ne fait que lire : ni poignées, ni entraînement.
  'gantt-lecture': () => <Planning evenement={{ ...evenement, phase: 'preparation', date_debut: '2026-11-11', date_fin: '2026-11-11' }} peut={(r, a) => a === 'lire'} toutPouvoir={false} onAller={() => {}} />,
  // Le point 0 posé sur la carte (Réglages › Dispositif), sans point encore enregistré.
  point0: () => <Point0 evenement={{ ...evenement, point_0_lat: null, point_0_lon: null }} onFait={() => {}} setMessage={(m) => console.error('message', m?.texte)} />,
  plan: () => <PlanImplantation evenement={evenement} membre={membre} peut={peut} toutPouvoir />,
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
  implantation: () => <Implantation evenement={{ ...evenement, point_0_lat: 50.3859, point_0_lon: 5.616 }} elements={DONNEES.elements_plan.slice(0, Number(new URLSearchParams(location.search).get('n') ?? 99))} onRecharger={() => {}} peutCreer peutModifier setMessage={(m) => console.error('message', m?.texte)} />
}

const quoi = new URLSearchParams(location.search).get('ecran')
createRoot(document.getElementById('racine')).render(ECRANS[quoi] ? ECRANS[quoi]() : <p>écran inconnu : {quoi}</p>)
