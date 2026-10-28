/**
 * Pictogrammes de sécurité du plan d'implantation (117, 15/10).
 *
 * Dessinés ici, en SVG, dans les codes couleur de la signalisation de
 * sécurité (ISO 7010) : vert = sauvetage et secours, rouge = lutte contre
 * l'incendie, bleu = obligation / information, jaune = avertissement,
 * rouge cerclé = interdiction. Chaque dessin tient dans un carré de 100,
 * et sort en chaîne SVG pour l'icône Leaflet (`L.divIcon`) comme pour
 * le catalogue.
 */

const VERT = '#1f8a4c'
const ROUGE = '#c8102e'
const BLEU = '#1d5fb5'
const JAUNE = '#f2c200'
const BLANC = '#ffffff'
const NOIR = '#10151b'

// Bonhomme qui court (sauvetage), orienté vers la droite, dans 100×100.
const COUREUR = `<circle cx="38" cy="22" r="8" fill="${BLANC}"/><path d="M34 32 L48 36 L60 50 L52 52 L44 42 L40 54 L56 70 L50 90 L42 88 L46 72 L34 60 L24 78 L16 74 L30 52 L26 44 L16 54 L10 48 L24 34 Z" fill="${BLANC}"/>`
const PORTE = `<rect x="66" y="22" width="26" height="60" fill="${BLANC}"/><rect x="72" y="28" width="14" height="48" fill="${VERT}"/>`
const FLECHE_DROITE = `<path d="M18 50 H64 V36 L88 50 L64 64 V50" fill="${BLANC}" stroke="${BLANC}" stroke-width="6" stroke-linejoin="round"/>`

