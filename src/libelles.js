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
