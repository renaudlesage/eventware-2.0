/**
 * Lecteur de KML — pensé pour les exports Google My Maps.
 *
 * Un export My Maps n'est pas une trace : c'est un dossier de calques,
 * chacun contenant des repères nommés, décrits, parfois porteurs de
 * champs personnalisés. Ne lire que la LineString, c'est jeter tout le
 * travail de cartographie fait en amont — les postes, les étapes, les
 * accès pompiers, les zones.
 *
 * Ce lecteur restitue la structure complète : calques, géométries,
 * descriptions et données étendues.
 */

/** Décode "lon,lat,alt lon,lat,alt …" en [[lat, lon, alt], …] */
function lireCoordonnees(texte) {
  if (!texte) return []
  return texte
    .trim()
    .split(/\s+/)
    .map((t) => {
      const [lon, lat, alt] = t.split(',').map(Number)
      return Number.isFinite(lat) && Number.isFinite(lon)
        ? [lat, lon, Number.isFinite(alt) ? alt : NaN]
        : null
    })
    .filter(Boolean)
}

/** Le champ description de My Maps contient du HTML : on le réduit en texte. */
function texteBrut(html) {
  if (!html) return null
  const doc = new DOMParser().parseFromString(
    `<div>${html.replace(/<br\s*\/?>/gi, '\n')}</div>`,
    'text/html'
  )
  const t = (doc.body.textContent ?? '').replace(/\n{2,}/g, '\n').trim()
  return t || null
}

function enfantDirect(noeud, nom) {
  for (const e of noeud.children) if (e.tagName === nom) return e
  return null
}

function valeur(noeud, nom) {
  const e = enfantDirect(noeud, nom)
  return e ? (e.textContent ?? '').trim() || null : null
}

/** Champs personnalisés My Maps : <ExtendedData><Data name="…"><value> */
function donneesEtendues(placemark) {
  const ext = enfantDirect(placemark, 'ExtendedData')
  if (!ext) return {}
  const champs = {}
  for (const d of ext.getElementsByTagName('Data')) {
    const nom = d.getAttribute('name')
    const v = d.getElementsByTagName('value')[0]?.textContent?.trim()
    if (nom && v) champs[nom] = v
  }
  for (const d of ext.getElementsByTagName('SimpleData')) {
    const nom = d.getAttribute('name')
    const v = d.textContent?.trim()
    if (nom && v) champs[nom] = v
  }
  return champs
}

function lireGeometrie(placemark) {
  const point = placemark.getElementsByTagName('Point')[0]
  if (point) {
    const pts = lireCoordonnees(point.getElementsByTagName('coordinates')[0]?.textContent)
    return pts.length ? { forme: 'point', points: pts } : null
  }

  const ligne = placemark.getElementsByTagName('LineString')[0]
  if (ligne) {
    const pts = lireCoordonnees(ligne.getElementsByTagName('coordinates')[0]?.textContent)
    return pts.length ? { forme: 'ligne', points: pts } : null
  }

  const polygone = placemark.getElementsByTagName('Polygon')[0]
  if (polygone) {
    const anneau =
      polygone.getElementsByTagName('outerBoundaryIs')[0] ??
      polygone.getElementsByTagName('LinearRing')[0]
    const pts = lireCoordonnees(anneau?.getElementsByTagName('coordinates')[0]?.textContent)
    return pts.length ? { forme: 'zone', points: pts } : null
  }

  // MultiGeometry : on retient la première géométrie exploitable
  const multi = placemark.getElementsByTagName('MultiGeometry')[0]
  if (multi) {
    const pts = lireCoordonnees(multi.getElementsByTagName('coordinates')[0]?.textContent)
    if (pts.length) return { forme: pts.length === 1 ? 'point' : 'ligne', points: pts }
  }

  return null
}

/**
 * Retourne les calques du document.
 * Chaque calque : { nom, objets: [{ nom, description, champs, forme, points }] }
 */
export function lireKml(texte) {
  const doc = new DOMParser().parseFromString(texte, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error("Fichier illisible : ce n'est pas un XML valide.")
  }

  const racine = doc.getElementsByTagName('Document')[0] ?? doc.documentElement
  const calques = []

  function ajouterPlacemarks(conteneur, nomCalque) {
    const objets = []
    for (const pm of conteneur.children) {
      if (pm.tagName !== 'Placemark') continue
      const geo = lireGeometrie(pm)
      if (!geo) continue
      objets.push({
        nom: valeur(pm, 'name') ?? '(sans nom)',
        description: texteBrut(valeur(pm, 'description')),
        champs: donneesEtendues(pm),
        forme: geo.forme,
        points: geo.points
      })
    }
    if (objets.length) calques.push({ nom: nomCalque, objets })
  }

  // Calques nommés
  const dossiers = [...racine.children].filter(
    (e) => e.tagName === 'Folder' || e.tagName === 'Document'
  )
  for (const d of dossiers) {
    ajouterPlacemarks(d, valeur(d, 'name') ?? 'Sans nom')
  }

  // Repères posés à la racine, hors de tout dossier
  ajouterPlacemarks(racine, valeur(racine, 'name') ?? 'Racine')

  if (!calques.length) {
    throw new Error(
      "Aucun repère exploitable. Vérifie qu'il s'agit d'un KML (et non d'un KMZ, qui est une archive à décompresser d'abord)."
    )
  }

  return {
    titre: valeur(racine, 'name'),
    calques,
    total: calques.reduce((n, c) => n + c.objets.length, 0)
  }
}

/** Code court, stable et lisible, dérivé du nom. */
export function codeDepuis(nom, prefixe, pris) {
  const base =
    (prefixe ? prefixe + '-' : '') +
    (nom || 'X')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 10)

  let code = base || (prefixe ?? 'OBJ')
  let n = 2
  while (pris.has(code)) {
    code = `${base}${n}`
    n++
  }
  pris.add(code)
  return code
}
