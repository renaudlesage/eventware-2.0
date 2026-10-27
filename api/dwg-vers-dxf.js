// =====================================================================
// dwg-vers-dxf — conversion d'un fond de plan DWG en DXF, côté serveur
// ---------------------------------------------------------------------
// (27/10) Le DWG est le format fermé d'AutoCAD. Le seul lecteur libre
// est libredwg (GPL-3), ici dans sa compilation WebAssembly
// @mlightcad/libredwg-web : 11 Mo, trop lourd pour le navigateur, et une
// licence qui ne doit pas toucher l'application livrée. Il tourne donc
// ici, en fonction Vercel (dossier api/, déployée avec le site), et
// nulle part ailleurs : l'application n'en reçoit que le DXF.
//
// Le navigateur ne nous envoie pas le fichier (4,5 Mo maximum par
// requête chez Vercel) : il le dépose dans le compartiment `plans` de
// Supabase, puis nous passe deux adresses signées, l'une pour lire le
// DWG, l'autre pour y écrire le DXF. La fonction ne porte aucun secret
// et ne touche que ce que l'appelant avait déjà le droit de toucher.
// Elle n'accepte que des adresses du projet Supabase : pas de relais
// vers n'importe où.
//
//   POST /api/dwg-vers-dxf   { source: <url signée GET>, destination: <url signée PUT> }
//   → 200 { ok: true, octets_dwg, octets_dxf, duree_ms }
//   → 4xx { erreur: '…' }   (lisible tel quel par l'utilisateur)
// =====================================================================

import { LibreDwg } from '@mlightcad/libredwg-web'

const HOTE_SUPABASE = new URL(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'https://kunvnnfejhnuhflycyfz.supabase.co').host
const TAILLE_MAX = 50 * 1024 * 1024

let chargement = null
const bibliotheque = () => (chargement ??= LibreDwg.create())

/** Convertit le contenu d'un DWG en texte DXF, ou null si libredwg ne le lit pas. */
export async function convertir(contenu) {
  const lib = await bibliotheque()
  const ab = contenu instanceof ArrayBuffer ? contenu : contenu.buffer.slice(contenu.byteOffset, contenu.byteOffset + contenu.byteLength)
  const dxf = lib.dwg_write_dxf(ab)
  return dxf ? new TextDecoder().decode(dxf) : null
}

/** Une adresse de stockage signée du projet Supabase, et rien d'autre. */
export function adresseAdmise(texte, verbe) {
  let u
  try { u = new URL(texte) } catch { return false }
  if (u.protocol !== 'https:' || u.host !== HOTE_SUPABASE) return false
  return verbe === 'lire' ? u.pathname.startsWith('/storage/v1/object/sign/') : u.pathname.startsWith('/storage/v1/object/upload/sign/')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu.' })
  const { source, destination } = req.body ?? {}
  if (!adresseAdmise(source, 'lire') || !adresseAdmise(destination, 'ecrire')) {
    return res.status(400).json({ erreur: 'Adresses de stockage attendues (compartiment plans du projet).' })
  }
  const debut = Date.now()
  const lecture = await fetch(source)
  if (!lecture.ok) return res.status(400).json({ erreur: `Le DWG n’a pas pu être relu depuis le stockage (${lecture.status}).` })
  const taille = Number(lecture.headers.get('content-length') ?? 0)
  if (taille > TAILLE_MAX) return res.status(413).json({ erreur: 'DWG de plus de 50 Mo : trop gros pour la conversion.' })
  const dwg = new Uint8Array(await lecture.arrayBuffer())
  if (dwg.byteLength > TAILLE_MAX) return res.status(413).json({ erreur: 'DWG de plus de 50 Mo : trop gros pour la conversion.' })
  let dxf
  try {
    dxf = await convertir(dwg)
  } catch (e) {
    return res.status(422).json({ erreur: `Conversion impossible : ${e?.message ?? e}` })
  }
  if (!dxf) return res.status(422).json({ erreur: 'Ce DWG n’a pas pu être lu : fichier abîmé, protégé, ou version trop récente pour libredwg. Enregistre-le en DXF depuis ton logiciel de dessin.' })
  const ecriture = await fetch(destination, { method: 'PUT', headers: { 'content-type': 'application/dxf', 'x-upsert': 'true' }, body: dxf })
  if (!ecriture.ok) return res.status(502).json({ erreur: `Le DXF n’a pas pu être déposé dans le stockage (${ecriture.status}).` })
  return res.status(200).json({ ok: true, octets_dwg: dwg.byteLength, octets_dxf: dxf.length, duree_ms: Date.now() - debut })
}
