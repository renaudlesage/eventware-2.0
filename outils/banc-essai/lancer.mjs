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
const ecrans = demandes.length ? demandes : ['securite', 'situation', 'terrain', 'autorite', 'participant', 'colonne', 'logistique', 'implantation', 'plan', 'gantt', 'gantt-lecture', 'fournisseurs', 'fournisseurs-lecture', 'demandes-prix', 'demandes-prix-lecture', 'point0']
const navigateur = await pw.chromium.launch()
let echecs = 0
for (const ecran of ecrans) {
  // Sous 1440 px, la Situation replie la carte tactique (au-dessus, elle vit dans la colonne) : on la teste repliée puis dépliée.
  const page = await navigateur.newPage({ viewport: { width: ecran === 'situation' ? 1300 : 1500, height: 900 } })
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
  // Toutes les cartes dessinent le plan comme la conception : calques à
  // cocher, pictogrammes ; décocher un calque retire ses objets.
  if (ecran === 'plan') {
    const onglet = page.getByRole('button', { name: /^Carte$/ })
    if (await onglet.count()) await onglet.first().click()
    await page.waitForTimeout(800)
  }
  if (ecran === 'situation') {
    const deplier = page.getByRole('button', { name: /^Déplier$/ })
    if (await deplier.count()) await deplier.first().click()
    else erreurs.push('bouton Déplier absent sous 1440 px')
    await page.waitForTimeout(1500)
  }
  if (['colonne', 'situation', 'plan'].includes(ecran)) {
    if (!(await page.locator('.calques-carte').count())) erreurs.push('filtre des calques absent')
    const avant = await page.locator('.leaflet-container .impl-picto').count()
    if (!avant) erreurs.push('pictogrammes du plan absents de la carte')
    const securite = page.locator('.calques-carte .impl-calque', { hasText: 'Sécurité' }).first()
    if (await securite.count()) {
      await securite.click()
      await page.waitForTimeout(300)
      if ((await page.locator('.leaflet-container .impl-picto').count()) >= avant && avant) erreurs.push('décocher Sécurité ne retire pas ses pictogrammes')
      await securite.click()
    }
  }
  // (129) Le Gantt : barres, losanges, une flèche violée, le trait J entre
  // un jalon d'avant et un jalon d'après ; glisser une barre appelle
  // deplacer_jalon une seule fois, avec des dates décalées d'autant.
  if (ecran === 'gantt') {
    const barres = await page.locator('.gantt-svg .gantt-barre').count()
    const losanges = await page.locator('.gantt-svg .gantt-losange').count()
    if (barres !== 5) erreurs.push(`${barres} barres (attendu 5)`)
    if (losanges !== 3) erreurs.push(`${losanges} losanges (attendu 3)`)
    if (!(await page.locator('.gantt-svg .gantt-lien.viole').count())) erreurs.push('aucune flèche de dépendance violée')
    const pos = await page.evaluate(() => {
      const j = document.querySelector('.gantt-svg .gantt-j')
      const barres = [...document.querySelectorAll('.gantt-svg:not(.gantt-svg-colonne) .gantt-jalon')].map((g) => ({ code: g.dataset.code, r: g.querySelector('.gantt-barre') ?? g.querySelector('.gantt-losange') }))
      const x = (el) => el.tagName === 'rect' ? Number(el.getAttribute('x')) + Number(el.getAttribute('width')) : Number(el.getAttribute('points').split(' ')[0].split(',')[0])
      const avant = barres.find((b) => b.code?.startsWith('GJ-03'))
      const apres = barres.find((b) => b.code?.startsWith('GJ-07'))
      return { j: j ? Number(j.getAttribute('x1')) : null, avant: avant ? x(avant.r) : null, apres: apres ? Number(apres.r.getAttribute('x')) : null }
    })
    if (pos.j == null || !(pos.avant < pos.j && pos.j < pos.apres)) erreurs.push(`trait J mal placé : ${JSON.stringify(pos)}`)
    if (!(await page.locator('.gantt-outils input[type=checkbox]').first().count())) erreurs.push('interrupteur Entraîner absent')
    // Glisser GJ-03 de deux jours (18 px par jour).
    const barre = page.locator('.gantt-svg .gantt-jalon.statut-en_cours .gantt-barre').first()
    const b = await barre.boundingBox()
    await page.evaluate(() => { window.__appels = [] })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 4 })
    await page.mouse.move(b.x + b.width / 2 + 36, b.y + b.height / 2, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const appels = await page.evaluate(() => (window.__appels ?? []).filter((a) => a.fn === 'deplacer_jalon'))
    if (appels.length !== 1) erreurs.push(`deplacer_jalon appelé ${appels.length} fois (attendu 1)`)
    else {
      const a = appels[0].args
      const dFin = (new Date(a.p_fin) - new Date('2026-10-15T17:00:00+01:00')) / 86400000
      const dDebut = (new Date(a.p_debut) - new Date('2026-10-01T09:00:00+01:00')) / 86400000
      if (dFin !== 2 || dDebut !== 2) erreurs.push(`décalage ${dDebut} / ${dFin} jours (attendu 2 / 2)`)
      if (a.p_entrainer !== true) erreurs.push('p_entrainer devrait être vrai par défaut')
    }
    // Clic sans glisser : la fiche s'ouvre.
    const los = page.locator('.gantt-svg .gantt-losange').first()
    await los.click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.fiche-jalon').count())) erreurs.push('la fiche ne s’ouvre pas au clic')
  }
  // (130) L'annuaire : trois fournisseurs, le filtre par catégorie, la fiche avec ses contacts.
  if (ecran === 'fournisseurs') {
    const n = await page.locator('.four-carte').count()
    if (n !== 3) erreurs.push(`${n} fournisseurs (attendu 3)`)
    await page.locator('.compteurs select').first().selectOption('energie')
    await page.waitForTimeout(200)
    const n2 = await page.locator('.four-carte').count()
    if (n2 !== 1) erreurs.push(`${n2} fournisseurs en énergie (attendu 1)`)
    await page.locator('.compteurs select').first().selectOption('')
    await page.locator('.four-carte[data-nom="Barrières Lemaire"] button', { hasText: 'Ouvrir' }).click()
    await page.waitForTimeout(400)
    if (!(await page.locator('.four-fiche').count())) erreurs.push('la fiche ne s’ouvre pas')
    const contacts = await page.locator('.four-fiche .four-contact').count()
    if (contacts !== 3) erreurs.push(`${contacts} contacts dans la fiche (attendu 3 : le faux client rend toute la table)`)
    if (!(await page.getByText('Importer (CSV)').count())) erreurs.push('import CSV absent pour qui gère')
    await page.evaluate(() => { window.__appels = [] })
    await page.locator('.four-carte[data-nom="Clôtures Dupont"] button', { hasText: 'Épingler' }).click()
    await page.waitForTimeout(300)
    const ep = await page.evaluate(() => (window.__appels ?? []).filter((a) => a.fn === 'epingler_fournisseur'))
    if (ep.length !== 1 || ep[0].args.p_fournisseur !== 'f2') erreurs.push(`epingler_fournisseur : ${JSON.stringify(ep)}`)
  }
  if (ecran === 'fournisseurs-lecture') {
    if (await page.getByText('Ajouter un fournisseur').count()) erreurs.push('bouton Ajouter visible sans droit de gérer')
    if (await page.getByText('Importer (CSV)').count()) erreurs.push('import visible sans droit de gérer')
    if (await page.getByText('Épingler').count()) erreurs.push('Épingler visible pour un lecteur')
    await page.locator('.four-carte button', { hasText: 'Ouvrir' }).first().click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.four-fiche input[disabled]').count())) erreurs.push('la fiche n’est pas en lecture seule')
    if (await page.locator('.four-fiche button', { hasText: 'Enregistrer' }).count()) erreurs.push('Enregistrer visible en lecture')
  }
  // (131) Les demandes de prix : la liste, la fiche, la grille avec la meilleure valeur, Retenir qui exige un motif et appelle retenir_offre une fois, la saisie d'une offre par lignes.
  if (ecran === 'demandes-prix') {
    const n = await page.locator('.dp-liste tr.dp-ligne').count()
    if (n !== 2) erreurs.push(`${n} demandes (attendu 2)`)
    await page.locator('.dp-liste tr[data-reference="DP-01"]').click()
    await page.waitForTimeout(500)
    if (!(await page.locator('.dp-fiche').count())) erreurs.push('la fiche ne s’ouvre pas')
    const lignes = await page.locator('.dp-lignes tbody tr').count()
    if (lignes !== 3) erreurs.push(`${lignes} lignes (attendu 3)`)
    const cons = await page.locator('.dp-consultation').count()
    if (cons !== 2) erreurs.push(`${cons} consultations (attendu 2)`)
    const colonnes = await page.locator('.dp-comparaison thead th').count()
    if (colonnes !== 3) erreurs.push(`${colonnes} en-têtes de grille (attendu 3 : libellé + 2 offres)`)
    const meilleurs = await page.locator('.dp-comparaison td.dp-meilleur').count()
    if (meilleurs !== 4) erreurs.push(`${meilleurs} meilleures valeurs (attendu 4 : 3 lignes + total)`)
    // Retenir : motif obligatoire, un seul appel.
    await page.evaluate(() => { window.__appels = [] })
    await page.locator('.dp-comparaison button', { hasText: 'Retenir' }).first().click()
    await page.waitForTimeout(200)
    if (!(await page.locator('.dp-retenir').count())) erreurs.push('la demande de motif ne s’ouvre pas')
    if (!(await page.locator('.dp-retenir button', { hasText: 'Confirmer' }).isDisabled())) erreurs.push('Confirmer actif sans motif')
    await page.locator('.dp-retenir input').fill('Moins cher, livraison comprise')
    await page.locator('.dp-retenir button', { hasText: 'Confirmer' }).click()
    await page.locator('.dp-retenir button', { hasText: 'Confirmer' }).click().catch(() => {})
    await page.waitForTimeout(400)
    const ret = await page.evaluate(() => (window.__appels ?? []).filter((a) => a.fn === 'retenir_offre'))
    if (ret.length !== 1) erreurs.push(`retenir_offre appelé ${ret.length} fois (attendu 1)`)
    else if (ret[0].args.p_consultation !== 'c1' || ret[0].args.p_motif !== 'Moins cher, livraison comprise') erreurs.push(`retenir_offre : ${JSON.stringify(ret[0].args)}`)
    // Saisie d'une offre par lignes : le total suit.
    await page.locator('.dp-consultation[data-fournisseur="Clôtures Dupont"] button', { hasText: 'offre' }).first().click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.dp-offre').count())) erreurs.push('la saisie d’offre ne s’ouvre pas')
    else {
      const prix = page.locator('.dp-offre tbody tr').first().locator('input[type=number]').first()
      await prix.fill('4')
      await page.waitForTimeout(150)
      const total = await page.locator('.dp-offre [data-total]').textContent().catch(() => null)
      if (!total || !/40,00/.test(total)) erreurs.push(`total après saisie : ${total} (attendu 40,00 € pour 10 × 4)`)
    }
  }
  if (ecran === 'demandes-prix-lecture') {
    await page.locator('.dp-liste tr[data-reference="DP-01"]').click()
    await page.waitForTimeout(500)
    if (!(await page.locator('.dp-fiche').count())) erreurs.push('la fiche ne s’ouvre pas en lecture')
    if (await page.locator('.dp-fiche button', { hasText: 'Retenir' }).count()) erreurs.push('Retenir visible en lecture')
    if (await page.locator('.dp-ajout-ligne').count()) erreurs.push('ajout de ligne visible en lecture')
    if (await page.locator('.dp-ajout-consultation').count()) erreurs.push('ajout de consultation visible en lecture')
    if (await page.getByText('Nouvelle demande de prix').count()) erreurs.push('création visible en lecture')
    if (await page.locator('.dp-fiche button', { hasText: 'Saisir' }).count()) erreurs.push('saisie d’offre visible en lecture')
  }
  // Le point 0 : un clic sur la carte remplit les champs et pose le marqueur.
  if (ecran === 'point0') {
    if (await page.locator('.point-0-marqueur').count()) erreurs.push('marqueur présent sans point 0')
    const carte = page.locator('.point-0-carte .leaflet-container')
    const b = await carte.boundingBox()
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(400)
    const lat = await page.locator('input[placeholder^="Latitude"]').inputValue()
    const lon = await page.locator('input[placeholder^="Longitude"]').inputValue()
    if (!(Number(lat) > 49 && Number(lat) < 52 && Number(lon) > 2 && Number(lon) < 7)) erreurs.push(`clic sur la carte : ${lat}, ${lon} (attendu en Belgique)`)
    if (!(await page.locator('.point-0-marqueur').count())) erreurs.push('marqueur absent après le clic')
    if (await page.locator('button', { hasText: 'Enregistrer le point 0' }).isDisabled()) erreurs.push('Enregistrer inactif après le clic')
  }
  // (27/10) Le catalogue s'élargit à la poignée.
  if (ecran === 'implantation') {
    const poignee = page.locator('.impl-poignee')
    if (!(await poignee.count())) erreurs.push('poignée du catalogue absente')
    else {
      const avant = await page.locator('.impl-catalogue').evaluate((el) => el.getBoundingClientRect().width)
      const b = await poignee.boundingBox()
      await page.mouse.move(b.x + b.width / 2, b.y + 40)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2 + 120, b.y + 40, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(200)
      const apres = await page.locator('.impl-catalogue').evaluate((el) => el.getBoundingClientRect().width)
      if (!(apres > avant + 100)) erreurs.push(`catalogue : ${avant} → ${apres} px (attendu +120)`)
    }

    // (27/10) Le fond de plan tourné : l'image porte une rotation, les réglages la changent.
    // Page rechargée : les étapes précédentes laissent un objet sélectionné, et ses propriétés prennent la place du panneau Fonds.
    await page.goto('file://' + path.join(sortie, 'page.html') + '?ecran=' + ecran, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    const img = page.locator('.leaflet-image-layer')
    if (!(await img.count())) erreurs.push('fond de plan absent de la carte')
    else {
      const tr = await img.evaluate((el) => el.style.transform)
      if (!/rotate\(/.test(tr)) erreurs.push(`fond sans rotation : ${tr}`)
      const angle = await img.evaluate((el) => Number((el.style.transform.match(/rotate\(([-\d.]+)rad\)/) ?? [])[1]))
      if (!(Math.abs(angle * 180 / Math.PI - 20) < 1)) erreurs.push(`angle du fond ${(angle * 180 / Math.PI).toFixed(1)}° (attendu 20°)`)
      const rot = page.locator('.impl-fond-reglages input[type=range]')
      if (!(await rot.count())) erreurs.push('réglage de rotation absent')
      else {
        const l = await page.locator('.impl-fond-dims input').first().inputValue()
        const h = await page.locator('.impl-fond-dims input').nth(1).inputValue()
        if (!(Math.abs(Number(l) - 60) < 0.5 && Math.abs(Number(h) - 30) < 0.5)) erreurs.push(`mesures du fond ${l} × ${h} (attendu 60 × 30)`)
        if (Math.abs(Number(await rot.inputValue()) - 20) > 0.6) erreurs.push(`rotation lue ${await rot.inputValue()} (attendu 20)`)
        await rot.fill('65')
        await page.waitForTimeout(300)
        const angle2 = await img.evaluate((el) => Number((el.style.transform.match(/rotate\(([-\d.]+)rad\)/) ?? [])[1]))
        if (!(Math.abs(angle2 * 180 / Math.PI - 65) < 1)) erreurs.push(`angle après réglage ${(angle2 * 180 / Math.PI).toFixed(1)}° (attendu 65°)`)
      }
    }
  }
  if (ecran === 'gantt-lecture') {
    if (await page.locator('.gantt-svg .gantt-poignee').count()) erreurs.push('poignées visibles en lecture seule')
    if (await page.getByText('Entraîner les suivantes').count()) erreurs.push('interrupteur Entraîner visible en lecture seule')
    if (!(await page.locator('.gantt-svg .gantt-barre').count())) erreurs.push('Gantt absent en lecture')
  }
  // La carte vectorielle de l'autorité : présente, avec le plan dessus et ses calques.
  if (ecran === 'autorite') {
    if (!(await page.locator('.calques-carte').count())) erreurs.push('filtre des calques absent')
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
