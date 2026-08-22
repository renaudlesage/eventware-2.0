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

export const PAVES = {
  identite: {
    libelle: 'Mon rôle',
    module: null, // toujours disponible
    obligatoire: ['admin', 'coordinateur', 'chef_equipe', 'benevole', 'observateur']
  },
  sos: {
    libelle: 'Signalements ouverts',
    module: 'sos_participants',
    // Non retirable pour ceux qui doivent réagir : le confort ne prime
    // pas sur la remontée d'un signalement.
    obligatoire: ['admin', 'coordinateur', 'chef_equipe']
  },
  lieux: {
    libelle: 'Lieux',
    module: null,
    obligatoire: []
  },
  contacts: {
    libelle: "Contacts d'urgence",
    module: null,
    obligatoire: ['coordinateur']
  },
  materiel: {
    libelle: 'Matériel sous seuil',
    module: 'logistique',
    obligatoire: []
  },
  equipes: {
    libelle: 'Équipes',
    module: null,
    obligatoire: []
  }
}

/** Jeu par défaut, appliqué tant que l'utilisateur n'a rien personnalisé. */
const DEFAUTS = {
  admin: ['identite', 'sos', 'equipes', 'lieux', 'contacts', 'materiel'],
  coordinateur: ['identite', 'sos', 'contacts', 'equipes', 'lieux', 'materiel'],
  chef_equipe: ['identite', 'sos', 'equipes', 'lieux', 'materiel'],
  benevole: ['identite', 'lieux', 'equipes'],
  observateur: ['identite', 'lieux']
}

/** Pavés réellement disponibles : catalogue ∩ modules activés. */
export function pavesDisponibles(modules) {
  return Object.entries(PAVES)
    .filter(([, p]) => !p.module || modules?.[p.module])
    .map(([k]) => k)
}

export function pavesObligatoires(role, modules) {
  return pavesDisponibles(modules).filter((k) => PAVES[k].obligatoire.includes(role))
}

/**
 * Composition effective de l'écran.
 * Les obligatoires sont réinjectés en tête quoi qu'il arrive : c'est le
 * sécu qui garde la main sur ce qui est critique.
 */
export function composition(role, modules, choix) {
  const dispo = pavesDisponibles(modules)
  const obligatoires = pavesObligatoires(role, modules)
  const base = Array.isArray(choix) && choix.length ? choix : (DEFAUTS[role] ?? [])
  const retenus = base.filter((k) => dispo.includes(k))
  return [...obligatoires, ...retenus.filter((k) => !obligatoires.includes(k))]
}
