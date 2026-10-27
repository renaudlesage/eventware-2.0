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
 * Le DWG, lui, est un format binaire fermé d'Autodesk : le seul lecteur
 * libre (libredwg, 12 Mo en WebAssembly, GPL-3) n'a pas sa place dans
 * le navigateur. Il tourne sur le serveur (api/dwg-vers-dxf.js) : on y
 * dépose le DWG par le stockage, on en reçoit un DXF, et le DXF suit
 * le chemin ci-dessus.
 */

// $INSUNITS → mètres. 0 ou absent : on devine.
const FACTEURS = { 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 14: 0.1 }
const LIBELLES = { 1: 'pouces', 2: 'pieds', 3: 'milles', 4: 'millimètres', 5: 'centimètres', 6: 'mètres', 7: 'kilomètres', 14: 'décimètres' }

export const estDxf = (fichier) => /\.dxf$/i.test(fichier?.name ?? '')
export const estDwg = (fichier) => /\.dwg$/i.test(fichier?.name ?? '')

export const CONSEIL_DWG =
  'Tu peux aussi enregistrer le dessin en DXF (AutoCAD : Enregistrer sous → DXF ; LibreCAD, QCAD ou DraftSight le font aussi, gratuitement) et importer le DXF.'

/**
 * Convertit un DWG en DXF par le serveur : dépôt du DWG dans le
 * compartiment, appel de la fonction avec deux adresses signées (lire le
 * DWG, écrire le DXF), relecture du DXF, ménage. Rend un pseudo-fichier
 * que dxfVersImage accepte.
 * @param {File} fichier le DWG
 * @param {string} dossier le préfixe de stockage (l'id de l'événement)
 * @param {object} compartiment supabase.storage.from('plans')
 */
export async function dwgVersDxf(fichier, dossier, compartiment, { api = '/api/dwg-vers-dxf' } = {}) {
  const base = `${dossier}/conversion-${Date.now()}`
  const cheminDwg = `${base}.dwg`
  const cheminDxf = `${base}.dxf`
  const menage = () => compartiment.remove([cheminDwg, cheminDxf]).catch(() => {})
  const { error: e1 } = await compartiment.upload(cheminDwg, fichier, { upsert: true, contentType: 'application/octet-stream' })
  if (e1) throw new Error(`Dépôt du DWG impossible : ${e1.message ?? e1}`)
  try {
    const [lecture, ecriture] = await Promise.all([compartiment.createSignedUrl(cheminDwg, 300), compartiment.createSignedUploadUrl(cheminDxf)])
    if (lecture.error || !lecture.data?.signedUrl) throw new Error('Adresse de lecture du DWG refusée.')
    if (ecriture.error || !ecriture.data?.signedUrl) throw new Error('Adresse d’écriture du DXF refusée.')
    const reponse = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: lecture.data.signedUrl, destination: ecriture.data.signedUrl })
    }).catch(() => null)
    if (!reponse) throw new Error('Le service de conversion ne répond pas.')
    if (!reponse.ok) {
      const corps = await reponse.json().catch(() => null)
      throw new Error(corps?.erreur ?? `Le service de conversion a échoué (${reponse.status}).`)
    }
    const { data, error: e2 } = await compartiment.download(cheminDxf)
    if (e2 || !data) throw new Error('Le DXF converti n’a pas pu être relu.')
    const texte = await data.text()
    return { name: fichier.name.replace(/\.dwg$/i, '.dxf'), text: async () => texte, octetsDwg: fichier.size, octetsDxf: texte.length }
  } finally {
    menage()
  }
}

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