const DESSINS = {
  sortie: { fond: VERT, forme: 'carre', corps: `${PORTE}<path d="M14 50 H44 V38 L62 50 L44 62 V50" fill="${BLANC}" stroke="${BLANC}" stroke-width="5" stroke-linejoin="round"/>` },
  sortie_secours: { fond: VERT, forme: 'carre', corps: `${PORTE}${COUREUR}<path d="M8 50 H20" stroke="${BLANC}" stroke-width="6"/>` },
  evacuation: { fond: VERT, forme: 'carre', corps: FLECHE_DROITE },
  rassemblement: {
    fond: VERT,
    forme: 'carre',
    corps: `<g fill="${BLANC}"><circle cx="38" cy="60" r="6"/><circle cx="50" cy="56" r="6"/><circle cx="62" cy="60" r="6"/><rect x="31" y="68" width="14" height="18" rx="3"/><rect x="43" y="64" width="14" height="22" rx="3"/><rect x="55" y="68" width="14" height="18" rx="3"/></g>
      <g stroke="${BLANC}" stroke-width="5" fill="none"><path d="M12 12 L30 30 M12 12 V26 M12 12 H26"/><path d="M88 12 L70 30 M88 12 V26 M88 12 H74"/><path d="M12 88 L30 70 M12 88 V74 M12 88 H26"/><path d="M88 88 L70 70 M88 88 V74 M88 88 H74"/></g>`
  },
  extincteur: {
    fond: ROUGE,
    forme: 'carre',
    corps: `<g fill="${BLANC}"><rect x="40" y="30" width="22" height="56" rx="6"/><rect x="46" y="18" width="10" height="12"/><rect x="36" y="22" width="30" height="5"/><path d="M40 36 C24 36 22 50 22 60 L28 60 C28 52 30 42 40 42 Z"/></g>`
  },
  ria: {
    fond: ROUGE,
    forme: 'carre',
    corps: `<g fill="none" stroke="${BLANC}" stroke-width="7"><circle cx="46" cy="46" r="22"/><circle cx="46" cy="46" r="8"/><path d="M46 68 V84 H80 L88 76"/></g>`
  },
  hydrant: {
    fond: ROUGE,
    forme: 'carre',
    corps: `<g fill="${BLANC}"><rect x="38" y="30" width="24" height="56" rx="4"/><rect x="42" y="16" width="16" height="14" rx="6"/><rect x="24" y="44" width="52" height="12" rx="3"/><rect x="30" y="84" width="40" height="6"/></g>`
  },
  dea: {
    fond: VERT,
    forme: 'carre',
    corps: `<path d="M50 86 C30 70 14 58 14 40 C14 28 23 20 33 20 C41 20 47 25 50 31 C53 25 59 20 67 20 C77 20 86 28 86 40 C86 58 70 70 50 86 Z" fill="${BLANC}"/><path d="M54 30 L40 54 H52 L46 76 L62 48 H50 Z" fill="${VERT}"/>`
  },
  premiers_soins: { fond: VERT, forme: 'carre', corps: `<path d="M38 14 H62 V38 H86 V62 H62 V86 H38 V62 H14 V38 H38 Z" fill="${BLANC}"/>` },
  telephone: {
    fond: VERT,
    forme: 'carre',
    corps: `<path d="M28 18 C22 18 16 24 16 32 C16 58 42 84 68 84 C76 84 82 78 82 72 L82 62 L64 56 L56 66 C46 62 38 54 34 44 L44 36 L38 18 Z" fill="${BLANC}"/>`
  },
  coupure_elec: {
    fond: BLEU,
    forme: 'carre',
    corps: `<path d="M56 10 L26 54 H46 L40 90 L74 42 H54 Z" fill="${BLANC}"/>`
  },
  coupure_gaz: {
    fond: BLEU,
    forme: 'carre',
    corps: `<path d="M50 12 C56 30 70 36 70 56 C70 72 60 84 50 86 C40 84 30 72 30 56 C30 46 36 40 38 32 C42 42 46 44 48 48 C52 40 50 24 50 12 Z" fill="${BLANC}"/><path d="M50 60 C54 66 56 72 50 78 C44 72 46 66 50 60 Z" fill="${BLEU}"/>`
  },
  eau_potable: {
    fond: BLEU,
    forme: 'carre',
    corps: `<g fill="${BLANC}"><rect x="22" y="22" width="40" height="12" rx="4"/><rect x="50" y="26" width="12" height="24"/><rect x="18" y="16" width="10" height="24" rx="3"/></g><path d="M56 60 C56 52 62 48 62 42 C62 48 68 52 68 60 C68 66 62 68 62 68 C62 68 56 66 56 60 Z" fill="${BLANC}"/>`
  },
  interdit: {
    fond: BLANC,
    forme: 'rond',
    corps: `<circle cx="50" cy="50" r="40" fill="none" stroke="${ROUGE}" stroke-width="10"/><circle cx="50" cy="34" r="8" fill="${NOIR}"/><path d="M38 46 H62 L58 72 H54 L54 86 H46 V72 H42 Z" fill="${NOIR}"/><path d="M22 22 L78 78" stroke="${ROUGE}" stroke-width="10"/>`
  },
  danger: {
    fond: JAUNE,
    forme: 'triangle',
    corps: `<rect x="45" y="34" width="10" height="30" rx="3" fill="${NOIR}"/><circle cx="50" cy="74" r="6" fill="${NOIR}"/>`
  },
  pmr: {
    fond: BLEU,
    forme: 'carre',
    corps: `<g fill="none" stroke="${BLANC}" stroke-width="8" stroke-linecap="round"><circle cx="44" cy="20" r="7" fill="${BLANC}" stroke="none"/><path d="M44 32 V58 H66 L76 80"/><path d="M34 46 C20 50 16 66 24 76 C32 86 48 84 54 74"/></g>`
  },
  // (133, 27/10) Secours et eau : prise d'eau naturelle, pompe,
  // aires d'hélicoptère de jour et de nuit, cabinet médical.
  eau_naturelle: {
    fond: BLEU,
    forme: 'carre',
    corps: `<g fill="none" stroke="${BLANC}" stroke-width="7" stroke-linecap="round"><path d="M12 50 C22 40 30 40 40 50 S58 60 68 50 S86 40 90 46"/><path d="M12 70 C22 60 30 60 40 70 S58 80 68 70 S86 60 90 66"/></g><path d="M50 12 C50 22 60 28 60 36 C60 42 55 46 50 46 C45 46 40 42 40 36 C40 28 50 22 50 12 Z" fill="${BLANC}"/>`
  },
  pompe: {
    fond: BLEU,
    forme: 'carre',
    corps: `<g fill="${BLANC}"><circle cx="40" cy="56" r="20"/><rect x="40" y="30" width="46" height="10" rx="3"/><rect x="78" y="30" width="10" height="30"/><rect x="18" y="76" width="44" height="8" rx="3"/></g><circle cx="40" cy="56" r="8" fill="${BLEU}"/><path d="M40 48 L48 56 L40 64 L32 56 Z" fill="${BLANC}"/>`
  },
  helico_jour: {
    fond: BLEU,
    forme: 'carre',
    corps: `<circle cx="50" cy="50" r="36" fill="none" stroke="${BLANC}" stroke-width="6"/><path d="M34 26 V74 M66 26 V74 M34 50 H66" fill="none" stroke="${BLANC}" stroke-width="10" stroke-linecap="round"/>`
  },
  helico_nuit: {
    fond: NOIR,
    forme: 'carre',
    corps: `<circle cx="50" cy="50" r="36" fill="none" stroke="${JAUNE}" stroke-width="6"/><path d="M34 26 V74 M66 26 V74 M34 50 H66" fill="none" stroke="${JAUNE}" stroke-width="10" stroke-linecap="round"/><g fill="${JAUNE}"><circle cx="14" cy="14" r="5"/><circle cx="86" cy="14" r="5"/><circle cx="14" cy="86" r="5"/><circle cx="86" cy="86" r="5"/></g>`
  },
  cabinet_medical: {
    fond: VERT,
    forme: 'carre',
    corps: `<path d="M40 14 H60 V40 H86 V60 H60 V86 H40 V60 H14 V40 H40 Z" fill="${BLANC}"/><g fill="none" stroke="${VERT}" stroke-width="5" stroke-linecap="round"><path d="M40 30 V44 C40 52 44 58 50 58 C56 58 60 52 60 44 V30"/><path d="M50 58 V66 C50 72 56 74 60 74"/></g><circle cx="65" cy="74" r="5" fill="${VERT}"/>`
  },
  // (139, 28/10) Secours et circulation : PRV (le brancard, en vert
  // sauvetage), accès secours (flèche blanche sur rouge, à tourner vers
  // l'entrée), voie d'accès secours (la chaussée, pour le catalogue : sur
  // la carte, c'est un tracé), parking (le P bleu de l'information).
  prv: {
    fond: VERT,
    forme: 'carre',
    corps: `<g fill="${BLANC}"><rect x="14" y="44" width="72" height="12" rx="4"/><circle cx="36" cy="36" r="7"/><rect x="44" y="30" width="30" height="12" rx="6"/><rect x="20" y="56" width="6" height="26"/><rect x="74" y="56" width="6" height="26"/><circle cx="23" cy="86" r="5"/><circle cx="77" cy="86" r="5"/></g><path d="M44 14 H56 V22 H64 V34 H56 V42 H44 V34 H36 V22 H44 Z" fill="${BLANC}" transform="translate(6 -6) scale(0.8)"/>`
  },
  acces_secours: { fond: ROUGE, forme: 'carre', corps: FLECHE_DROITE },
  voie_secours: {
    fond: ROUGE,
    forme: 'carre',
    corps: `<path d="M38 88 L46 12 H54 L62 88 Z" fill="${BLANC}"/><path d="M50 20 V80" stroke="${ROUGE}" stroke-width="4" stroke-dasharray="8 8"/><path d="M14 88 L30 12 M86 88 L70 12" stroke="${BLANC}" stroke-width="5" stroke-linecap="round"/>`
  },
  parking: {
    fond: BLEU,
    forme: 'carre',
    corps: `<path d="M32 86 V14 H56 C72 14 80 24 80 38 C80 52 72 62 56 62 H46 V86 Z M46 26 V50 H56 C63 50 66 45 66 38 C66 31 63 26 56 26 Z" fill="${BLANC}" fill-rule="evenodd"/>`
  }
}

