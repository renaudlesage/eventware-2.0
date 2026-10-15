/**
 * Géométrie de l'implantation à l'échelle (115, 15/10).
 *
 * Tout se calcule dans un repère local en mètres (est, nord) autour du
 * site : à l'échelle d'un terrain de festival, la Terre est plate, et
 * une approximation équirectangulaire suffit au centimètre près. Les
 * polygones sortent en [lat, lon] pour Leaflet et pour `geometrie`.
 */

const M_PAR_DEG_LAT = 111_320

export function metresParDegLon(lat) {
  return M_PAR_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

/** [lat, lon] → {x, y} en mètres par rapport à une origine. */
export function versLocal([lat, lon], origine) {
  return {
    x: (lon - origine[1]) * metresParDegLon(origine[0]),
    y: (lat - origine[0]) * M_PAR_DEG_LAT
  }
}

export function versLatLon({ x, y }, origine) {
  return [origine[0] + y / M_PAR_DEG_LAT, origine[1] + x / metresParDegLon(origine[0])]
}

/**
 * Les quatre coins d'un rectangle centré, en [lat, lon]. `rotation` en
 * degrés, sens horaire depuis le nord (0 = longueur orientée nord-sud).
 */
export function coinsRectangle(centre, largeur, longueur, rotation = 0) {
  const a = (-rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = largeur / 2
  const dy = longueur / 2
  return [
    [-dx, dy],
    [dx, dy],
    [dx, -dy],
    [-dx, -dy]
  ].map(([x, y]) => versLatLon({ x: x * cos - y * sin, y: x * sin + y * cos }, centre))
}

/** Un cercle approché par 24 côtés, en [lat, lon]. */
export function cerclePolygone(centre, diametre, n = 24) {
  const r = diametre / 2
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI
    return versLatLon({ x: r * Math.cos(t), y: r * Math.sin(t) }, centre)
  })
}

/** Le polygone d'un objet placé, ou null s'il n'est pas à l'échelle. */
export function polygoneObjet(o) {
  if (o.centre_lat == null || o.centre_lon == null || !o.largeur_m || !o.longueur_m) return null
  // Une ligne de barrières n'a pas d'emprise : son tracé est `geometrie`.
  if (o.nature === 'ligne') return null
  const centre = [Number(o.centre_lat), Number(o.centre_lon)]
  // Un pictogramme : un disque symbolique de 0,5 m, pour les distances.
  if (o.nature === 'picto') return cerclePolygone(centre, 0.5, 8)
  if (o.forme_echelle === 'cercle') return cerclePolygone(centre, Number(o.largeur_m))
  return coinsRectangle(centre, Number(o.largeur_m), Number(o.longueur_m), Number(o.rotation_deg ?? 0))
}

export function surfaceObjet(o) {
  if (!o.largeur_m || !o.longueur_m || o.nature === 'ligne' || o.nature === 'picto') return 0
  if (o.forme_echelle === 'cercle') return (Math.PI * Number(o.largeur_m) ** 2) / 4
  return Number(o.largeur_m) * Number(o.longueur_m)
}

/* ------------------------------------------------------------------ */
/* Distances entre polygones convexes (rectangles, cercles)            */

function local(poly, origine) {
  return poly.map((p) => versLocal(p, origine))
}

function projeter(pts, axe) {
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    const v = p.x * axe.x + p.y * axe.y
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

/** Théorème de l'axe séparateur : vrai si les deux convexes se chevauchent. */
export function seChevauchent(polyA, polyB) {
  const origine = polyA[0]
  const A = local(polyA, origine)
  const B = local(polyB, origine)
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      const q = P[(i + 1) % P.length]
      const axe = { x: -(q.y - p.y), y: q.x - p.x }
      const [a1, a2] = projeter(A, axe)
      const [b1, b2] = projeter(B, axe)
      if (a2 < b1 || b2 < a1) return false
    }
  }
  return true
}

