import { Helper } from 'dxf'

/**
 * (27/10) Un fond de plan en DXF.
 *
 * Le DXF est le format d'échange texte d'AutoCAD : chaque logiciel de
 * dessin l'exporte. On le lit dans le navigateur (bibliothèque `dxf`,
 * MIT), on le dessine en SVG, on le rastérise en PNG transparent, et ce
 * PNG suit le circuit normal des fonds (compartiment `plans`, trois
 * coins, rotation, échelle). Ce qu'un DXF apporte en plus d'une image :
 * ses dimensions réelles. L'emprise du dessin ($EXTMIN / $EXTMAX, ou la
 * boîte des entités) et son unité ($INSUNITS) donnent la largeur et la
 * hauteur en mètres : le fond arrive à l'échelle, il ne reste qu'à le
 * placer.
 *
 * Le DWG, lui, est un format binaire fermé d'Autodesk : pas de lecteur
 * fiable et libre dans un navigateur (le seul existant est une
 * compilation de libredwg, 12 Mo, GPL). On demande l'export en DXF.
 */

// $INSUNITS → mètres. 0 ou absent : on devine.
const FACTEURS = { 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 14: 0.1 }
const LIBELLES = { 1: 'pouces', 2: 'pieds', 3: 'milles', 4: 'millimètres', 5: 'centimètres', 6: 'mètres', 7: 'kilomètres', 14: 'décimètres' }

export const estDxf = (fichier) => /\.dxf$/i.test(fichier?.name ?? '')
export const estDwg = (fichier) => /\.dwg$/i.test(fichier?.name ?? '')

export const MESSAGE_DWG =
  'Le DWG est un format fermé d’Autodesk qu’un navigateur ne sait pas lire. Enregistre le dessin en DXF (AutoCAD : Enregistrer sous → DXF ; LibreCAD, QCAD ou DraftSight le font aussi, gratuitement), puis importe le DXF : il arrivera à l’échelle.'

/**
 * Convertit un fichier DXF en PNG, avec ses mesures.
 * @returns {Promise<{ blob: Blob, largeurM: number, hauteurM: number, entites: number, unite: string }>}
 */
export async function dxfVersImage(fichier, { maxPx = 4096 } = {}) {
  const texte = await fichier.text()
  const helper = new Helper(texte)
  const svg = helper.toSVG()
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/\s+/).map(Number)
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    throw new Error('DXF sans emprise lisible : aucune entité dessinée, ou un format que la bibliothèque ne lit pas.')
  }
  const [, , largeurU, hauteurU] = vb
  const code = helper.parsed?.header?.insUnits
  let facteur = FACTEURS[code]
  let unite = LIBELLES[code]
  if (!facteur) {
    // Sans unité déclarée : un terrain de 60 m dessiné en millimètres fait
    // 60 000 unités de large, en mètres 60. Au-delà de 5 000, on lit des mm.
    facteur = Math.max(largeurU, hauteurU) > 5000 ? 0.001 : 1
    unite = facteur === 1 ? 'mètres (supposés)' : 'millimètres (supposés)'
  }
  const largeurM = largeurU * facteur
  const hauteurM = hauteurU * facteur
  const echelle = maxPx / Math.max(largeurU, hauteurU)
  const w = Math.max(1, Math.round(largeurU * echelle))
  const h = Math.max(1, Math.round(hauteurU * echelle))
  const svgDim = svg.replace('width="100%" height="100%"', `width="${w}" height="${h}"`)
  const blob = await rasteriser(svgDim, w, h)
  return { blob, largeurM, hauteurM, entites: helper.denormalised?.length ?? 0, unite, pixels: [w, h] }
}

async function rasteriser(svg, w, h) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Le dessin du DXF n’a pas pu être rendu en image.'))
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Image PNG impossible à produire.')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