export const PICTOS = Object.keys(DESSINS)

/**
 * L'intérieur d'un pictogramme (fond + dessin) dans son carré de 100,
 * pour l'inscrire dans un SVG existant — la carte vectorielle de
 * l'autorité le pose dans un <svg viewBox="0 0 100 100"> imbriqué.
 */
export function pictoInterieur(cle) {
  const d = DESSINS[cle]
  if (!d) return ''
  let fond
  if (d.forme === 'rond') fond = `<circle cx="50" cy="50" r="48" fill="${d.fond}" stroke="${NOIR}" stroke-width="2"/>`
  else if (d.forme === 'triangle') fond = `<path d="M50 4 L98 92 H2 Z" fill="${d.fond}" stroke="${NOIR}" stroke-width="4" stroke-linejoin="round"/>`
  else fond = `<rect x="2" y="2" width="96" height="96" rx="10" fill="${d.fond}" stroke="${NOIR}" stroke-width="2"/>`
  return fond + d.corps
}

/** Le SVG complet d'un pictogramme, en chaîne, à la taille demandée (px). */
export function pictoSvg(cle, taille = 28) {
  const interieur = pictoInterieur(cle)
  if (!interieur) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${taille}" height="${taille}" aria-hidden="true">${interieur}</svg>`
}
