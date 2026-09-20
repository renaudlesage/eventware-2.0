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
 * Autres noms acceptés pour une colonne. Un fichier sorti d'un tableur
 * ou d'un GPS ne dit pas « latitude » : il dit Lat, LAT, ou « Latitude
 * (°) ». Le refuser ligne par ligne avec « code manquant » faisait
 * croire à un problème de contenu quand c'était un problème d'en-tête
 * (campagne du 20/09, 2a-14 : deux lignes, deux rejets).
 */
const SYNONYMES = {
  lat: 'latitude',
  lon: 'longitude',
  lng: 'longitude',
  long: 'longitude',
  alt: 'altitude_m',
  altitude: 'altitude_m',
  pk: 'pk_km',
  km: 'pk_km',
  name: 'nom',
  libelle: 'libelle',
  desc: 'description',
  tel: 'telephone',
  telephone: 'telephone',
  gsm: 'telephone',
  mail: 'email',
  courriel: 'email',
  quantite: 'quantite',
  qte: 'quantite',
  seuil: 'seuil_alerte'
}

/** Sans accent, en minuscules, sans BOM ni ponctuation : la forme sous
 *  laquelle une en-tête ou une valeur de liste se compare. */
export function normaliser(texte) {
  return String(texte ?? '')
    .replace(/^\ufeff/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/** Une en-tête de fichier → le nom de colonne attendu, ou tel quel. */
export function normaliserEntete(entete) {
  const n = normaliser(entete)
  return SYNONYMES[n] ?? n
}

/** Les colonnes obligatoires absentes des en-têtes lues. */
export function colonnesManquantes(clef, entetes) {
  const lues = new Set(entetes.map(normaliserEntete))
  return RESSOURCES[clef].colonnes
    .filter((c) => c.obligatoire && !lues.has(c.champ))
    .map((c) => c.champ)
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

    if (col.valeurs) {
      // « Poste secours », « poste_secours » et « POSTE-SECOURS » sont
      // la même valeur : on compare sous forme normalisée et on stocke
      // la forme canonique de la liste.
      const canon = col.valeurs.find((x) => normaliser(x) === normaliser(v))
      if (!canon) {
        erreurs.push(`${col.champ} : « ${v} » hors liste (${col.valeurs.join(', ')})`)
        continue
      }
      valeurs[col.champ] = canon
      continue
    }

    valeurs[col.champ] = v
  }

  return { valeurs, erreurs }
}
