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

  // Calques nommés, sous-dossiers compris (Google Earth en imbrique ;
  // My Maps n'en fait qu'un niveau) : « Parent › Enfant ».
  function parcourir(conteneur, prefixe) {
    const dossiers = [...conteneur.children].filter(
      (e) => e.tagName === 'Folder' || e.tagName === 'Document'
    )
    for (const d of dossiers) {
      const nom = valeur(d, 'name') ?? 'Sans nom'
      const complet = prefixe ? `${prefixe} › ${nom}` : nom
      ajouterPlacemarks(d, complet)
      parcourir(d, complet)
    }
  }
  parcourir(racine, null)

  // Repères posés à la racine, hors de tout dossier
  ajouterPlacemarks(racine, valeur(racine, 'name') ?? 'Racine')

  if (!calques.length) {
    throw new Error(
      "Aucun repère exploitable dans ce fichier : ni point, ni ligne, ni zone."
    )
  }

  return {
    titre: valeur(racine, 'name'),
    calques,
    total: calques.reduce((n, c) => n + c.objets.length, 0)
  }
}

/**
 * Lit un fichier choisi par l'utilisateur, KML ou KMZ, et rend le texte
 * du KML. Un KMZ est une archive zip dont le KML principal s'appelle
 * d'ordinaire `doc.kml` : on le sort de l'archive dans le navigateur,
 * sans bibliothèque, avec `DecompressionStream` (Chrome 80, Safari 16.4,
 * Firefox 113). Constat de Ren (26/09) : « j'importe un kmz, rien ne se
 * passe » — l'ancien écran demandait de décompresser à la main.
 */
export async function texteKmlDepuisFichier(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer())
  const estZip = octets[0] === 0x50 && octets[1] === 0x4b && octets[2] === 0x03 && octets[3] === 0x04
  if (!estZip) return new TextDecoder('utf-8').decode(octets)
  return await kmlDansZip(octets)
}

async function kmlDansZip(o) {
  const dv = new DataView(o.buffer, o.byteOffset, o.byteLength)
  // Fin du répertoire central : signature 0x06054b50, dans les 64 Ko finaux.
  let fin = -1
  for (let i = o.length - 22; i >= Math.max(0, o.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new Error('Archive KMZ illisible : fichier zip incomplet ou abîmé.')
  const nb = dv.getUint16(fin + 10, true)
  let p = dv.getUint32(fin + 16, true)
  const entrees = []
  const dec = new TextDecoder('utf-8')
  for (let k = 0; k < nb; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const methode = dv.getUint16(p + 10, true)
    const taille = dv.getUint32(p + 20, true)
    const lgNom = dv.getUint16(p + 28, true)
    const lgExtra = dv.getUint16(p + 30, true)
    const lgComm = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const nom = dec.decode(o.subarray(p + 46, p + 46 + lgNom))
    entrees.push({ nom, methode, taille, local })
    p += 46 + lgNom + lgExtra + lgComm
  }
  const kmls = entrees.filter((e) => /\.kml$/i.test(e.nom))
  const e = kmls.find((x) => /(^|\/)doc\.kml$/i.test(x.nom)) ?? kmls[0]
  if (!e) throw new Error("L'archive KMZ ne contient aucun fichier .kml.")

  const debut = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true)
  const brut = o.subarray(debut, debut + e.taille)
  if (e.methode === 0) return dec.decode(brut)
  if (e.methode !== 8) throw new Error('Archive KMZ compressée dans un format non pris en charge.')
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Ce navigateur ne sait pas ouvrir un KMZ : décompresse-le et charge le .kml.')
  }
  const flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return dec.decode(await new Response(flux).arrayBuffer())
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