function distancePointSegment(p, a, b) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  let t = l2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const dx = p.x - (a.x + t * vx)
  const dy = p.y - (a.y + t * vy)
  return Math.sqrt(dx * dx + dy * dy)
}

/** Distance minimale (m) entre deux polygones ; 0 s'ils se chevauchent. */
export function distancePolygones(polyA, polyB) {
  if (seChevauchent(polyA, polyB)) return 0
  const origine = polyA[0]
  const A = local(polyA, origine)
  const B = local(polyB, origine)
  let min = Infinity
  for (const [P, Q] of [
    [A, B],
    [B, A]
  ]) {
    for (const p of P) {
      for (let i = 0; i < Q.length; i++) {
        const d = distancePointSegment(p, Q[i], Q[(i + 1) % Q.length])
        if (d < min) min = d
      }
    }
  }
  return min
}

/** Distance minimale (m) entre un polygone et une polyligne [lat, lon][]. */
export function distancePolygoneLigne(poly, ligne) {
  if (ligne.length < 2) return Infinity
  const origine = poly[0]
  const P = local(poly, origine)
  const L = local(ligne, origine)
  let min = Infinity
  for (let i = 0; i < L.length - 1; i++) {
    for (const p of P) min = Math.min(min, distancePointSegment(p, L[i], L[i + 1]))
    for (let j = 0; j < P.length; j++)
      for (const q of [L[i], L[i + 1]]) min = Math.min(min, distancePointSegment(q, P[j], P[(j + 1) % P.length]))
  }
  return min
}

/** Distance (m) entre deux points [lat, lon]. */
export function distancePoints(a, b) {
  const { x, y } = versLocal(b, a)
  return Math.sqrt(x * x + y * y)
}

/* ------------------------------------------------------------------ */
/* Lignes (barriérage, 117)                                            */

/** Longueur (m) d'une polyligne [lat, lon][]. */
export function longueurLigne(points) {
  let l = 0
  for (let i = 1; i < points.length; i++) l += distancePoints(points[i - 1], points[i])
  return l
}

/**
 * Subdivise une polyligne en modules de `pas` mètres : les jonctions
 * entre barrières, en [lat, lon], du premier point jusqu'au dernier
 * module entier. Le dernier module peut être plus court (le terrain ne
 * fait jamais un multiple de 3,5 m) : il est compté, pas étiré.
 */
export function jonctionsLigne(points, pas) {
  if (points.length < 2 || !(pas > 0)) return []
  const origine = points[0]
  const P = points.map((p) => versLocal(p, origine))
  const sortie = [points[0]]
  let reste = pas // distance jusqu'à la prochaine jonction
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1]
    const b = P[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L = Math.sqrt(dx * dx + dy * dy)
    let t = 0
    while (L - t >= reste) {
      t += reste
      sortie.push(versLatLon({ x: a.x + (dx * t) / L, y: a.y + (dy * t) / L }, origine))
      reste = pas
    }
    reste -= L - t
  }
  return sortie
}

/** Nombre de modules de `pas` m pour couvrir une longueur (dernier module partiel compris). */
export function nombreModules(longueur, pas) {
  if (!(pas > 0) || !(longueur > 0)) return 0
  return Math.ceil(longueur / pas - 1e-6)
}

/** Point milieu (par la longueur) d'une polyligne, en [lat, lon]. */
export function milieuLigne(points) {
  if (!points.length) return null
  const total = longueurLigne(points)
  let cible = total / 2
  for (let i = 1; i < points.length; i++) {
    const d = distancePoints(points[i - 1], points[i])
    if (d >= cible) {
      const f = d ? cible / d : 0
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f]
    }
    cible -= d
  }
  return points[points.length - 1]
}

/** Translate une polyligne pour que son milieu aille en `vers` ([lat, lon]). */
export function translaterLigne(points, vers) {
  const m = milieuLigne(points)
  if (!m) return points
  const dLat = vers[0] - m[0]
  const dLon = vers[1] - m[1]
  return points.map(([la, lo]) => [la + dLat, lo + dLon])
}
