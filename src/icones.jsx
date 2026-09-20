import {
  LayoutDashboard,
  CalendarClock as CalendarPlanning,
  UserCircle,
  BookOpenCheck,
  ShieldAlert,
  Siren,
  PackageSearch,
  Route,
  Users,
  MapPinned,
  TrendingUp,
  SlidersHorizontal,
  Building2,
  ClipboardList,
  ListChecks,
  Radio,
  KeyRound,
  Truck,
  Gauge,
  CalendarClock,
  Flag,
  FileWarning,
  Search,
  Megaphone,
  QrCode,
  Upload,
  ScrollText
} from 'lucide-react'

/**
 * Icônes et couleurs de domaine.
 *
 * Deux dimensions, pour ne pas se marcher dessus :
 *   la TEINTE dit le domaine — sécurité, logistique, parcours…
 *   l'INTENSITÉ dit l'état — rouge urgence, ambre vigilance, vert nominal.
 *
 * Les couleurs de domaine ne servent qu'à repérer et à naviguer. Aucune
 * ne doit apparaître sur une valeur : un chiffre coloré signifie toujours
 * un état, jamais une appartenance.
 */

export const DOMAINES = {
  situation:  { icone: LayoutDashboard,      teinte: 'indigo' },
  planning:   { icone: CalendarPlanning,      teinte: 'azur' },
  // Teinte propre : la préparation est un domaine à part entière, et
  // la règle du dépôt veut qu'une teinte désigne un seul domaine.
  preparation:{ icone: ListChecks,           teinte: 'tilleul' },
  accueil:    { icone: UserCircle,           teinte: 'violet' },
  memento:    { icone: BookOpenCheck,        teinte: 'sarcelle' },
  securite:   { icone: ShieldAlert,          teinte: 'grenat' },
  sos:        { icone: Siren,                teinte: 'orange' },
  logistique: { icone: PackageSearch,        teinte: 'bronze' },
  parcours:   { icone: Route,                teinte: 'mousse' },
  rh:         { icone: Users,                teinte: 'azur' },
  plan:       { icone: MapPinned,            teinte: 'prune' },
  analyse:    { icone: TrendingUp,           teinte: 'ardoise' },
  reglages:   { icone: SlidersHorizontal,    teinte: 'gris' },
  plateforme: { icone: Building2,            teinte: 'gris' }
}

/**
 * Les quatre familles du rail de navigation (refonte du 20/09).
 *
 * L'ordre des familles et celui des domaines dans chaque famille sont
 * significatifs : ils fixent la position verticale de chaque icône, et
 * c'est cette position que la main mémorise. Une famille dont aucun
 * module n'est visible disparaît entièrement, filet compris.
 */
export const FAMILLES = [
  ['Commandement', ['situation', 'planning', 'preparation']],
  ['Terrain',      ['securite', 'sos', 'parcours', 'memento']],
  ['Ressources',   ['logistique', 'rh', 'plan', 'accueil']],
  ['Pilotage',     ['analyse', 'reglages', 'plateforme']]
]

/**
 * Sous ce nombre de modules visibles, le groupement saute : avec les
 * cinq écrans d'un bénévole, deux familles tombaient à une icône et les
 * filets découpaient des groupes d'un seul élément — ça se lit comme
 * des trous, pas comme un classement. Huit est un choix, pas une loi :
 * le nombre en dessous duquel une pile se parcourt d'un regard.
 */
export const SEUIL_GROUPEMENT = 8

/** Icônes de section, à l'intérieur des modules. */
export const ICONES = {
  journal: ScrollText,
  missions: ClipboardList,
  recherches: Search,
  fiches: FileWarning,
  radios: Radio,
  cles: KeyRound,
  transports: Truck,
  jauge: Gauge,
  creneaux: CalendarClock,
  jalons: Flag,
  alertes: Megaphone,
  qr: QrCode,
  import: Upload
}

/** Rendu court : <Icone nom="missions" /> */
export function Icone({ nom, domaine, taille = 17, ...reste }) {
  const C = domaine ? DOMAINES[domaine]?.icone : ICONES[nom]
  if (!C) return null
  return <C size={taille} strokeWidth={1.75} aria-hidden="true" {...reste} />
}
