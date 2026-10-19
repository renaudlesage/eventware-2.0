/**
 * Traduit un code de statut brut (base ou calculé côté client) en
 * libellé lisible.
 *
 * Un seul endroit pour cette traduction, pas un par écran : c'est
 * exactement la duplication qui a fait diverger deux affichages plus
 * tôt dans ce projet — corrigée une fois, elle ne doit plus se
 * reproduire ici.
 */
export const LIBELLE_STATUT = {
  a_traiter: 'à traiter',
  attribuee: 'attribuée',
  en_cours: 'en cours',
  resolue: 'résolue',
  annulee: 'annulée',
  emis: 'émis',
  accuse: 'accusé',
  clos: 'clôturé',
  annule: 'annulé',
  recu: 'reçu',
  pris_en_charge: 'pris en charge',
  sans_suite: 'sans suite',
  fait: 'fait',
  rate: 'raté',
  parti: 'parti',
  arrive: 'arrivé',
  abandon: 'abandonné',
  propose: 'proposé',
  confirme: 'confirmé',
  refuse: 'refusé',
  retrouve: 'retrouvé',
  rejete: 'rejeté',
  nouveau: 'nouveau',
  existant: 'existant',
  essai: 'essai',
  active: 'active',
  suspendue: 'suspendue',
  close: 'close',
  a_arbitrer: 'à arbitrer',
  retenu: 'retenu',
  realise: 'réalisé'
}

export function libelleStatut(code) {
  if (!code) return code
  return LIBELLE_STATUT[code] ?? code.replaceAll('_', ' ')
}

/**
 * Un transport est une demande logistique (même table, mêmes statuts),
 * mais on le dit autrement : on le PLANIFIE et il est TERMINÉ, on ne le
 * « traite » ni ne le « résout ». Ce vocabulaire vivait en dur dans
 * Logistique.jsx (audit du 19/09) ; il vit ici, à côté du vocabulaire
 * général, pour qu'un renommage ne se fasse qu'une fois.
 */
export const STATUTS_TRANSPORT = [
  ['a_traiter', 'À planifier'],
  ['attribuee', 'Attribuée'],
  ['en_cours', 'En cours'],
  ['resolue', 'Terminée'],
  ['annulee', 'Annulée']
]

/**
 * Y a-t-il un parcours à suivre ? Deux conditions : le module (la
 * souscription, réglée par l'exploitant) ET la nature de l'événement
 * (réglée par le coordinateur dans Point 0 : un site fermé — plaine,
 * salle, fête de village — n'a pas de parcours, même si le module est
 * souscrit). Avant, seul le module comptait : un coordinateur de site
 * fermé se voyait imposer « groupes ou individus » sans pouvoir dire
 * « aucun » (Ren, 18/10).
 */
export function aParcours(evenement) {
  return !!evenement?.modules?.parcours && evenement?.geometrie !== 'site_ferme'
}

/** (125) Où en est une course, dit par le chauffeur depuis Mon terrain. */
export const ETAPES_TRANSPORT = [
  ['en_route', 'En route vers le départ'],
  ['charge', 'Chargé — à bord'],
  ['retour', 'Retour'],
  ['depose', 'Déposé']
]

export function libelleEtapeTransport(code) {
  return ETAPES_TRANSPORT.find(([v]) => v === code)?.[1] ?? code
}

export function libelleStatutTransport(code) {
  return STATUTS_TRANSPORT.find(([v]) => v === code)?.[1] ?? libelleStatut(code)
}

/**
 * Les domaines qu'une personne peut choisir elle-même à la saisie —
 * journal, REX, tout endroit qui demande « à quel domaine ça
 * appartient ». Un seul endroit : avant cette liste, le journal, le
 * REX complet et le REX rapide avaient chacun la leur, et elles
 * avaient déjà divergé (l'une oubliait « Signalements », l'autre
 * n'existait pas du tout).
 */
export const DOMAINES = [
  ['securite', 'Sécurité'],
  ['logistique', 'Logistique'],
  ['sanitaire', 'Sanitaire'],
  ['parcours', 'Parcours'],
  ['rh', 'Bénévoles'],
  ['sos', 'Signalements']
]

/**
 * Date + heure courtes, format belge. Partagé : Bénévoles l'utilisait
 * seul, puis les jalons ont migré vers Planning en l'emportant dans
 * leur code sans l'emporter dans leur fichier — écran noir. Un seul
 * endroit évite de refaire deux fois le même oubli.
 */
export const heure = (d) => {
  const date = new Date(d)
  const aujourdhui = date.toDateString() === new Date().toDateString()
  return date.toLocaleString('fr-BE', {
    // Pour aujourd'hui, l'heure seule suffit. Au-delà, « 08:00 » ne dit
    // pas quel jour : le jour et la date deviennent indispensables, et
    // le jour de la semaine seul ne suffit plus dès qu'une échéance
    // dépasse la semaine.
    ...(aujourdhui ? {} : { weekday: 'short', day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** (126) Les agents d'extinction, et l'unité de capacité qui va avec. */
export const AGENTS_EXTINCTION = [
  ['poudre_abc', 'Poudre ABC'],
  ['poudre_bc', 'Poudre BC'],
  ['eau', 'Eau pulvérisée'],
  ['eau_additif', 'Eau + additif'],
  ['mousse', 'Mousse'],
  ['co2', 'CO₂'],
  ['classe_f', 'Classe F (friture)'],
  ['autre', 'Autre']
]
export function libelleAgentExtinction(code) {
  return AGENTS_EXTINCTION.find(([v]) => v === code)?.[1] ?? code
}
export function uniteExtinction(agent) {
  return agent === 'poudre_abc' || agent === 'poudre_bc' || agent === 'co2' ? 'kg' : 'L'
}
