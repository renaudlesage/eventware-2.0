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
const ecrans = demandes.length ? demandes : ['securite', 'situation', 'terrain', 'autorite', 'participant', 'colonne', 'logistique', 'implantation', 'plan', 'gantt', 'gantt-lecture', 'fournisseurs', 'fournisseurs-lecture', 'demandes-prix', 'demandes-prix-lecture', 'inventaire', 'inventaire-lecture', 'point0']
const navigateur = await pw.chromium.launch()
let echecs = 0
for (const ecran of ecrans) {
  // Sous 1440 px, la Situation replie la carte tactique (au-dessus, elle vit dans la colonne) : on la teste repliée puis dépliée.
  const page = await navigateur.newPage({ viewport: { width: ecran === 'situation' ? 1300 : 1500, height: 900 } })
  const erreurs = []
  // Les messages que l'Implantation adresse à l'utilisateur (setMessage) arrivent ici préfixés « message » : on les garde à part.
  const messages = []
  page.on('pageerror', (e) => erreurs.push('exception : ' + e.message.split('\n')[0]))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/^message /.test(m.text())) { messages.push(m.text().slice(8)); return }
    // Les tuiles de carte ne se chargent pas sans réseau : ce n'est pas une erreur de l'écran.
    if (!/net::|ERR_/.test(m.text())) erreurs.push('console : ' + m.text().split('\n')[0].slice(0, 200))
  })
  // domcontentloaded : l'événement load attend les tuiles de carte, qui n'arrivent jamais sans réseau.
  await page.goto('file://' + path.join(sortie, 'page.html') + '?ecran=' + ecran, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // (138) Matériel : tri et filtre par colonne, prêts, formulaire de sortie, étiquettes, scanner ; puis en lecture.
  if (ecran === 'inventaire') {
    const lignes = () => page.locator('.inv-tableau tbody tr')
    if ((await lignes().count()) !== 3) erreurs.push(`${await lignes().count()} articles (attendu 3)`)
    const premier = () => page.locator('.inv-tableau tbody tr').first().locator('td').nth(1).innerText()
    await page.locator('.inv-th', { hasText: 'Valeur HTVA' }).click()
    await page.waitForTimeout(200)
    if (!/Table pliante/.test(await premier())) erreurs.push(`tri par valeur croissante : premier « ${await premier()} » (attendu la table à 45 €)`)
    await page.locator('.inv-th', { hasText: 'Valeur HTVA' }).click()
    await page.waitForTimeout(200)
    if (!/Sono/.test(await premier())) erreurs.push(`tri par valeur décroissante : premier « ${await premier()} » (attendu la sono à 900 €)`)
    await page.locator('.inv-filtres input').nth(1).fill('tente')
    await page.waitForTimeout(200)
    if ((await lignes().count()) !== 1) erreurs.push(`filtre « tente » : ${await lignes().count()} ligne(s) (attendu 1)`)
    await page.getByText('Effacer les filtres').click()
    await page.waitForTimeout(200)
    if (!(await page.locator('.inv-sortir').count())) erreurs.push('bouton Sortir absent pour qui gère')
    if (!(await page.getByText('Ajouter un article').count())) erreurs.push('Ajouter un article absent pour qui gère')
    // L'import CSV : un fichier de trois lignes, dont un code connu, une description connue et une quantité fausse.
    await page.getByText('Importer (CSV)').click()
    await page.waitForTimeout(200)
    if (!(await page.getByText('Télécharger un exemple rempli').count())) erreurs.push('import : exemple rempli absent')
    const csv = 'code;description;categorie;quantite;emplacement;valeur_htva;prix_location;notes\nINV-0001;Tente 3 × 3 m blanche;tentes;5;Hangar;250,00;15;\n;Sono 2 × 300 W;sono;1;;900;40;\n;Groupe électrogène 3 kVA;énergie;1;Remorque;1 200,50;60;\n;Bâche 6 × 4;tentes;deux;;;;'
    await page.locator('.inv-import input[type=file]').setInputFiles({ name: 'inventaire.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeff' + csv, 'utf8') })
    await page.waitForTimeout(600)
    const bilanImport = (await page.locator('.inv-import-bilan').textContent().catch(() => '')) ?? ''
    if (!/^1 à créer, 2 déjà connus, 1 rejetés/.test(bilanImport.trim())) erreurs.push(`import : « ${bilanImport.trim()} » (attendu 1 à créer, 2 déjà connus, 1 rejetés)`)
    if (!(await page.getByText(/quantité : un entier positif attendu/).count())) erreurs.push('import : la quantité « deux » n’est pas rejetée')
    await page.locator('.inv-import button', { hasText: 'Fermer l’import' }).click()
    await page.waitForTimeout(200)
    // La fiche d'un article : QR et bouton NFC.
    await page.locator('.inv-tableau tbody tr').first().locator('button.lien').first().click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.inv-fiche svg').count())) erreurs.push('QR absent de la fiche')
    if (!(await page.getByText('Écrire une puce NFC').count())) erreurs.push('bouton NFC absent de la fiche')
    await page.locator('.inv-fiche button', { hasText: 'Fermer' }).click()
    // Les prêts : deux lignes, une en retard, Retour sur la ligne sortie seulement.
    await page.getByRole('button', { name: /^Prêts et locations/ }).click()
    await page.waitForTimeout(300)
    if ((await lignes().count()) !== 2) erreurs.push(`${await lignes().count()} sorties (attendu 2)`)
    if ((await page.locator('.inv-statut.en_retard').count()) !== 1) erreurs.push('la location en retard n’est pas marquée')
    if ((await page.locator('.inv-retour').count()) !== 1) erreurs.push(`${await page.locator('.inv-retour').count()} boutons Retour (attendu 1 : la sortie en cours)`)
    await page.getByText('Nouveau prêt ou location').click()
    await page.waitForTimeout(300)
    const options = await page.locator('.inv-fiche select').first().locator('option').count()
    if (options !== 4) erreurs.push(`${options} options dans le choix du matériel (attendu 4 : vide + 3 articles)`)
    await page.locator('.inv-fiche select').first().selectOption('in2')
    await page.locator('.inv-fiche select').nth(1).selectOption('location')
    await page.locator('.inv-fiche input[type=date]').nth(1).fill('2026-11-03')
    await page.locator('.inv-fiche input[type=date]').first().fill('2026-11-01')
    await page.waitForTimeout(200)
    if (!(await page.getByText(/proposé : 80,00/).count())) erreurs.push('prix de location proposé absent ou faux (attendu 80,00 € : 2 jours × 40 €)')
    await page.locator('.inv-fiche button', { hasText: 'Annuler' }).click()
    // Étiquettes : trois QR ; scanner : saisie du code ouvre la fiche.
    await page.getByRole('button', { name: /^Étiquettes/ }).click()
    await page.waitForTimeout(300)
    if ((await page.locator('.inv-etiquette-carte svg').count()) !== 3) erreurs.push(`${await page.locator('.inv-etiquette-carte svg').count()} étiquettes (attendu 3)`)
    await page.getByRole('button', { name: /^Scanner/ }).click()
    await page.waitForTimeout(300)
    await page.locator('.inv-scanner input').fill('https://exemple.be/?materiel=INV-0003')
    await page.locator('.inv-scanner button[type=submit]').click()
    await page.waitForTimeout(300)
    if (!(await page.locator('.inv-fiche', { hasText: 'Table pliante' }).count())) erreurs.push('le code scanné n’ouvre pas la fiche de l’article')
  }
  if (ecran === 'inventaire-lecture') {
    if (await page.getByText('Ajouter un article').count()) erreurs.push('Ajouter un article visible en lecture')
    if (await page.locator('.inv-sortir').count()) erreurs.push('Sortir visible en lecture')
    if (await page.getByText('Importer (CSV)').count()) erreurs.push('Importer (CSV) visible en lecture')
    await page.getByRole('button', { name: /^Prêts et locations/ }).click()
    await page.waitForTimeout(300)
    if (await page.locator('.inv-retour').count()) erreurs.push('Retour visible en lecture')
    if (await page.getByText('Nouveau prêt ou location').count()) erreurs.push('Nouveau prêt visible en lecture')
  }
  // (27/10) Sécurité › Effectifs : les DEA et extincteurs du plan sont comptés (1 et 1 dans le faux plan), « Reprendre » proposé.
  if (ecran === 'securite') {
    await page.getByRole('button', { name: /^Effectifs/ }).first().click().catch(() => {})
    await page.waitForTimeout(500)
    const comptes = await page.locator('.moyens-plan').allTextContents()
    if (comptes.length !== 2) erreurs.push(`Effectifs : ${comptes.length} comptes du plan (attendu 2 : DEA, extincteurs)`)
    else if (!comptes.every((t) => /^1 sur le plan/.test(t))) erreurs.push(`Effectifs : comptes du plan ${JSON.stringify(comptes)} (attendu 1 et 1)`)
    if (!(await page.locator('.moyens-plan button', { hasText: 'Reprendre' }).count())) erreurs.push('Effectifs : « Reprendre » absent alors que le plan en compte plus que le total')
  }
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
    // (27/10) La table dans le PRV : les emprises sont dessinées de la plus grande à la plus petite, la petite est
    // donc cliquable ; un second clic au même endroit passe au PRV, un troisième revient à la table.
    {
      const emprises = page.locator('path.leaflet-interactive[fill]:not([fill="none"])')
      const n = await emprises.count()
      const derniere = emprises.nth(n - 1)
      const nomSelectionne = () => page.locator('.impl-props input').first().inputValue()
      await derniere.click({ force: true }); await page.waitForTimeout(300)
      if ((await nomSelectionne()) !== 'Table pliante') erreurs.push(`premier clic : « ${await nomSelectionne()} » (attendu la table, dessinée au-dessus du PRV)`)
      if (!(await page.locator('.impl-pile').count())) erreurs.push('la fiche ne signale pas les emprises superposées')
      await derniere.click({ force: true }); await page.waitForTimeout(300)
      if ((await nomSelectionne()) !== 'PRV') erreurs.push(`second clic : « ${await nomSelectionne()} » (attendu le PRV, dessous)`)
      await derniere.click({ force: true }); await page.waitForTimeout(300)
      if ((await nomSelectionne()) !== 'Table pliante') erreurs.push(`troisième clic : « ${await nomSelectionne()} » (attendu la table à nouveau)`)
      await page.keyboard.press('Escape').catch(() => {})
    }
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
    // (139) La voie d'accès secours : une chaussée rouge, dessinée à part des files de barrières.
    const voies = page.locator('path.leaflet-interactive[stroke="#c8102e"][stroke-width="7"]')
    if ((await voies.count()) !== 1) erreurs.push(`${await voies.count()} voie(s) d’accès secours dessinée(s) en chaussée rouge (attendu 1)`)
  }
  // Toutes les cartes dessinent le plan comme la conception : calques à
  // cocher, pictogrammes ; décocher un calque retire ses objets.
  if (ecran === 'plan') {
    // (28/10) Bilans › Métré : un tracé compte sa longueur (la barrière 40 m en 12 modules, la voie 60 m), un objet sa surface.
    await page.getByRole('button', { name: /^Bilans$/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /^Métré$/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    const longueurs = await page.locator('.bilan-longueur').allTextContents()
    if (!longueurs.some((t) => /^40 m$/.test(t.trim()))) erreurs.push(`métré : longueur de la file de barrières absente (${JSON.stringify(longueurs)})`)
    if (!longueurs.some((t) => /^60 m$/.test(t.trim()))) erreurs.push(`métré : longueur de la voie d’accès secours absente (${JSON.stringify(longueurs)})`)
    if (!(await page.getByText('modules de 3,5 m').count())) erreurs.push('métré : les modules de la barrière ne sont plus indiqués')
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
    if (barres !== 6) erreurs.push(`${barres} barres (attendu 6)`)
    if (losanges !== 3) erreurs.push(`${losanges} losanges (attendu 3)`)
    // (27/10) Le jalon d'avril, 224 jours avant J, est dessiné à sa place : la fenêtre remonte jusqu'à lui.
    const avril = await page.evaluate(() => {
      const g = [...document.querySelectorAll('.gantt-svg:not(.gantt-svg-colonne) .gantt-jalon')].find((x) => x.dataset.code?.startsWith('GJ-09'))
      const r = g?.querySelector('.gantt-barre')
      const j = document.querySelector('.gantt-svg .gantt-j')
      return r && j ? { x: Number(r.getAttribute('x')), largeur: Number(r.getAttribute('width')), j: Number(j.getAttribute('x1')) } : null
    })
    if (!avril) erreurs.push('le jalon d’avril (224 jours avant J) n’est pas dessiné')
    else if (!(avril.x >= 0 && avril.largeur > 100 && avril.j - avril.x > 200 * 18)) erreurs.push(`jalon d’avril mal placé : ${JSON.stringify(avril)} (attendu x ≥ 0, 9 jours de large, plus de 200 jours avant J)`)
    if (!(await page.getByRole('button', { name: 'jour J' }).count())) erreurs.push('« Aller à : jour J » absent')
    // (28/10) Ajouter un jalon depuis la frise : code déjà pris signalé, puis un jalon valide envoyé.
    await page.getByRole('button', { name: '+ Jalon' }).click()
    await page.waitForTimeout(200)
    await page.locator('.gantt-ajout input[aria-label=Code]').fill('GJ-01')
    await page.locator('.gantt-ajout input[aria-label=Libellé]').fill('Essai')
    await page.locator('.gantt-ajout input[aria-label=Échéance]').fill('2026-10-20')
    await page.waitForTimeout(200)
    if (!(await page.locator('.gantt-doublon').count())) erreurs.push('ajout : le code GJ-01 déjà pris n’est pas signalé')
    if (!(await page.locator('.gantt-ajout button', { hasText: 'Ajouter' }).isDisabled())) erreurs.push('ajout : Ajouter actif malgré le doublon')
    await page.locator('.gantt-doublon button').click()
    await page.waitForTimeout(200)
    if ((await page.locator('.gantt-ajout input[aria-label=Code]').inputValue()) !== 'GJ-10') erreurs.push(`ajout : code proposé « ${await page.locator('.gantt-ajout input[aria-label=Code]').inputValue()} » (attendu GJ-10 : GJ-01 à GJ-09 sont pris)`)
    if (await page.locator('.gantt-ajout select[aria-label=Groupe] option').count() !== 2) erreurs.push('ajout : le groupe de travail du faux événement n’est pas proposé')
    await page.locator('.gantt-ajout button', { hasText: 'Ajouter' }).click()
    await page.waitForTimeout(400)
    if (await page.locator('.gantt-ajout').count()) erreurs.push('ajout : le formulaire reste ouvert après un ajout accepté')
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
      // Glisser le fond : il suit la souris, la carte ne bouge pas. Le curseur revient
      // à 20° d'abord : l'aperçu de rotation n'est pas écrit par le faux client, et le
      // glisser repart des coins enregistrés.
      await page.locator('.impl-fond-reglages input[type=range]').fill('20')
      await page.waitForTimeout(200)
      // Sans « Déplacer », glisser sur l'image déplace la carte, pas le fond.
      const curseurAvant = await img.evaluate((el) => el.style.cursor)
      if (curseurAvant === 'move') erreurs.push('le fond est glissable sans avoir cliqué Déplacer')
      await page.locator('.impl-fond button', { hasText: 'Déplacer' }).first().click()
      await page.waitForTimeout(200)
      if (!(await page.getByText('Terminer le déplacement').count())) erreurs.push('Déplacer n’active pas l’outil')
      const avantX = await img.evaluate((el) => el.getBoundingClientRect().left)
      const carteAvant = await page.locator('.leaflet-map-pane').evaluate((el) => el.style.transform)
      const bi = await img.boundingBox()
      await page.mouse.move(bi.x + bi.width * 0.5, bi.y + bi.height * 0.5)
      await page.mouse.down()
      await page.mouse.move(bi.x + bi.width * 0.5 + 60, bi.y + bi.height * 0.5, { steps: 4 })
      await page.mouse.move(bi.x + bi.width * 0.5 + 100, bi.y + bi.height * 0.5, { steps: 4 })
      await page.waitForTimeout(200)
      // Mesuré avant le relâchement : le faux client ne garde pas l'écriture, l'image reviendrait à ses coins d'origine.
      const apresX = await img.evaluate((el) => el.getBoundingClientRect().left)
      const carteApres = await page.locator('.leaflet-map-pane').evaluate((el) => el.style.transform)
      await page.mouse.up()
      await page.waitForTimeout(300)
      // (27/10) Un DXF de 60 000 × 30 000 mm devient un PNG de 60 × 30 m ; un DWG est refusé avec le conseil d'export.
      await page.locator('button', { hasText: 'Terminer le déplacement' }).first().click().catch(() => {})
      await page.evaluate(() => { window.__banc = { dxf: (m) => { window.__dxf = { largeurM: m.largeurM, hauteurM: m.hauteurM, entites: m.entites, pixels: m.pixels, octets: m.blob?.size } } } })
      await page.locator('.impl-envoi input').setInputFiles(path.join(process.cwd(), 'outils', 'banc-essai', 'fixtures', 'plan.dxf'))
      await page.waitForTimeout(1500)
      const dxf = await page.evaluate(() => window.__dxf)
      if (!dxf) erreurs.push('DXF non converti')
      else {
        if (Math.abs(dxf.largeurM - 60) > 0.01 || Math.abs(dxf.hauteurM - 30) > 0.01) erreurs.push(`DXF : ${dxf.largeurM} × ${dxf.hauteurM} m (attendu 60 × 30)`)
        if (dxf.entites !== 3) erreurs.push(`DXF : ${dxf.entites} entités (attendu 3)`)
        if (!(dxf.pixels?.[0] === 4096 && dxf.pixels?.[1] === 2048)) erreurs.push(`DXF : image ${dxf.pixels} (attendu 4096 × 2048)`)
        if (!(dxf.octets > 1000)) erreurs.push(`DXF : PNG de ${dxf.octets} octets`)
      }
      if (!messages.some((t) => /^DXF converti : 3 entités, 60,0 × 30,0 m/.test(t))) erreurs.push(`message de conversion DXF absent ou faux : ${JSON.stringify(messages)}`)
      // Un DWG passe par le serveur (api/dwg-vers-dxf) : ici simulé, il « rend » le DXF de la fixture ; puis un refus du serveur.
      await page.locator('button', { hasText: 'Terminer le déplacement' }).first().click().catch(() => {})
      // La page vient de file:// : une adresse relative n'y part pas, on remplace fetch pour celle-là.
      await page.evaluate((t) => {
        window.__dxfConverti = t
        window.__dxf = null
        window.__appelsApi = []
        window.__reponseApi = { status: 200, body: { ok: true } }
        const vrai = window.fetch
        window.fetch = (url, options) => {
          if (url !== '/api/dwg-vers-dxf') return vrai(url, options)
          window.__appelsApi.push(JSON.parse(options.body))
          return Promise.resolve(new Response(JSON.stringify(window.__reponseApi.body), { status: window.__reponseApi.status, headers: { 'content-type': 'application/json' } }))
        }
      }, fs.readFileSync(path.join(process.cwd(), 'outils', 'banc-essai', 'fixtures', 'plan.dxf'), 'utf8'))
      await page.locator('.impl-envoi input').setInputFiles(path.join(process.cwd(), 'outils', 'banc-essai', 'fixtures', 'plan.dwg'))
      await page.waitForTimeout(1500)
      const appelsApi = await page.evaluate(() => window.__appelsApi)
      if (appelsApi.length !== 1) erreurs.push(`DWG : ${appelsApi.length} appel(s) au service (attendu 1)`)
      else if (!/\/storage\/v1\/object\/sign\/plans\/.*\.dwg/.test(appelsApi[0].source) || !/\/storage\/v1\/object\/upload\/sign\/plans\/.*\.dxf/.test(appelsApi[0].destination)) erreurs.push(`DWG : adresses passées au service : ${JSON.stringify(appelsApi[0])}`)
      if (!messages.some((t) => /^DWG converti : 3 entités, 60,0 × 30,0 m/.test(t))) erreurs.push(`DWG : message de conversion absent ou faux : ${JSON.stringify(messages)}`)
      await page.locator('button', { hasText: 'Terminer le déplacement' }).first().click().catch(() => {})
      await page.evaluate(() => { window.__reponseApi = { status: 422, body: { erreur: 'Ce DWG n’a pas pu être lu.' } } })
      await page.locator('.impl-envoi input').setInputFiles(path.join(process.cwd(), 'outils', 'banc-essai', 'fixtures', 'plan.dwg'))
      await page.waitForTimeout(800)
      if (!messages.some((t) => /^Ce DWG n’a pas pu être lu\. Tu peux aussi enregistrer le dessin en DXF/.test(t))) erreurs.push(`DWG refusé : message absent : ${JSON.stringify(messages)}`)
      await page.locator('button', { hasText: 'Terminer le déplacement' }).first().click().catch(() => {})
      // Suppr retire l'objet sélectionné (confirmation acceptée).
      page.once('dialog', (d) => d.accept())
      // Outil Sélection, puis la plus petite emprise (dessinée en dernier, donc atteignable) : la table.
      await page.getByRole('button', { name: /^Sélection/ }).first().click().catch(() => {})
      const emprisesSuppr = page.locator('path.leaflet-interactive[fill]:not([fill="none"])')
      await emprisesSuppr.nth((await emprisesSuppr.count()) - 1).click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
      if ((await page.locator('.impl-props input').first().inputValue().catch(() => null)) !== 'Table pliante') erreurs.push('Suppr : la table n’est pas sélectionnée avant la touche')
      await page.evaluate(() => { window.__appels = [] })
      await page.keyboard.press('Delete')
      await page.waitForTimeout(300)
      const suppr = await page.evaluate(() => (window.__appels ?? []).filter((a) => a.fn === 'supprimer_logiquement'))
      if (suppr.length !== 1 || suppr[0].args?.p_table !== 'elements_plan') erreurs.push(`Suppr : ${JSON.stringify(suppr)} (attendu un appel supprimer_logiquement sur elements_plan)`)
      if (!(Math.abs(apresX - avantX - 100) < 8)) erreurs.push(`glisser du fond : ${(apresX - avantX).toFixed(0)} px (attendu 100)`)
      if (carteAvant !== carteApres) erreurs.push('la carte a bougé pendant le glisser du fond')
    }
  }
  if (ecran === 'gantt-lecture') {
    if (await page.locator('.gantt-svg .gantt-poignee').count()) erreurs.push('poignées visibles en lecture seule')
    if (await page.getByText('Entraîner les suivantes').count()) erreurs.push('interrupteur Entraîner visible en lecture seule')
    if (await page.getByRole('button', { name: '+ Jalon' }).count()) erreurs.push('« + Jalon » visible en lecture seule')
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
