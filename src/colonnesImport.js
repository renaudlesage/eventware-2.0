/**
 * Définition des COLONNES importables, par ressource.
 *
 * ⚠️ Ce fichier ne contient AUCUNE donnée métier — uniquement la
 * description des champs et de leurs contraintes. Les données vivent
 * exclusivement en base et s'encodent par formulaire ou par import.
 * C'est la distinction qui manquait en 2026 : un fichier de schéma est
 * régénérable sans risque, un fichier de données ne l'est pas.
 */

const TYPES_LIEU = [
  'etape', 'poste_secours', 'pc_ops', 'scene', 'bar', 'camping',
  'parking', 'entree', 'zone', 'point_kilometrique', 'autre'
]

const PRIORITES = ['P1', 'P2', 'P3', 'P4']

export const RESSOURCES = {
  lieux: {
    libelle: 'Lieux',
    table: 'lieux',
    permission: 'referentiels',
    colonnes: [
      { champ: 'code', obligatoire: true },
      { champ: 'nom', obligatoire: true },
      { champ: 'type', valeurs: TYPES_LIEU, defaut: 'autre' },
      { champ: 'latitude', type: 'nombre' },
      { champ: 'longitude', type: 'nombre' },
      { champ: 'altitude_m', type: 'nombre' },
      { champ: 'pk_km', type: 'nombre' },
      { champ: 'description' }
    ]
  },
  equipes: {
    libelle: 'Équipes',
    table: 'equipes',
    permission: 'equipes',
    colonnes: [
      { champ: 'code', obligatoire: true },
      { champ: 'nom', obligatoire: true },
      { champ: 'description' },
      { champ: 'couleur' }
    ]
  },
  types_mission: {
    libelle: 'Types de mission',
    table: 'types_mission',
    permission: 'referentiels',
    colonnes: [
      { champ: 'code', obligatoire: true },
      { champ: 'libelle', obligatoire: true },
      { champ: 'categorie' },
      { champ: 'priorite', valeurs: PRIORITES, defaut: 'P3' },
      { champ: 'delai_cible_min', type: 'entier' },
      { champ: 'description' }
    ]
  },
  materiel: {
    libelle: 'Matériel',
    table: 'materiel',
    permission: 'referentiels',
    colonnes: [
      { champ: 'code', obligatoire: true },
      { champ: 'nom', obligatoire: true },
      { champ: 'categorie' },
      { champ: 'quantite', type: 'nombre', defaut: 0 },
      { champ: 'unite' },
      { champ: 'seuil_alerte', type: 'nombre' }
    ]
  },
  contacts: {
    libelle: 'Contacts',
    table: 'contacts',
    permission: 'referentiels',
    colonnes: [
      { champ: 'code', obligatoire: true },
      { champ: 'nom', obligatoire: true },
      { champ: 'organisation' },
      { champ: 'fonction' },
      { champ: 'telephone' },
      { champ: 'email' },
      { champ: 'categorie' },
      { champ: 'disponibilite' }
    ]
  }
}

/** Modèle CSV téléchargeable, en-têtes seules. */
export function modeleCsv(clef) {
  return RESSOURCES[clef].colonnes.map((c) => c.champ).join(';') + '\n'
}

/**
 * Valide et convertit une ligne brute du CSV.
 * Retourne { valeurs, erreurs[] } — jamais d'exception : une ligne
 * fautive doit être signalée, pas faire échouer l'import entier.
 */
export function validerLigne(clef, brute) {
  const erreurs = []
  const valeurs = {}

  for (const col of RESSOURCES[clef].colonnes) {
    let v = brute[col.champ]
    v = typeof v === 'string' ? v.trim() : v

    if (v === undefined || v === '' || v === null) {
      if (col.obligatoire) erreurs.push(`${col.champ} manquant`)
      else if (col.defaut !== undefined) valeurs[col.champ] = col.defaut
      continue
    }

    if (col.type === 'nombre' || col.type === 'entier') {
      const n = Number(String(v).replace(',', '.'))
      if (Number.isNaN(n)) {
        erreurs.push(`${col.champ} n'est pas un nombre : « ${v} »`)
        continue
      }
      valeurs[col.champ] = col.type === 'entier' ? Math.round(n) : n
      continue
    }

    if (col.valeurs && !col.valeurs.includes(v)) {
      erreurs.push(`${col.champ} : « ${v} » hors liste`)
      continue
    }

    valeurs[col.champ] = v
  }

  return { valeurs, erreurs }
}
