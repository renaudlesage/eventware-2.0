import { createRoot } from 'react-dom/client'
import Securite from '../../src/Securite.jsx'
import Situation from '../../src/Situation.jsx'
import Terrain from '../../src/Terrain.jsx'
import Autorite from '../../src/Autorite.jsx'
import Participant from '../../src/Participant.jsx'
import ColonneSituation from '../../src/ColonneSituation.jsx'
import Logistique from '../../src/Logistique.jsx'

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
  logistique: () => <Logistique evenement={evenement} membre={membre} session={session} peut={peut} toutPouvoir />
}

const quoi = new URLSearchParams(location.search).get('ecran')
createRoot(document.getElementById('racine')).render(ECRANS[quoi] ? ECRANS[quoi]() : <p>écran inconnu : {quoi}</p>)
