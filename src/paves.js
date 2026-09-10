/**
 * Catalogue des pavés du dashboard individuel.
 *
 * ⚠️ Métadonnées de produit, aucune donnée client. Le catalogue est figé
 * ici : un client n'invente pas de pavé, il en demande un — et il monte
 * dans la roadmap, pour tout le monde, sans branche à maintenir.
 *
 * Hiérarchie de composition, à trois niveaux :
 *   1. ce catalogue           — figé au niveau produit
 *   2. les modules activés    — filtrent ce qui est disponible
 *   3. le rôle                — jeu par défaut + pavés obligatoires
 *
 * Règle : un pavé n'entre au catalogue que s'il a des données réelles à
 * afficher. Un pavé vide fait perdre confiance dans l'outil.
 */

/*
 * `besoin` : capacité requise pour que le pavé existe.
 * null = ouvert à tout membre.
 *
 * On y met la capacité d'ENCADREMENT (`missions:creer`) pour tout ce qui
 * donne une vue d'ensemble : un bénévole n'a pas à voir le matériel sous
 * seuil de tout l'événement ni le total des signalements ouverts — ce
 * n'est pas de la confidentialité, c'est du bruit qu'il ne peut pas
 * traiter.
 */
export const PAVES = {
  identite: {
    libelle: 'Mon poste',
    teinte: 'violet',
    icone: '◉',
    lien: null,
    module: null,
    besoin: null,
    obligatoire: ['coordinateur', 'admin', 'chef_equipe', 'benevole', 'observateur']
  },
  mes_missions: {
    libelle: 'Mes missions',
    teinte: 'violet',
    icone: '▶',
    lien: null,
    module: null,
    besoin: null,
    // La raison d'être de l'écran pour qui est sur le terrain : ne se
    // retire pas.
    obligatoire: ['coordinateur', 'chef_equipe', 'benevole']
  },
  mes_demandes: {
    libelle: 'Mes demandes',
    teinte: 'bronze',
    icone: '≡',
    lien: null,
    module: null,
    besoin: null,
    // Ouvert à tout le monde : n'importe qui peut lever une demande
    // depuis Sécurité ou Logistique, pas seulement l'encadrement — le
    // suivi de sa propre demande ne devrait pas exiger de repasser par
    // l'écran dédié pour savoir où ça en est.
    obligatoire: []
  },
  mes_creneaux: {
    libelle: 'Mes créneaux',
    teinte: 'azur',
    icone: '☺',
    lien: null,
    module: 'rh',
    besoin: null,
    obligatoire: ['benevole', 'chef_equipe']
  },
  alertes: {
    libelle: 'Alertes',
    teinte: 'grenat',
    icone: '⚠',
    lien: null,
    module: null,
    besoin: ['alertes', 'creer'],
    obligatoire: ['coordinateur', 'chef_equipe']
  },
  sos: {
    libelle: 'Signalements ouverts',
    teinte: 'grenat',
    icone: '⚠',
    lien: ['securite', 'signalements'],
    module: 'sos_participants',
    besoin: ['missions', 'creer'],
    // Non retirable pour ceux qui doivent réagir : le confort ne prime
    // pas sur la remontée d'un signalement.
    obligatoire: ['coordinateur', 'chef_equipe']
  },
  planning: {
    libelle: 'Planning',
    teinte: 'azur',
    icone: '◷',
    lien: 'planning',
    module: null,
    besoin: null,
    obligatoire: []
  },
  contacts: {
    libelle: "Contacts d'urgence",
    teinte: 'sarcelle',
    icone: '☎',
    lien: 'memento',
    module: null,
    besoin: null,
    obligatoire: ['coordinateur']
  },
  equipes: {
    libelle: 'Équipes',
    teinte: 'azur',
    icone: '☺',
    lien: 'rh',
    module: null,
    besoin: null,
    obligatoire: []
  },
  materiel: {
    libelle: 'Matériel sous seuil',
    teinte: 'bronze',
    icone: '▤',
    lien: 'logistique',
    module: 'logistique',
    besoin: ['missions', 'creer'],
    obligatoire: []
  }
}

/**
 * Jeu par défaut, appliqué tant que l'utilisateur n'a rien personnalisé.
 * Un rôle inventé par un client n'y figure pas : on retombe alors sur
 * l'ordre du catalogue, filtré par ses capacités.
 */
const DEFAUTS = {
  coordinateur: ['identite', 'mes_missions', 'alertes', 'sos', 'mes_demandes', 'planning', 'contacts', 'equipes', 'materiel'],
  admin: ['identite', 'mes_missions', 'alertes', 'sos', 'mes_demandes', 'planning', 'contacts', 'equipes', 'materiel'],
  chef_equipe: ['identite', 'mes_missions', 'mes_creneaux', 'alertes', 'sos', 'mes_demandes', 'planning', 'equipes', 'materiel'],
  benevole: ['identite', 'mes_missions', 'mes_creneaux', 'mes_demandes', 'planning', 'equipes'],
  observateur: ['identite', 'planning']
}

/**
 * Pavés réellement disponibles : catalogue ∩ modules activés ∩ capacités.
 * `peut` est optionnel — sans lui, on ne filtre que sur les modules.
 */
export function pavesDisponibles(modules, peut) {
  return Object.entries(PAVES)
    .filter(([, p]) => !p.module || modules?.[p.module])
    .filter(([, p]) => !p.besoin || !peut || peut(p.besoin[0], p.besoin[1]))
    .map(([k]) => k)
}

export function pavesObligatoires(role, modules, peut) {
  return pavesDisponibles(modules, peut).filter((k) =>
    PAVES[k].obligatoire.includes(role)
  )
}

/**
 * Composition effective de l'écran.
 * Les obligatoires sont réinjectés en tête quoi qu'il arrive : c'est le
 * sécu qui garde la main sur ce qui est critique.
 */
export function composition(role, modules, choix, peut) {
  const dispo = pavesDisponibles(modules, peut)
  const obligatoires = pavesObligatoires(role, modules, peut)
  const base =
    Array.isArray(choix) && choix.length ? choix : (DEFAUTS[role] ?? dispo)
  const retenus = base.filter((k) => dispo.includes(k))
  return [...obligatoires, ...retenus.filter((k) => !obligatoires.includes(k))]
}
