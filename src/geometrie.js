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
  const centre = [Number(o.centre_lat), Number(o.centre_lon)]
  if (o.forme_echelle === 'cercle') return cerclePolygone(centre, Number(o.largeur_m))
  return coinsRectangle(centre, Number(o.largeur_m), Number(o.longueur_m), Number(o.rotation_deg ?? 0))
}

export function surfaceObjet(o) {
  if (!o.largeur_m || !o.longueur_m) return 0
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
