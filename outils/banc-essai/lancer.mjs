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
fs.writeFileSync(path.join(sortie, 'page.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="racine"></div><script src="bundle.js"></script></body></html>')

const demandes = process.argv.slice(2)
const ecrans = demandes.length ? demandes : ['securite', 'situation', 'terrain', 'autorite', 'participant', 'colonne', 'logistique']
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
  await page.goto('file://' + path.join(sortie, 'page.html') + '?ecran=' + ecran)
  await page.waitForTimeout(2500)
  const texte = (await page.locator('#racine').innerText().catch(() => '')).replace(/\s+/g, ' ')
  if (!texte.trim()) erreurs.push('rien de rendu')
  if (erreurs.length) echecs++
  console.log(`${erreurs.length ? '✗' : '✓'} ${ecran}${erreurs.length ? '\n    ' + erreurs.join('\n    ') : ' — ' + texte.slice(0, 90)}`)
  await page.close()
}
await navigateur.close()
process.exit(echecs ? 1 : 0)
