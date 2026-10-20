/**
 * Banc d'essai : chaque écran est monté dans Chromium headless avec un
 * faux client Supabase, et toute erreur d'exécution est rapportée.
 *
 * Pourquoi : `vite build` ne voit pas un identifiant global absent
 * (PC-OPS a planté au rendu pendant une soirée, 17/10, pour une
 * constante retirée par un script — `RELEVE_PERIME_MS is not defined`).
 * Dix secondes ici l'auraient attrapé.
 *
 *   node outils/banc-essai/lancer.mjs            # tous les écrans
 *   node outils/banc-essai/lancer.mjs securite   # un seul
 *
 * Il faut Playwright et un Chromium (npx playwright install chromium,
 * ou PLAYWRIGHT_BROWSERS_PATH déjà renseigné). esbuild vient avec Vite.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const ici = path.dirname(fileURLToPath(import.meta.url))
const racine = path.resolve(ici, '..', '..')
const require = createRequire(import.meta.url)

let pw
try {
  pw = require('playwright')
} catch {
  for (const c of ['/opt/node-tools/node_modules/playwright', process.env.PLAYWRIGHT_PATH]) {
    try { pw = require(c); break } catch { /* suivant */ }
  }
}
if (!pw) {
  console.error('Playwright introuvable : npm i -D playwright, puis npx playwright install chromium.')
  process.exit(2)
}
const esbuild = require('esbuild')

const sortie = path.join(racine, 'node_modules', '.banc-essai')
fs.mkdirSync(sortie, { recursive: true })
await esbuild.build({
  entryPoints: [path.join(ici, 'ecrans.jsx')],
  bundle: true,
  outfile: path.join(sortie, 'bundle.js'),
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins: [{ name: 'faux-supabase', setup(b) { b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: path.join(ici, 'faux-supabase.js') })) } }],
  define: { 'import.meta.env': '{"PROD":false,"VITE_SUPABASE_URL":"http://localhost","VITE_SUPABASE_ANON_KEY":"k"}', 'process.env.NODE_ENV': '"development"' },
  loader: { '.jsx': 'jsx', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  logLevel: 'error'
})
// La vraie feuille de style : sans elle, une carte dans un conteneur sans
// hauteur (taille 0 × 0) fait tourner Leaflet en boucle au cadrage, et la
// page ne répond plus — ce n'est pas un bogue de l'écran.
fs.writeFileSync(path.join(sortie, 'page.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="../leaflet/dist/leaflet.css"><link rel="stylesheet" href="../../src/styles.css"></head><body><div id="racine"></div><script src="bundle.js"></script></body></html>')

const demandes = process.argv.slice(2)
const ecrans = demandes.length ? demandes : ['securite', 'situation', 'terrain', 'autorite', 'participant', 'colonne', 'logistique', 'implantation']
const navigateur = await pw.chromium.launch()
let echecs = 0
for (const ecran of ecrans) {
  const page = await navigateur.newPage({ viewport: { width: 1500, height: 900 } })
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push('exception : ' + e.message.split('\n')[0]))
  page.on('console', (m) => {
    // Les tuiles de carte ne se chargent pas sans réseau : ce n'est pas une erreur de l'écran.
    if (m.type() === 'error' && !/net::|ERR_/.test(m.text())) erreurs.push('console : ' + m.text().split('\n')[0].slice(0, 200))
  })
  // domcontentloaded : l'événement load attend les tuiles de carte, qui n'arrivent jamais sans réseau.
  await page.goto('file://' + path.join(sortie, 'page.html') + '?ecran=' + ecran, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // L'éditeur d'implantation : chaque outil, puis un objet cliqué pour
  // ouvrir ses propriétés (liens, extincteur, eau).
  if (ecran === 'implantation') {
    for (const outil of ['Main', 'Lier', 'Mesurer', 'Sélection']) {
      const b = page.getByRole('button', { name: new RegExp('^' + outil) })
      if (await b.count()) await b.first().click()
    }
    // Un pictogramme (marqueur, cliquable au centre) ouvre les propriétés.
    const picto = page.locator('.impl-picto').first()
    if (await picto.count()) { await picto.click({ force: true }); await page.waitForTimeout(600) }
    if (!(await page.locator('.impl-props').count())) erreurs.push('propriétés non ouvertes après clic sur un objet')
    // Le tracé : on clique exactement sur son premier sommet (le centre de
    // la boîte d'un trait n'est pas sur le trait), puis les poignées.
    const point = await page.evaluate(() => {
      const chemin = [...document.querySelectorAll('path.leaflet-interactive')].find((c) => !c.getAttribute('fill') || c.getAttribute('fill') === 'none')
      if (!chemin) return null
      const m = /M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(chemin.getAttribute('d') ?? '')
      if (!m) return null
      const pt = chemin.ownerSVGElement.createSVGPoint()
      pt.x = Number(m[1]); pt.y = Number(m[2])
      const s = pt.matrixTransform(chemin.getScreenCTM())
      return { x: s.x, y: s.y }
    })
    if (point) { await page.mouse.click(point.x, point.y); await page.waitForTimeout(600) }
    if (!(await page.locator('.impl-sommet').count())) erreurs.push('poignées de sommets absentes sur le tracé sélectionné')
  }
  // La carte vectorielle de l'autorité : présente, avec le plan dessus.
  if (ecran === 'autorite') {
    if (!(await page.locator('.carte-svg').count())) erreurs.push('carte vectorielle absente')
    if (!(await page.locator('.carte-svg .carte-picto').count())) erreurs.push('pictogrammes du plan absents de la carte')
  }
  const texte = (await page.locator('#racine').innerText().catch(() => '')).replace(/\s+/g, ' ')
  if (!texte.trim()) erreurs.push('rien de rendu')
  if (erreurs.length) echecs++
  console.log(`${erreurs.length ? '✗' : '✓'} ${ecran}${erreurs.length ? '\n    ' + erreurs.join('\n    ') : ' — ' + texte.slice(0, 90)}`)
  await page.close()
}
await navigateur.close()
process.exit(echecs ? 1 : 0)
