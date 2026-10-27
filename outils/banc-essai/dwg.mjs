/**
 * Banc d'essai de la fonction serveur api/dwg-vers-dxf.js (27/10) :
 * la conversion elle-même, en Node, avec le vrai libredwg, sur un DWG
 * d'exemple (fixtures/plan.dwg, tiré des données de test de libredwg,
 * AutoCAD 2018, 162 entités, millimètres) ; puis le gardien d'adresses
 * et le circuit complet de la fonction avec un faux fetch.
 *
 *   node outils/banc-essai/dwg.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Helper } from 'dxf'
import handler, { convertir, adresseAdmise } from '../../api/dwg-vers-dxf.js'

const ici = path.dirname(fileURLToPath(import.meta.url))
const erreurs = []
const dwg = fs.readFileSync(path.join(ici, 'fixtures', 'plan.dwg'))

// 1. La conversion.
const t = Date.now()
const dxf = await convertir(dwg)
const duree = Date.now() - t
if (!dxf) erreurs.push('conversion : null')
else {
  if (!/^(\s*999\r?\n[^\n]*\n)?\s*0\r?\nSECTION/.test(dxf)) erreurs.push('conversion : le texte ne commence pas par 0 / SECTION (après l’éventuel commentaire 999)')
  const h = new Helper(dxf)
  const n = h.denormalised.length
  if (n !== 162) erreurs.push(`conversion : ${n} entités lues par dxf (attendu 162)`)
  if (h.parsed.header.insUnits !== 4) erreurs.push(`conversion : $INSUNITS ${h.parsed.header.insUnits} (attendu 4, millimètres)`)
  const vb = /viewBox="([^"]+)"/.exec(h.toSVG())?.[1]
  if (!vb) erreurs.push('conversion : pas de viewBox dans le SVG')
}
if (await convertir(Buffer.from('pas un dwg')) !== null) erreurs.push('un faux DWG devrait donner null')

// 2. Le gardien d'adresses : le stockage du projet, et rien d'autre.
const hote = 'https://kunvnnfejhnuhflycyfz.supabase.co'
const cas = [
  [`${hote}/storage/v1/object/sign/plans/ev/x.dwg?token=a`, 'lire', true],
  [`${hote}/storage/v1/object/upload/sign/plans/ev/x.dxf?token=a`, 'ecrire', true],
  [`${hote}/storage/v1/object/sign/plans/ev/x.dwg?token=a`, 'ecrire', false],
  ['https://autre.example.org/storage/v1/object/sign/plans/x.dwg', 'lire', false],
  [`http://${hote.slice(8)}/storage/v1/object/sign/plans/x.dwg`, 'lire', false],
  [`${hote}/rest/v1/evenements`, 'lire', false],
  ['n’importe quoi', 'lire', false]
]
for (const [u, v, attendu] of cas) if (adresseAdmise(u, v) !== attendu) erreurs.push(`adresseAdmise(${u}, ${v}) ≠ ${attendu}`)

// 3. Le circuit complet, fetch remplacé.
const depose = []
globalThis.fetch = async (url, options = {}) => {
  if (!options.method) return new Response(dwg, { status: 200, headers: { 'content-length': String(dwg.length) } })
  depose.push({ url, taille: options.body.length, upsert: options.headers['x-upsert'] })
  return new Response('', { status: 200 })
}
function reponse() {
  const r = { code: null, corps: null, status(c) { r.code = c; return r }, json(o) { r.corps = o; return r } }
  return r
}
let r = reponse()
await handler({ method: 'POST', body: { source: cas[0][0], destination: cas[1][0] } }, r)
if (r.code !== 200 || !r.corps?.ok) erreurs.push(`circuit : ${r.code} ${JSON.stringify(r.corps)}`)
if (depose.length !== 1 || depose[0].upsert !== 'true' || !(depose[0].taille > 100000)) erreurs.push(`circuit : dépôt ${JSON.stringify(depose)}`)
r = reponse()
await handler({ method: 'POST', body: { source: 'https://autre.example.org/x.dwg', destination: cas[1][0] } }, r)
if (r.code !== 400) erreurs.push(`adresse étrangère acceptée : ${r.code}`)
r = reponse()
await handler({ method: 'GET' }, r)
if (r.code !== 405) erreurs.push(`GET accepté : ${r.code}`)

console.log(`${erreurs.length ? '✗' : '✓'} dwg-vers-dxf — conversion en ${duree} ms, ${dxf?.length ?? 0} octets de DXF${erreurs.length ? '\n    ' + erreurs.join('\n    ') : ''}`)
process.exit(erreurs.length ? 1 : 0)
