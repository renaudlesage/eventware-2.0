import {
  LayoutDashboard,
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
