/**
 * Lecture de traces GPX et KML, sans dépendance externe.
 * Le navigateur sait déjà lire du XML — DOMParser suffit.
 */

const R = 6371000 // rayon terrestre en mètres

export function haversine(a, b) {
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Extrait une suite de [lat, lon, alt] depuis un GPX ou un KML. */
export function lireTrace(texte) {
  const doc = new DOMParser().parseFromString(texte, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error("Fichier illisible : ce n'est pas un XML valide.")
  }

  // GPX : <trkpt lat lon><ele>
  const trkpts = [...doc.getElementsByTagName('trkpt'), ...doc.getElementsByTagName('rtept')]
  if (trkpts.length) {
    return trkpts.map((p) => [
      parseFloat(p.getAttribute('lat')),
      parseFloat(p.getAttribute('lon')),
      parseFloat(p.getElementsByTagName('ele')[0]?.textContent ?? 'NaN')
    ])
  }

  // KML : <coordinates>lon,lat,alt ...</coordinates>
  const coords = doc.getElementsByTagName('coordinates')
  if (coords.length) {
    const points = []
    for (const bloc of coords) {
      for (const triplet of bloc.textContent.trim().split(/\s+/)) {
        const [lon, lat, alt] = triplet.split(',').map(Number)
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push([lat, lon, Number.isFinite(alt) ? alt : NaN])
        }
      }
    }
    if (points.length) return points
  }

  throw new Error('Aucun point trouvé. Fichier GPX ou KML attendu.')
}

/**
 * Distance et dénivelés.
 *
 * ⚠️ Le seuil de 3 m n'est pas cosmétique. L'altitude GPS oscille de
 * quelques mètres au repos ; sommer tous les écarts bruts gonfle le D+
 * d'un facteur deux ou trois. Un parcours plat afficherait 300 m de
 * dénivelé. Le seuil filtre ce bruit sans effacer le relief réel.
 */
export function mesurer(points, seuilBruit = 3) {
  let distance = 0
  let dPlus = 0
  let dMoins = 0
  let refAlt = points.find((p) => Number.isFinite(p[2]))?.[2] ?? null

  for (let i = 1; i < points.length; i++) {
    distance += haversine(points[i - 1], points[i])

    const alt = points[i][2]
    if (Number.isFinite(alt) && refAlt !== null) {
      const delta = alt - refAlt
      if (Math.abs(delta) >= seuilBruit) {
        if (delta > 0) dPlus += delta
        else dMoins += -delta
        refAlt = alt
      }
    } else if (Number.isFinite(alt) && refAlt === null) {
      refAlt = alt
    }
  }

  return {
    distance_km: Math.round((distance / 1000) * 100) / 100,
    denivele_pos: Math.round(dPlus),
    denivele_neg: Math.round(dMoins),
    nb_points: points.length,
    avec_altitude: points.some((p) => Number.isFinite(p[2]))
  }
}

/**
 * Réduction du nombre de points par Douglas-Peucker.
 * Une trace GPX brute compte souvent plusieurs milliers de points ;
 * on n'en affiche qu'une ligne sur une carte de 300 px de haut.
 * Stocker le brut alourdit chaque chargement pour rien.
 */
export function simplifier(points, toleranceM = 4) {
  if (points.length < 3) return points

  const perpendiculaire = (p, a, b) => {
    // Approximation plane, valable sur quelques kilomètres
    const x = (p[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320
    const y = (p[0] - a[0]) * 110540
    const bx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320
    const by = (b[0] - a[0]) * 110540
    const long = Math.hypot(bx, by)
    if (long === 0) return Math.hypot(x, y)
    return Math.abs(x * by - y * bx) / long
  }

  const garder = new Array(points.length).fill(false)
  garder[0] = garder[points.length - 1] = true
  const pile = [[0, points.length - 1]]

  while (pile.length) {
    const [debut, fin] = pile.pop()
    let max = 0
    let indice = -1
    for (let i = debut + 1; i < fin; i++) {
      const d = perpendiculaire(points[i], points[debut], points[fin])
      if (d > max) {
        max = d
        indice = i
      }
    }
    if (max > toleranceM && indice > 0) {
      garder[indice] = true
      pile.push([debut, indice], [indice, fin])
    }
  }

  return points.filter((_, i) => garder[i])
}

/** Série (distance cumulée en km, altitude) pour le profil. */
export function profil(points) {
  const serie = []
  let d = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) d += haversine(points[i - 1], points[i])
    if (Number.isFinite(points[i][2])) serie.push([d / 1000, points[i][2]])
  }
  return serie
}
