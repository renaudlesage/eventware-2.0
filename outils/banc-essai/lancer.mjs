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

// (162) Le pavé « Parler au QG » de Mon poste : le bouton maintenu et sa consigne 112 ; au premier
// appui, l'écran d'information qui vaut consentement ; mes messages dessous. Pas de bouton flottant.
async function verifierTalkie(page, erreurs) {
  if (await page.locator('.flottant.parler, .flottant.vocaux').count()) erreurs.push('talkie : un bouton flottant subsiste (doit être dans Mon poste)')
  const pave = page.locator('.pave-talkie')
  if (!(await pave.count())) { erreurs.push('talkie : pas de pavé « Parler au QG » dans Mon poste'); return }
  const dispo = await page.evaluate(() => !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia))
  if (!dispo) return
  const parler = pave.locator('.parler-pave')
  if (!(await parler.count())) { erreurs.push('talkie : pas de bouton Parler dans le pavé'); return }
  if (!(await pave.locator('.talkie-112', { hasText: '112' }).count())) erreurs.push('talkie : « appelle le 112 » absent sous le bouton')
  await parler.dispatchEvent('pointerdown', { pointerId: 1 })
  await page.waitForTimeout(200)
  if (!(await page.locator('.talkie-info').count())) erreurs.push('talkie : pas d’écran d’information au premier appui')
  await page.locator('.talkie-info button', { hasText: 'Pas maintenant' }).evaluate((b) => b.click()).catch(() => {})
  await page.waitForTimeout(150)
  if (await page.locator('.talkie-info').count()) erreurs.push('talkie : « Pas maintenant » ne ferme pas l’information')
  if (!(await pave.locator('.mes-messages li, .vide').count())) erreurs.push('talkie : « Mes messages » absent du pavé')
}
fs.mkdirSync(sortie, { recursive: true })
await esbuild.build({
  entryPoints: [path.join(ici, 'ecrans.jsx')],
  bundle: true,
  outfile: path.join(sortie, 'bundle.js'),
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins: [{ name: 'faux-supabase', setup(b) {
    b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: path.join(ici, 'faux-supabase.js') }))
    // (31/10) docx (export Word des Réglages) réclame « buffer » de Node ; le banc n'exporte rien.
    b.onResolve({ filter: /^buffer$/ }, () => ({ path: 'buffer', namespace: 'vide' }))
    b.onLoad({ filter: /.*/, namespace: 'vide' }, () => ({ contents: 'export const Buffer = globalThis.Buffer; export default {}', loader: 'js' }))
  } }],
  define: { 'import.meta.env': '{"PROD":false,"VITE_SUPABASE_URL":"http://localhost","VITE_SUPABASE_ANON_KEY":"k"}', 'process.env.NODE_ENV': '"development"' },
  loader: { '.jsx': 'jsx', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  logLevel: 'error'
})
// La vraie feuille de style : sans elle, une carte dans un conteneur sans
// hauteur (taille 0 × 0) fait tourner Leaflet en boucle au cadrage, et la
// page ne répond plus — ce n'est pas un bogue de l'écran.
fs.writeFileSync(path.join(sortie, 'page.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="../leaflet/dist/leaflet.css"><link rel="stylesheet" href="../../src/styles.css"></head><body><div id="racine"></div><script src="bundle.js"></script></body></html>')
// (31/10) La même page au format téléphone, comme l'application : balise viewport et couche mobile.css.
fs.writeFileSync(path.join(sortie, 'page-tel.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="../leaflet/dist/leaflet.css"><link rel="stylesheet" href="../../src/styles.css"><link rel="stylesheet" href="../../src/mobile.css"></head><body><div id="racine"></div><script src="bundle.js"></script></body></html>')

const demandes = process.argv.slice(2)
const ecrans = demandes.length ? demandes : ['coquille', 'coquille-preparation', 'coquille-montage', 'accueil', 'preparation', 'reglages', 'rh', 'parcours', 'analyse', 'memento', 'securite', 'situation', 'terrain', 'autorite', 'avis', 'participant', 'colonne', 'logistique', 'implantation', 'plan', 'gantt', 'gantt-lecture', 'fournisseurs', 'fournisseurs-lecture', 'demandes-prix', 'demandes-prix-lecture', 'inventaire', 'inventaire-lecture', 'point0']
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
    await page.locator('.rubrique-logistique select').selectOption('prets')
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
    await page.locator('.rubrique-logistique select').selectOption('etiquettes')
    await page.waitForTimeout(300)
    if ((await page.locator('.inv-etiquette-carte svg').count()) !== 3) erreurs.push(`${await page.locator('.inv-etiquette-carte svg').count()} étiquettes (attendu 3)`)
    await page.locator('.rubrique-logistique select').selectOption('scanner')
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
    await page.locator('.rubrique-logistique select').selectOption('prets')
    await page.waitForTimeout(300)
    if (await page.locator('.inv-retour').count()) erreurs.push('Retour visible en lecture')
    if (await page.getByText('Nouveau prêt ou location').count()) erreurs.push('Nouveau prêt visible en lecture')
  }
  // (27/10) Sécurité › Effectifs : les DEA et extincteurs du plan sont comptés (1 et 1 dans le faux plan), « Reprendre » proposé.
  if (ecran === 'securite') {
    // (31/10) Une liste déroulante de rubriques : Opérationnel et Documents en intertitres, plus de rangées de boutons.
    const liste = page.locator('.rubrique-securite select')
    if (!(await liste.count())) erreurs.push('menu : pas de liste déroulante de rubriques')
    else {
      const groupes = await liste.locator('optgroup').evaluateAll((g) => g.map((x) => x.label))
      if (JSON.stringify(groupes) !== JSON.stringify(['Opérationnel', 'Documents'])) erreurs.push(`menu : groupes ${JSON.stringify(groupes)}`)
      if (await page.locator('.groupes-securite, .bloc.dom-grenat > .onglets').count()) erreurs.push('menu : des rangées de boutons restent affichées')
      if ((await liste.inputValue()) !== 'signalements') erreurs.push(`menu : rubrique d'ouverture « ${await liste.inputValue()} » (attendu signalements)`)
      await liste.selectOption('fiches')
      await page.waitForTimeout(300)
      if (await page.locator('.bloc.dom-grenat .meteo-compact').count()) erreurs.push('menu : la veille météo reste affichée sur Documents')
      // (154) Demandes sécurité : le bandeau « Attente » liste la P1 qui attend 22 min ; un clic déplie sa ligne.
      await liste.selectOption('missions')
      await page.waitForTimeout(400)
      const attente = page.locator('.en-souffrance')
      if (!(await attente.count())) erreurs.push('demandes : pas de bandeau « Attente »')
      else {
        await attente.locator('.souffrance-liste button').first().click()
        await page.waitForTimeout(300)
        if (!(await page.locator('.ligne-mission-detail').count())) erreurs.push('demandes : le clic sur la demande en souffrance ne déplie pas sa ligne')
      }
      await liste.selectOption('effectifs')
      await page.waitForTimeout(200)
    }
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
      // (145) Le poteau, plus petit encore, est dessiné en dernier : la table est l'avant-dernière emprise.
      const emprises = page.locator('path.leaflet-interactive[fill]:not([fill="none"])')
      const n = await emprises.count()
      const derniere = emprises.nth(n - 2)
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
    // (145) La guirlande LED (tracé consommateur) : sa fiche propose le raccordement et « Accrocher aux poteaux proches »,
    // qui colle son premier sommet (à 10 cm du poteau) sur le poteau et note le lien « fixé sur ».
    {
      await page.getByRole('button', { name: /^Sélection/ }).first().click().catch(() => {})
      await page.evaluate(() => { window.__ecritures = [] })
      const guirlande = page.locator('path.leaflet-interactive[fill="none"]').filter({ hasNot: page.locator('xpath=self::*[@stroke="#c8102e"]') })
      let trouvee = false
      for (let i = 0; i < await guirlande.count(); i++) {
        await guirlande.nth(i).click({ force: true }).catch(() => {})
        await page.waitForTimeout(250)
        if ((await page.locator('.impl-props input').first().inputValue().catch(() => '')) === 'Guirlande LED (par 10 m)') { trouvee = true; break }
      }
      if (!trouvee) erreurs.push('guirlande : impossible de la sélectionner sur la carte')
      else {
        if (!(await page.getByText('Alimenté par', { exact: false }).count()) && !(await page.locator('.impl-props select[aria-label*="liment"]').count())) erreurs.push('guirlande : pas de raccordement électrique dans sa fiche')
        const accrocher = page.locator('.impl-accrocher')
        if (!(await accrocher.count())) erreurs.push('guirlande : « Accrocher aux poteaux proches » absent')
        else {
          await accrocher.click()
          await page.waitForTimeout(500)
          const ecritures = await page.evaluate(() => window.__ecritures ?? [])
          const lien = ecritures.find((e) => e.table === 'liens_plan' && e.op === 'insert' && e.champs?.nature === 'fixe_sur' && e.champs?.vers_id === 'ep8')
          const maj = ecritures.find((e) => e.table === 'elements_plan' && e.op === 'update' && Array.isArray(e.champs?.geometrie))
          if (!lien) erreurs.push(`guirlande : pas de lien « fixé sur » vers le poteau (${JSON.stringify(ecritures.map((e) => e.table + ':' + e.op))})`)
          if (!maj) erreurs.push('guirlande : le tracé n’est pas réécrit')
          else if (!(Math.abs(maj.champs.geometrie[0][0] - 50.3859) < 1e-9 && Math.abs(maj.champs.geometrie[0][1] - 5.617) < 1e-9)) erreurs.push(`guirlande : premier sommet ${JSON.stringify(maj.champs.geometrie[0])} (attendu collé au poteau 50.3859, 5.617)`)
        }
      }
    }
  }
  // Toutes les cartes dessinent le plan comme la conception : calques à
  // cocher, pictogrammes ; décocher un calque retire ses objets.
  if (ecran === 'plan') {
    // (31/10) Une liste déroulante de rubriques : Concevoir, Bilans, Sur le terrain ; plus de rangées d'onglets.
    const rubrique = page.locator('.rubrique-plan select')
    if (!(await rubrique.count())) erreurs.push('menu : pas de liste déroulante de rubriques')
    else {
      const groupes = await rubrique.locator('optgroup').evaluateAll((g) => g.map((x) => x.label))
      if (JSON.stringify(groupes) !== JSON.stringify(['Concevoir', 'Bilans', 'Sur le terrain'])) erreurs.push(`menu : groupes ${JSON.stringify(groupes)}`)
      if (await page.locator('.bloc.dom-prune > .onglets').count()) erreurs.push('menu : une rangée d’onglets reste affichée')
    }
    const aller = async (v) => { await rubrique.selectOption(v).catch(() => {}); await page.waitForTimeout(400) }
    // (144) Accès secours : l'adresse du PRV est affichée, un accès sans adresse le dit.
    await aller('secours')
    await page.waitForTimeout(300)
    if (!(await page.locator('.secours-adresse', { hasText: 'Rue du Vicinal 12' }).count())) erreurs.push('accès secours : l’adresse du PRV n’est pas affichée')
    if (!(await page.getByText('sans adresse').count())) erreurs.push('accès secours : un accès sans adresse ne le dit pas')
    // (28/10) Bilans › Métré : un tracé compte sa longueur (la barrière 40 m en 12 modules, la voie 60 m), un objet sa surface.
    await aller('b-metre')
    if (await page.locator('.impl-bilans > .onglets').count()) erreurs.push('menu : la rangée d’onglets des bilans reste affichée')
    const longueurs = await page.locator('.bilan-longueur').allTextContents()
    if (!longueurs.some((t) => /^40 m$/.test(t.trim()))) erreurs.push(`métré : longueur de la file de barrières absente (${JSON.stringify(longueurs)})`)
    if (!longueurs.some((t) => /^60 m$/.test(t.trim()))) erreurs.push(`métré : longueur de la voie d’accès secours absente (${JSON.stringify(longueurs)})`)
    if (!(await page.getByText('modules de 3,5 m').count())) erreurs.push('métré : les modules de la barrière ne sont plus indiqués')
    // (28/10) Contrôles : la table dans le PRV se chevauche ; cliquer « Table pliante » ouvre sa fiche dans Conception.
    await aller('b-controles')
    if (!/^Contrôles \(\d+\)$/.test((await rubrique.locator('option[value="b-controles"]').textContent()) ?? '')) erreurs.push('menu : le nombre de contrôles n’apparaît pas dans la liste')
    const objetControle = page.locator('.bilan-objet', { hasText: 'Table pliante' }).first()
    if (!(await objetControle.count())) erreurs.push('contrôles : « Table pliante » n’est pas cliquable')
    // (29/10) Le frigo entièrement dans le PRV est intégré : aucun chevauchement ne le cite.
    if (await page.locator('.prc-ligne', { hasText: 'Frigo' }).count()) erreurs.push('contrôles : un objet entièrement dans une infrastructure est signalé en chevauchement')
    else {
      await objetControle.click()
      await page.waitForTimeout(1200)
      const nomOuvert = await page.locator('.impl-props input').first().inputValue().catch(() => null)
      if (nomOuvert !== 'Table pliante') erreurs.push(`contrôles : la fiche ouverte en Conception est « ${nomOuvert} » (attendu Table pliante)`)
      // (144) La fiche a le champ Adresse et la recherche depuis la position.
      if (!(await page.locator('.impl-adresse').count())) erreurs.push('fiche : champ Adresse absent')
      if (!(await page.locator('.impl-adresse-chercher').count())) erreurs.push('fiche : « Trouver l’adresse depuis la position » absent')
      if ((await rubrique.inputValue()) !== 'conception') erreurs.push('contrôles : la liste ne passe pas sur Conception à l’ouverture d’une fiche')
    }
    await aller('carte')
    await page.waitForTimeout(400)
    // (31/10) La carte s'ouvre sur le point zéro au zoom 18, comme la Conception, pas cadrée sur tous les objets.
    if (!(await page.locator('.leaflet-container[data-cadrage="point0"]').count())) erreurs.push('carte : pas cadrée sur le point zéro')
  }
  if (ecran === 'accueil') await verifierTalkie(page, erreurs)
  if (ecran === 'situation') {
    // (1/11) Mode QG : plein écran, la file « à décider » commence par le SOS reçu (avant la demande P1),
    // la main courante et l'à-venir sont remplis, Échap rend la Situation.
    await page.getByRole('button', { name: /^Mode QG$/ }).click()
    await page.waitForTimeout(800)
    if (!(await page.locator('.mode-qg').count())) erreurs.push('mode QG : pas ouvert')
    else {
      const natures = await page.locator('.qg-file .qg-item .qg-nature').allTextContents()
      if (natures.length < 2) erreurs.push(`mode QG : ${natures.length} élément(s) à décider (attendu au moins le SOS et la demande P1)`)
      if (!/^(SOS|Urgence)/.test(natures[0] ?? '')) erreurs.push(`mode QG : premier à décider « ${natures[0]} » (attendu le SOS reçu ou l’urgence vocale)`)
      if (!(await page.locator('.qg-fil .qg-chrono li', { hasText: 'Alerte météo levée' }).count())) erreurs.push('mode QG : la main courante est vide')
      // (3/11, remarque de Ren) Les messages vocaux sont dans la file à décider : l'urgence en tête, avec Écouter et Entendu.
      const vocalQg = page.locator('.qg-item.genre-vocal')
      if (!(await vocalQg.count())) erreurs.push('mode QG : aucun message vocal dans la file à décider')
      else {
        const t = await vocalQg.first().textContent()
        if (!/Urgence · Message vocal de Ren/.test(t) || !/blessé à l’étape 2/.test(t)) erreurs.push('mode QG : le message vocal urgent n’est pas en tête avec sa transcription')
        if (!(await vocalQg.first().getByRole('button', { name: /Écouter/ }).count()) || !(await vocalQg.first().getByRole('button', { name: 'Entendu' }).count())) erreurs.push('mode QG : Écouter ou Entendu manquent sur le message vocal')
        if (!/refusé le micro/.test(await page.locator('.qg-item.genre-vocal', { hasText: 'audio —' }).textContent().catch(() => ''))) erreurs.push('mode QG : le message muet ne dit pas pourquoi')
      }
      if (!(await page.locator('.qg-avenir .qg-chrono li', { hasText: 'TRA-001' }).count())) erreurs.push('mode QG : le transport manque dans « À venir »')
      if (!(await page.locator('.qg-carte .leaflet-container').count())) erreurs.push('mode QG : pas de carte')
      if (!(await page.locator('.qg-chiffre', { hasText: 'SOS à traiter' }).count())) erreurs.push('mode QG : les chiffres de tête manquent')
      // (1/11) Entrer en mode QG allume le son et demande la veille (acquise ou refusée selon le navigateur).
      if (!(await page.locator('.qg-etat.actif', { hasText: 'Son' }).count())) erreurs.push('mode QG : l’alarme sonore n’est pas allumée à l’entrée')
      if (!(await page.locator('.qg-etat', { hasText: 'Veille' }).count())) erreurs.push('mode QG : pas de bouton de veille')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      if (await page.locator('.mode-qg').count()) erreurs.push('mode QG : Échap ne quitte pas')
      if (!(await page.getByRole('button', { name: /Son OFF/ }).count())) erreurs.push('mode QG : en sortant, le son ne revient pas à son état d’avant')
    }
    // (162) Le fil « Entendu » : l'urgence d'abord, « 1 à entendre » ; Entendu envoie la mise à jour.
    const fil = page.locator('.fil-entendu')
    if (!(await fil.count())) erreurs.push('entendu : pas de fil des messages vocaux')
    else {
      if (!/1 à entendre/.test(await fil.textContent())) erreurs.push('entendu : « 1 à entendre » absent')
      const premier = fil.locator('.message-vocal').first()
      if (!(await premier.locator('.prc-jeton.chaud', { hasText: 'urgence' }).count())) erreurs.push('entendu : l’urgence n’est pas en tête')
      if (!/blessé à l’étape 2/.test(await premier.locator('.vocal-transcription').inputValue().catch(() => ''))) erreurs.push('entendu : la transcription manque')
      if (!(await premier.locator('button', { hasText: 'Écouter' }).count())) erreurs.push('entendu : pas de lecteur audio')
      await page.evaluate(() => { window.__ecritures = [] })
      await premier.getByRole('button', { name: 'Entendu' }).click()
      await page.waitForTimeout(300)
      if (!(await page.evaluate(() => (window.__ecritures ?? []).some((e) => e.table === 'messages_vocaux' && e.op === 'update' && e.champs?.statut === 'entendu' && e.champs?.entendu_le)))) erreurs.push('entendu : le bouton n’envoie pas l’accusé')
      if (!(await premier.getByRole('button', { name: '→ Demande' }).count())) erreurs.push('entendu : « → Demande » absent')
      // (166) Le message sans transcription dit pourquoi ; Supprimer appelle la fonction serveur après confirmation.
      const sans = fil.locator('.message-vocal', { hasText: 'refusé le micro à la reconnaissance' }).first()
      if (!(await sans.count())) erreurs.push('entendu : le message sans transcription n’affiche pas le motif')
      else {
        // (transcription serveur) Transcrire appelle l'Edge Function pour ce message.
        await page.evaluate(() => { window.__appels = [] })
        await sans.getByRole('button', { name: 'Transcrire' }).evaluate((b) => b.click())
        await page.waitForTimeout(300)
        if (!(await page.evaluate(() => (window.__appels ?? []).some((a) => a.fn === 'transcrire-vocal' && a.args?.message_id === 'mv3')))) erreurs.push('entendu : Transcrire n’appelle pas la fonction de transcription')
        await page.evaluate(() => { window.__appels = []; window.confirm = () => true })
        await sans.getByRole('button', { name: 'Supprimer' }).evaluate((b) => b.click())
        await page.waitForTimeout(300)
        if (!(await page.evaluate(() => (window.__appels ?? []).some((a) => a.fn === 'supprimer_message_vocal' && a.args?.p_message === 'mv3')))) erreurs.push('entendu : Supprimer n’appelle pas la fonction serveur')
      }
    }
    // (158) Le message d'urgence de la commune reste en bandeau ; « Bien reçu » n'apparaît que connecté (le banc ne l'est pas).
    const commune = page.locator('.message-commune.niv-urgence')
    if (!(await commune.count())) erreurs.push('commune : pas de bandeau pour le message d’urgence')
    else {
      const t = await commune.textContent()
      if (!/Évacuation partielle du camping/.test(t) || !/Rassembler les campeurs/.test(t)) erreurs.push('commune : titre ou consigne absents du bandeau')
      if (!/inondation \(communale\)/.test(t)) erreurs.push('commune : incident absent du bandeau')
    }
    // (154) Le bandeau « Attente » : la P1 qui attend 22 min (seuil appris 15) est signalée en urgence.
    const attente = page.locator('.en-souffrance')
    if (!(await attente.count())) erreurs.push('en souffrance : pas de bandeau « Attente »')
    else {
      const texte = await attente.textContent()
      if (!/1 demande attend plus que d.habitude/.test(texte)) erreurs.push(`en souffrance : titre « ${texte.slice(0, 60)} »`)
      if (!/SEC-001.*22 min.*moins de 15 min/.test(texte)) erreurs.push('en souffrance : la P1 SEC-001 (22 min, seuil 15) manque')
      if (!(await attente.evaluate((e) => e.classList.contains('niv-urgence')))) erreurs.push('en souffrance : une P1 doit passer le bandeau en urgence')
    }
    const deplier = page.getByRole('button', { name: /^Déplier$/ })
    if (await deplier.count()) await deplier.first().click()
    else erreurs.push('bouton Déplier absent sous 1440 px')
    await page.waitForTimeout(1500)
    // (1/11) Déplié, le bloc contient sa carte : il ne déborde pas sur ce qui suit.
    const debord = await page.evaluate(() => {
      const s = document.querySelector('.tactique-repliee'); const c = document.querySelector('.tactique-contenu')
      return s && c ? Math.round(c.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom) : 0
    })
    if (debord > 0) erreurs.push(`carte tactique dépliée : déborde de ${debord} px sous son bloc`)
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
    // (146) Le groupe Sécurité (gt1) est sarcelle : ses barres sont remplies de sa couleur, classe « teinte », contour par statut ; la légende le nomme.
    const teinte = await page.evaluate(() => {
      const g = [...document.querySelectorAll('.gantt-svg:not(.gantt-svg-colonne) .gantt-jalon')].find((x) => x.dataset.code?.startsWith('GJ-01'))
      const r = g?.querySelector('.gantt-barre')
      const b = [...document.querySelectorAll('.gantt-svg:not(.gantt-svg-colonne) .gantt-jalon')].find((x) => x.dataset.code?.startsWith('GJ-03'))?.querySelector('.gantt-barre')
      return g && r ? { classe: g.getAttribute('class'), fill: getComputedStyle(r).fill, autre: b ? getComputedStyle(b).fill : null } : null
    })
    if (!teinte) erreurs.push('couleurs : GJ-01 introuvable')
    else {
      if (!/\bteinte\b/.test(teinte.classe)) erreurs.push(`couleurs : GJ-01 n’a pas la classe teinte (${teinte.classe})`)
      if (teinte.fill !== 'rgb(42, 157, 143)') erreurs.push(`couleurs : remplissage de GJ-01 ${teinte.fill} (attendu rgb(42, 157, 143), la couleur du groupe Sécurité)`)
      if (teinte.autre === 'rgb(42, 157, 143)') erreurs.push('couleurs : GJ-03 (groupe Logistique, sans couleur) est teinté à tort')
    }
    if (!(await page.locator('.gantt-legende-groupes', { hasText: 'Sécurité' }).count())) erreurs.push('couleurs : la légende ne nomme pas le groupe coloré')
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
    if (await page.locator('.gantt-ajout select[aria-label=Groupe] option').count() !== 3) erreurs.push('ajout : les deux groupes de travail du faux événement ne sont pas proposés')
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
    else if (!(await page.locator('.fiche-jalon .palette').count())) erreurs.push('la fiche n’a pas la palette de couleur')
    else {
      // (29/10) Une pastille ; la grille des douze teintes s'ouvre au clic et se referme sur Échap.
      if (await page.locator('.fiche-jalon .palette-menu').count()) erreurs.push('palette : la grille est ouverte d’office')
      await page.locator('.fiche-jalon .palette-bouton').first().click()
      await page.waitForTimeout(150)
      const cases = await page.locator('.fiche-jalon .palette-menu .palette-case').count()
      if (cases !== 12) erreurs.push(`palette : ${cases} teintes dans la grille (attendu 12)`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
      if (await page.locator('.fiche-jalon .palette-menu').count()) erreurs.push('palette : Échap ne referme pas la grille')
    }
  }
  // (29/10) Demandes : la nouvelle demande a ses catégories ; le lieu se cherche par son nom, sans code.
  if (ecran === 'logistique') {
    // (31/10) Une seule liste déroulante : trois groupes (Exploitation, Matériel, Achats), treize rubriques, plus de rangées de boutons.
    // (voir aussi le pas « coquille-… » plus haut pour les cadrans par phase)
    const liste = page.locator('.rubrique-logistique select')
    if (!(await liste.count())) erreurs.push('menu : pas de liste déroulante de rubriques')
    else {
      const groupes = await liste.locator('optgroup').evaluateAll((g) => g.map((x) => x.label))
      if (JSON.stringify(groupes) !== JSON.stringify(['Exploitation', 'Matériel', 'Achats'])) erreurs.push(`menu : groupes ${JSON.stringify(groupes)}`)
      const n = await liste.locator('option').count()
      if (n !== 13) erreurs.push(`menu : ${n} rubriques (attendu 13, dont les quatre vues de l’inventaire)`)
      if (await page.locator('.bloc.dom-bronze > .onglets, .groupes-logistique').count()) erreurs.push('menu : des rangées de boutons restent affichées')
      await liste.selectOption('fournisseurs')
      await page.waitForTimeout(400)
      if (await page.getByRole('button', { name: /Nouvelle demande/ }).count()) erreurs.push('menu : choisir « Fournisseurs » laisse les demandes affichées')
      await liste.selectOption('interventions')
      await page.waitForTimeout(300)
    }
    await page.getByRole('button', { name: /Nouvelle demande/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    const categories = await page.locator('#type-normale option').count()
    if (categories < 3) erreurs.push(`demande : ${categories} option(s) de catégorie (attendu les deux de la fixture + le choix vide)`)
    const champ = page.locator('#lieu-normale')
    if (!(await champ.count())) erreurs.push('demande : pas de champ de recherche de lieu')
    else {
      if (await page.locator('.choix-lieu-option', { hasText: 'E1 ·' }).count()) erreurs.push('demande : le code du lieu est affiché')
      await champ.fill('éta')
      await page.waitForTimeout(150)
      const options = page.locator('.choix-lieu-option')
      if ((await options.count()) !== 1) erreurs.push(`demande : ${await options.count()} lieu(x) pour « éta » (attendu 1 : Étape 1)`)
      await options.first().click()
      await page.waitForTimeout(150)
      if (!(await page.locator('.choix-lieu-choisi', { hasText: 'Étape 1' }).count())) erreurs.push('demande : le lieu cliqué n’est pas retenu')
    }
    await page.getByRole('button', { name: /^Annuler$/ }).first().click().catch(() => {})
  }
  // (130) L'annuaire : trois fournisseurs, le filtre par catégorie, la fiche avec ses contacts.
  if (ecran === 'fournisseurs') {
    const n = await page.locator('.four-carte').count()
    if (n !== 4) erreurs.push(`${n} fournisseurs (attendu 4)`)
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
    // (1/11) Un fournisseur sans catégorie est proposé dans une demande « Barriérage ».
    if (!(await page.locator('.dp-ajout-consultation option', { hasText: 'Généraliste SA' }).count())) erreurs.push('consultation : un fournisseur sans catégorie n’est pas proposé')
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
      // La fiche ouverte plus haut peut avoir fait défiler la page : la poignée revient dans la fenêtre d'abord.
      await poignee.scrollIntoViewIfNeeded()
      const avant = await page.locator('.impl-catalogue').evaluate((el) => el.getBoundingClientRect().width)
      const b = await poignee.boundingBox()
      await page.mouse.move(b.x + b.width / 2, b.y + Math.min(40, b.height / 2))
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
      // (29/10) Le fournisseur d'un objet se choisit dans l'annuaire (trois fournisseurs) ; « Autre » ouvre la saisie libre.
      {
        await page.getByRole('button', { name: /^Sélection/ }).first().click().catch(() => {})
        await page.locator('.impl-picto').first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(300)
        const choix = page.locator('.impl-props select.impl-fournisseur')
        if (!(await choix.count())) erreurs.push('fournisseur : pas de liste tirée de l’annuaire dans la fiche')
        else {
          const n = await choix.locator('option').count()
          // (1/11) Quatre depuis que « Généraliste SA » (f4) est dans l'annuaire.
          if (n !== 6) erreurs.push(`fournisseur : ${n} options (attendu 6 : aucun, quatre fournisseurs, autre)`)
          await page.evaluate(() => { window.__ecritures = [] })
          await choix.selectOption('Clôtures Dupont')
          await page.waitForTimeout(200)
          const maj = (await page.evaluate(() => window.__ecritures ?? [])).find((e) => e.table === 'elements_plan' && e.op === 'update' && e.champs?.fournisseur === 'Clôtures Dupont')
          if (!maj) erreurs.push('fournisseur : le choix dans la liste n’est pas enregistré')
          await choix.selectOption('__autre')
          await page.waitForTimeout(150)
          if (!(await page.locator('.impl-props input[placeholder="Loueur, prestataire…"]').count())) erreurs.push('fournisseur : « Autre » n’ouvre pas la saisie libre')
        }
      }
      // (29/10) Une voie d'accès secours se trace comme un câble : la fiche du catalogue, le PRV, puis l'accès secours.
      {
        await page.locator('.impl-fiche', { hasText: 'Voie d’accès secours' }).first().click().catch(() => {})
        await page.waitForTimeout(200)
        if (!(await page.getByText(/Clique le point de rencontre \(PRV\) de départ/).count())) erreurs.push('voie : la consigne de tracé ne demande pas le PRV de départ')
        await page.evaluate(() => { window.__ecritures = [] })
        await page.locator('.impl-picto.picto-prv').first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(200)
        await page.locator('.impl-picto.picto-acces_secours').first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(500)
        const ecritures = await page.evaluate(() => window.__ecritures ?? [])
        const voie = ecritures.find((e) => e.table === 'elements_plan' && e.op === 'insert' && e.champs?.categorie === 'voie_engins')
        if (!voie) erreurs.push(`voie : aucune voie posée après le clic sur le PRV puis sur l'accès (${JSON.stringify(ecritures.map((e) => e.table + ':' + e.op))})`)
        else if (voie.champs.de_id !== 'ep11' || voie.champs.vers_id !== 'ep12') erreurs.push(`voie : bouts ${voie.champs.de_id} → ${voie.champs.vers_id} (attendu ep11 → ep12)`)
        await page.keyboard.press('Escape').catch(() => {})
      }
      // Suppr retire l'objet sélectionné (confirmation acceptée).
      page.once('dialog', (d) => d.accept())
      // Outil Sélection, puis la plus petite emprise (dessinée en dernier, donc atteignable) : la table.
      await page.getByRole('button', { name: /^Sélection/ }).first().click().catch(() => {})
      const emprisesSuppr = page.locator('path.leaflet-interactive[fill]:not([fill="none"])')
      await emprisesSuppr.nth((await emprisesSuppr.count()) - 2).click({ force: true }).catch(() => {})
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
  // (147) La carte de l'autorité : à tuiles, avec le choix du fond et le plein
  // écran comme les autres cartes, le plan dessiné par couchesPlan ; le dessin
  // vectoriel reste disponible en repli. Tous les PRV en tête de page, avec
  // leur adresse ; le schéma unifilaire dans le dossier.
  if (ecran === 'avis') {
    // (159) La page d'avis : le dossier figé, l'avis déjà rendu par D3, le formulaire de D1 avec ses prescriptions.
    const t = await page.locator('.avis-dossier').textContent().catch(() => '')
    if (!/Rando VTT 2026/.test(t) || !/version 1/.test(t)) erreurs.push('avis : en-tête du dossier absent')
    if (!/Jean Dupont/.test(t) || !/Ethias/.test(t)) erreurs.push('avis : organisateur ou assurance absents')
    if (!/H1/.test(t) || !/Extincteur par stand/.test(t)) erreurs.push('avis : prescription applicable absente')
    if (!/D3 — Police/.test(t) || !/Favorable/.test(t)) erreurs.push('avis : l’avis déjà rendu par D3 est absent')
    if ((await page.getByRole('radio').count()) !== 3) erreurs.push(`avis : ${await page.getByRole('radio').count()} choix d’avis (attendu 3)`)
    await page.getByRole('button', { name: '+ Prescription' }).click()
    await page.waitForTimeout(100)
    if (!(await page.locator('.prescription-ligne input').count())) erreurs.push('avis : + Prescription n’ajoute pas de ligne')
    if (!(await page.getByRole('button', { name: "Rendre l'avis" }).count())) erreurs.push('avis : bouton « Rendre l’avis » absent')
  }
  if (ecran === 'autorite') {
    if (!(await page.locator('.calques-carte').count())) erreurs.push('filtre des calques absent')
    if (!(await page.locator('.carte-autorite .leaflet-container').count())) erreurs.push('carte à tuiles absente')
    if (!(await page.locator('.carte-autorite select.carte-fond').count())) erreurs.push('choix du fond de carte absent')
    if (!(await page.locator('.carte-autorite .impl-picto').count())) erreurs.push('pictogrammes du plan absents de la carte à tuiles')
    if (!(await page.locator('.carte-autorite .leaflet-tooltip', { hasText: 'SOS-001' }).count())) erreurs.push('intervention absente de la carte à tuiles')
    // (29/10) Un accès posé en pictogramme n'a pas de libellé permanent ; un accès sans picto en garde un.
    if (await page.locator('.carte-autorite .leaflet-tooltip', { hasText: 'PRV nord' }).count()) erreurs.push('libellé permanent en double sur un accès posé en pictogramme')
    if (!(await page.locator('.carte-autorite .leaflet-tooltip', { hasText: 'Accès secours' }).count())) erreurs.push('libellé absent sur un accès sans pictogramme')
    await page.locator('.carte-autorite .carte-plein-bouton').last().click().catch(() => {})
    await page.waitForTimeout(300)
    if (!(await page.locator('.carte-autorite.carte-plein').count())) erreurs.push('plein écran de la carte inopérant')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (await page.locator('.carte-autorite.carte-plein').count()) erreurs.push('Échap ne quitte pas le plein écran')
    await page.getByRole('tab', { name: 'Dessin hors ligne' }).click().catch(() => {})
    await page.waitForTimeout(300)
    if (!(await page.locator('.carte-svg').count())) erreurs.push('dessin hors ligne absent')
    if (!(await page.locator('.carte-svg .carte-picto').count())) erreurs.push('pictogrammes du plan absents du dessin hors ligne')
    await page.getByRole('tab', { name: 'Carte', exact: true }).click().catch(() => {})
    await page.waitForTimeout(200)
    const prv = await page.locator('.interlocuteurs .carte-prv').count()
    if (prv !== 2) erreurs.push(`points de rencontre en tête : ${prv} au lieu de 2`)
    if (!(await page.locator('.interlocuteurs .secours-adresse', { hasText: 'Rue du Vicinal 12' }).count())) erreurs.push('adresse du PRV absente en tête')
    await page.locator('.rubrique-autorite select').selectOption('dossier').catch(() => {})
    await page.waitForTimeout(400)
    if (!(await page.locator('.bloc-unifilaire .unifilaire svg').count())) erreurs.push('schéma unifilaire absent du dossier')
    if (!(await page.locator('.bloc-unifilaire .unifilaire svg text', { hasText: 'Coffret scène' }).count())) erreurs.push('le coffret manque sur l’unifilaire')
  }
  const texte = (await page.locator('#racine').innerText().catch(() => '')).replace(/\s+/g, ' ')
  if (!texte.trim()) erreurs.push('rien de rendu')
  if (erreurs.length) echecs++
  console.log(`${erreurs.length ? '✗' : '✓'} ${ecran}${erreurs.length ? '\n    ' + erreurs.join('\n    ') : ' — ' + texte.slice(0, 90)}`)
  await page.close()
}
// (31/10, audit d'ergonomie) Passe téléphone, 390 × 844 : aucun écran ne glisse de côté, aucun champ
// éditable sous 16 px (l'iPhone zoomerait à la mise au point).
for (const ecran of ecrans) {
  const page = await navigateur.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.on('pageerror', () => {})
  await page.goto('file://' + path.join(sortie, 'page-tel.html') + '?ecran=' + ecran, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const m = await page.evaluate(() => ({
    largeur: document.documentElement.scrollWidth,
    petits: [...document.querySelectorAll('#racine input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), #racine select, #racine textarea')]
      .filter((el) => el.offsetParent && !el.disabled && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className} ${getComputedStyle(el).fontSize}`)
  }))
  const erreurs = []
  if (m.largeur > 392) erreurs.push(`la page fait ${m.largeur} px de large sur un téléphone de 390 px`)
  // (1/11) Les cadrans suivent la phase : en préparation, pas de « Présents » ni de « Missions en cours ».
  if (ecran === 'coquille-preparation' || ecran === 'coquille-montage') {
    const libelles = await page.locator('.bandeau-etat .cadran-libelle').allTextContents()
    const attendus = ecran === 'coquille-preparation'
      ? ['Retards jalon', 'Jalons sous 7 jours', 'Demandes de prix ouvertes', 'Postes découverts']
      : ['Retards jalon', 'À confirmer sur site', 'Charge des lieux', 'Postes découverts']
    for (const a of attendus) if (!libelles.some((l) => l.startsWith(a))) erreurs.push(`cadrans (${ecran}) : « ${a} » absent (${JSON.stringify(libelles)})`)
    if (libelles.some((l) => /^Présents/.test(l))) erreurs.push(`cadrans (${ecran}) : « Présents » affiché hors exploitation`)
    const valeurs = await page.locator('.bandeau-etat .cadran-valeur').allTextContents()
    if (valeurs.some((v) => v === '…')) erreurs.push(`cadrans (${ecran}) : une valeur reste en attente (${JSON.stringify(valeurs)})`)
    // (1/11) Un lieu au niveau 3 dans la fixture : le cadran de charge est chaud et dit « en surcharge ».
    if (ecran === 'coquille-montage' && !(await page.locator('.bandeau-etat .cadran.chaud .cadran-libelle', { hasText: 'en surcharge' }).count())) erreurs.push('cadrans : la charge des lieux n’est pas signalée chaude')
  }
  // (1/11) Une demande de prix s'édite aussi au téléphone : la fiche ouverte propose l'ajout de ligne.
  if (ecran === 'demandes-prix') {
    await page.locator('.dp-liste tr[data-reference="DP-01"]').click().catch(() => {})
    await page.waitForTimeout(500)
    if (!(await page.locator('.dp-fiche .dp-ajout-ligne').count())) erreurs.push('demande de prix : pas d’ajout de ligne sur un écran étroit')
    if (!(await page.getByRole('button', { name: /Enregistrer l'en-tête/ }).count())) erreurs.push('demande de prix : en-tête non modifiable sur un écran étroit')
  }
  if (ecran === 'situation') {
    await page.getByRole('button', { name: /^Déplier$/ }).first().click().catch(() => {})
    await page.waitForTimeout(1200)
    const debord = await page.evaluate(() => {
      const s = document.querySelector('.tactique-repliee'); const c = document.querySelector('.tactique-contenu')
      return s && c ? Math.round(c.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom) : 0
    })
    if (debord > 0) erreurs.push(`carte tactique dépliée : déborde de ${debord} px sous son bloc au téléphone`)
  }
  // (152) Préparation : les jalons rangés par phase — « Commande chapiteau » (daté en montage) est forcé en préparation.
  if (ecran === 'preparation') {
    const titres = await page.locator('.phase-titre').allTextContents()
    if (!titres.some((t) => /^Préparation \(2\)/.test(t))) erreurs.push(`jalons par phase : « Préparation (2) » absent (${JSON.stringify(titres)})`)
    if (!titres.some((t) => /^Montage \(1\)/.test(t))) erreurs.push(`jalons par phase : « Montage (1) » absent (${JSON.stringify(titres)})`)
    const phases = page.locator('.fiche-jalon-phase')
    if (!(await phases.count())) erreurs.push('fiche du jalon : pas de choix de phase')
    else if (!/déduite : Préparation/.test(await phases.first().locator('option').first().textContent())) erreurs.push('fiche du jalon : la phase déduite n’est pas affichée')
  }
  // (2/11, remarque de Ren) Mémento › Contacts : les responsables du profil de sécurité de l'organisation y figurent.
  if (ecran === 'memento') {
    await page.getByRole('button', { name: /^Contacts/ }).click()
    await page.waitForTimeout(200)
    const t = await page.locator('.memento').textContent().catch(() => '')
    if (!/Jean Dupont/.test(t) || !/Responsable légal/.test(t) || !/profil de sécurité de l’organisation/.test(t)) erreurs.push('mémento : le responsable légal du profil d’organisation n’est pas dans les contacts')
    if (!/Bucolique Ferrières/.test(t)) erreurs.push('mémento : l’organisation du responsable n’est pas affichée')
  }
  // (167) Analyse : les familles de demandes et la mémoire des lieux en synthèse ; en constats, le bouton « Proposer » appelle rex_proposer, le jeton et le filtre.
  if (ecran === 'analyse') {
    const synthese = await page.locator('.securite').textContent().catch(() => '')
    if (!/Ce qui revient/.test(synthese) || !/Réassort boissons/.test(synthese) || !/28 min/.test(synthese)) erreurs.push('analyse : les familles de demandes manquent en synthèse')
    if (!(await page.locator('.familles-demande .prc-jeton', { hasText: 'ronde' }).count())) erreurs.push('analyse : la famille boissons n’est pas marquée « ronde »')
    if (!(await page.locator('.memoire-lieu', { hasText: 'Étape 1' }).count()) || !/11 demandes/.test(synthese) || !/réassort boissons ×9/.test(synthese)) erreurs.push('analyse : la mémoire des lieux manque')
    await page.getByRole('button', { name: /Rattacher les demandes sans lieu/ }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /^Constats$/ }).click()
    await page.waitForTimeout(300)
    if ((await page.locator('.carte.rex-auto').count()) !== 1 || !(await page.locator('.carte .prc-jeton', { hasText: 'proposé par Eventware' }).count())) erreurs.push('analyse : le constat proposé par Eventware n’est pas marqué')
    await page.getByRole('button', { name: /Proposer les constats d’Eventware/ }).click()
    await page.waitForTimeout(300)
    const appels = await page.evaluate(() => (window.__appels ?? []).map((a) => a.fn))
    if (!appels.includes('rex_proposer')) erreurs.push('analyse : « Proposer » n’appelle pas rex_proposer')
    if (!appels.includes('rattacher_demandes_lieux')) erreurs.push('analyse : « Rattacher » n’appelle pas rattacher_demandes_lieux')
    if (!(await page.locator('.rex-filtre .module.actif', { hasText: 'Proposés par Eventware (1)' }).count())) erreurs.push('analyse : après « Proposer », le filtre Eventware n’est pas actif')
    if ((await page.locator('.carte').count()) !== 1) erreurs.push(`analyse : filtre Eventware → ${await page.locator('.carte').count()} carte(s) (attendu 1)`)
    await page.locator('.rex-filtre .module', { hasText: 'Consignés (1)' }).click()
    await page.waitForTimeout(200)
    if (!(await page.locator('.carte', { hasText: 'briefing du matin' }).count())) erreurs.push('analyse : le filtre « Consignés » ne montre pas le constat humain')
  }
  // (152) Réglages : la phase suggérée par les dates, avec le passage en un clic.
  if (ecran === 'reglages') {
    const sug = await page.locator('.phase-suggeree').textContent().catch(() => '')
    if (!/Phase suggérée par les dates/.test(sug)) erreurs.push(`réglages : pas de phase suggérée (${sug.slice(0, 60)})`)
    // (157) Rubrique Dossier de sécurité : statut, deux bloquants qui retiennent le dépôt, la version figée.
    // (167) Réglages › Données : l'édition précédente se choisit et « Rapprocher les lieux » appelle rapprocher_lieux.
    await page.locator('.rubrique-reglages select').selectOption('donnees')
    await page.waitForTimeout(400)
    const edition = page.locator('.edition-precedente')
    if (!(await edition.count())) erreurs.push('réglages : pas de bloc « Édition précédente »')
    else {
      await edition.locator('select').selectOption('ev0')
      await edition.getByRole('button', { name: /Rapprocher les lieux/ }).click()
      await page.waitForTimeout(200)
      const appels = await page.evaluate(() => (window.__appels ?? []).filter((a) => a.fn === 'rapprocher_lieux'))
      if (!appels.length || appels[0].args?.p_source !== 'ev0') erreurs.push('réglages : « Rapprocher les lieux » n’appelle pas rapprocher_lieux avec l’édition choisie')
    }
    await page.locator('.rubrique-reglages select').selectOption('dossier')
    await page.waitForTimeout(400)
    const dossier = page.locator('.dossier-securite')
    if (!(await dossier.count())) erreurs.push('dossier : pas d’écran')
    else {
      const t = await dossier.textContent()
      if (!/Déposé/.test(t) || !/version 1/.test(t)) erreurs.push('dossier : statut « Déposé » ou « version 1 » absent')
      if (!/2 points bloquants/.test(t)) erreurs.push('dossier : « 2 points bloquants » absent')
      if ((await dossier.locator('li.controle-bloquant').count()) !== 2) erreurs.push('dossier : les deux bloquants ne sont pas listés')
      const bouton = dossier.getByRole('button', { name: /^Déposer/ })
      if (!(await bouton.count())) erreurs.push('dossier : pas de bouton Déposer')
      else if (!(await bouton.isDisabled())) erreurs.push('dossier : Déposer devrait être désactivé tant qu’un bloquant subsiste')
      if (!(await dossier.locator('.dossier-versions li', { hasText: 'Version 1' }).count())) erreurs.push('dossier : la version 1 n’est pas listée')
      // (étape 6) Le PDF de la version 1 se télécharge.
      const [telechargement] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
        dossier.getByRole('button', { name: /Télécharger le PDF \(version 1\)/ }).click()
      ])
      if (!telechargement) erreurs.push('dossier : le PDF ne se télécharge pas')
      else {
        if (!/^Dossier-securite-.*-v1\.pdf$/.test(telechargement.suggestedFilename())) erreurs.push(`dossier : nom du PDF « ${telechargement.suggestedFilename()} »`)
        const chemin = path.join(sortie, 'dossier-v1.pdf')
        await telechargement.saveAs(chemin)
        const octets = fs.readFileSync(chemin)
        if (octets.length < 2000 || octets.subarray(0, 5).toString() !== '%PDF-') erreurs.push('dossier : le fichier téléchargé n’est pas un PDF')
      }
      // (164) La grille PRIMA : zone ÉLEVÉ, score 34,17, niveau 4, provenances ; un choix de densité part en upsert ; le détail du calcul s'ouvre.
      const prima = dossier.locator('.prima')
      const tp = await prima.textContent().catch(() => '')
      if (!/Élevé — avis CoAMU demandé/.test(tp) || !/score 34\.17/.test(tp) || !/niveau 4 : Poste de soins médicalisé/.test(tp)) erreurs.push('prima : zone, score ou niveau absents')
      if (!(await prima.locator('.prima-source', { hasText: 'Eventware' }).count()) || !(await prima.locator('.prima-source', { hasText: 'par défaut' }).count())) erreurs.push('prima : provenances Eventware / par défaut absentes')
      if (!/À confirmer : la durée/.test(tp)) erreurs.push('prima : « à confirmer » absent')
      await page.evaluate(() => { window.__ecritures = [] })
      await prima.locator('tr', { hasText: 'Densité maximale' }).locator('select').selectOption('4')
      await page.waitForTimeout(200)
      if (!(await page.evaluate(() => (window.__ecritures ?? []).some((e) => e.table === 'prima_saisies' && e.op === 'upsert' && e.champs?.densite === 4)))) erreurs.push('prima : choisir une densité n’envoie pas la saisie')
      await prima.getByRole('button', { name: 'Détail du calcul' }).evaluate((b) => b.click())
      await page.waitForTimeout(100)
      if (!/888/.test(await prima.locator('.prima-detail').textContent().catch(() => ''))) erreurs.push('prima : le détail du calcul ne montre pas le scoring')
      // (163) Le formulaire communal : le compteur, les sections où il manque une obligatoire ouvertes, le pré-rempli signalé,
      // une saisie qui part en upsert, un retour au pré-rempli qui efface.
      const formulaire = dossier.locator('.formulaire-communal')
      if (!(await formulaire.count())) erreurs.push('formulaire : pas de bloc')
      else {
        const t = await formulaire.textContent()
        if (!/5 \/ 8/.test(t) || !/2 obligatoires sans réponse/.test(t)) erreurs.push('formulaire : compteur ou obligatoires manquantes absents')
        if (!/commune de Ferrières/.test(t) || !/60 jours avant la mise en place/.test(t) || !/manifestations@ferrieres.be/.test(t)) erreurs.push('formulaire : en-tête (libellé, délai, adresse d’envoi) incomplet')
        if ((await formulaire.locator('.formulaire-choix button').count()) !== 2) erreurs.push('formulaire : les deux formulaires applicables ne sont pas proposés')
        const ouvertes = await formulaire.locator('.formulaire-section.ouverte').count()
        if (ouvertes !== 2) erreurs.push(`formulaire : ${ouvertes} sections ouvertes d’office (attendu 2 : celles où une obligatoire manque)`)
        if (!(await formulaire.locator('.formulaire-prerempli').count())) erreurs.push('formulaire : aucun « pré-rempli par Eventware »')
        if (!(await formulaire.locator('tr.manquante', { hasText: '1.04' }).count())) erreurs.push('formulaire : 1.04 n’est pas marquée manquante')
        await page.evaluate(() => { window.__ecritures = [] })
        await formulaire.locator('tr', { hasText: '1.04' }).locator('select').selectOption('Domaine public')
        await page.waitForTimeout(300)
        if (!(await page.evaluate(() => (window.__ecritures ?? []).some((e) => e.table === 'formulaire_reponses' && e.op === 'upsert' && e.champs?.formulaire_id === 'f1' && e.champs?.code === '1.04' && e.champs?.valeur === 'Domaine public')))) erreurs.push('formulaire : choisir une option n’envoie pas la réponse (avec le formulaire)')
        // La section 3 est repliée : on l'ouvre pour trouver la saisie 3.01 et son retour au pré-rempli.
        await formulaire.locator('.formulaire-section-titre', { hasText: '3. Données sur le public' }).click()
        const retour = formulaire.locator('tr', { hasText: '3.01' }).getByRole('button', { name: /revenir au pré-rempli/ })
        if (!(await retour.count())) erreurs.push('formulaire : la saisie 3.01 n’offre pas le retour au pré-rempli')
        else {
          await page.evaluate(() => { window.__appels = [] })
          await retour.evaluate((b) => b.click())
          await page.waitForTimeout(300)
          const r = await page.evaluate(() => (window.__appels ?? []).some((a) => a.fn === 'formulaire_dossier'))
          if (!r) erreurs.push('formulaire : le retour au pré-rempli ne recharge pas le formulaire')
        }
      }
      // (165) La notification DMP : prête, date limite, destinataires ; le formulaire s'ouvre, pré-rempli ; une saisie part en upsert ; le PDF se télécharge.
      const notif = dossier.locator('.notification-dmp')
      const tn = await notif.textContent().catch(() => '')
      if (!/prête à envoyer/.test(tn) || !/28\/10\/2026/.test(tn) || !/admin\.lie@health\.fgov\.be/.test(tn)) erreurs.push('notification : état, date limite ou destinataire absents')
      await notif.getByRole('button', { name: 'Compléter la notification' }).evaluate((b) => b.click())
      await page.waitForTimeout(200)
      if ((await notif.locator('input[value="Croix-Rouge, section de Ferrières"]').count()) !== 1) erreurs.push('notification : le prestataire pré-rempli n’est pas dans le formulaire')
      if (!(await notif.locator('.prima-source', { hasText: 'Eventware' }).count())) erreurs.push('notification : provenance Eventware absente')
      await page.evaluate(() => { window.__ecritures = [] })
      await notif.locator('input[type=number]').first().fill('2')
      await notif.locator('input[type=number]').first().dispatchEvent('input')
      await page.waitForTimeout(1200)
      if (!(await page.evaluate(() => (window.__ecritures ?? []).some((e) => e.table === 'notifications_dmp' && e.op === 'upsert' && e.champs?.effectifs)))) erreurs.push('notification : une saisie d’effectif n’envoie pas d’upsert')
      const [pdfNotif] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
        notif.getByRole('button', { name: /Télécharger le PDF \(formulaire v1\.6\)/ }).evaluate((b) => b.click())
      ])
      if (!pdfNotif || !/^Notification-DMP-.*\.pdf$/.test(pdfNotif.suggestedFilename())) erreurs.push('notification : le PDF ne se télécharge pas')
      // (159) L'avis D3 avec sa prescription, le lien d'avis D1 et son bouton de copie.
      const av = await dossier.locator('.dossier-avis').textContent().catch(() => '')
      if (!/D3 — Police.*favorable sous conditions/.test(av) || !/Plan de circulation/.test(av)) erreurs.push('dossier : l’avis D3 et sa prescription manquent')
      if (!/Zone de secours/.test(av) || !(await dossier.locator('.dossier-avis button', { hasText: 'Copier le lien' }).count())) erreurs.push('dossier : le lien d’avis D1 manque')
    }
    // (158) Rubrique Partage : la liaison commune, son récepteur et sa ligne.
    await page.locator('.rubrique-reglages select').selectOption('partage')
    await page.waitForTimeout(500)
    const liaisons = page.locator('.liaisons-commune')
    if (!(await liaisons.count())) erreurs.push('partage : pas de bloc Liaison commune')
    else {
      const t = await liaisons.textContent()
      if (!/functions\/v1\/reception-commune/.test(t)) erreurs.push('partage : adresse du récepteur absente')
      if (!(await liaisons.locator('tbody tr', { hasText: 'Ferrières' }).count())) erreurs.push('partage : la liaison « Ferrières » n’est pas listée')
      if (!(await liaisons.getByRole('button', { name: '+ Nouvelle liaison' }).count())) erreurs.push('partage : pas de bouton Nouvelle liaison')
    }
    // (155) Rubrique Organisation : le profil de sécurité, six champs, trois à compléter ; Enregistrer envoie un upsert.
    await page.locator('.rubrique-reglages select').selectOption('organisation')
    await page.waitForTimeout(400)
    const profil = page.locator('.profil-securite')
    if (!(await profil.count())) erreurs.push('organisation : pas de profil de sécurité')
    else {
      if ((await profil.locator('input').count()) !== 6) erreurs.push(`organisation : ${await profil.locator('input').count()} champs (attendu 6)`)
      if (!/3 champs à compléter/.test(await profil.textContent())) erreurs.push('organisation : « 3 champs à compléter » absent')
      await page.evaluate(() => { window.__ecritures = [] })
      await profil.locator('input').nth(3).fill('RC-123')
      await profil.getByRole('button', { name: 'Enregistrer' }).click()
      await page.waitForTimeout(300)
      const ecrit = (await page.evaluate(() => window.__ecritures ?? [])).find((e) => e.table === 'organisations_profil_securite' && e.op === 'upsert' && e.champs?.assurance_police === 'RC-123')
      if (!ecrit) erreurs.push('organisation : Enregistrer n’envoie pas le numéro de police')
    }
  }
  if (ecran === 'coquille') {
    // Le bandeau d'état tient sur une ligne de quatre cadrans ; REX s'ouvre depuis « Plus ».
    const hauts = await page.locator('.bandeau-etat .cadran').evaluateAll((c) => c.map((x) => Math.round(x.getBoundingClientRect().top)))
    if (hauts.length !== 4 || new Set(hauts).size !== 1) erreurs.push(`bandeau d'état : ${hauts.length} cadrans sur ${new Set(hauts).size} ligne(s) (attendu 4 sur 1)`)
    const h = await page.locator('.bandeau-etat').evaluate((b) => b.getBoundingClientRect().height).catch(() => 999)
    if (h > 76) erreurs.push(`bandeau d'état : ${Math.round(h)} px de haut (attendu une ligne compacte)`)
    await page.locator('.barre-onglets button', { hasText: 'Plus' }).evaluate((b) => b.click())
    await page.waitForTimeout(200)
    if (!(await page.locator('.tiroir-plus .rex-plus').count())) erreurs.push('REX absent du tiroir « Plus »')
    await page.keyboard.press('Escape').catch(() => {})
  }
  if (ecran === 'accueil') {
    await verifierTalkie(page, erreurs)
  }
  if (m.petits.length) erreurs.push(`champs sous 16 px (zoom iPhone) : ${[...new Set(m.petits)].slice(0, 4).join(', ')}`)
  if (erreurs.length) echecs++
  console.log(`${erreurs.length ? '✗' : '✓'} téléphone ${ecran}${erreurs.length ? '\n    ' + erreurs.join('\n    ') : ''}`)
  await page.close()
}
// (31/10) Passe tablette tactile, 1024 × 768 sans souris : aucun champ éditable sous 16 px (Safari iPad zoome aussi).
for (const ecran of ecrans) {
  const page = await navigateur.newPage({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })
  page.on('pageerror', () => {})
  await page.goto('file://' + path.join(sortie, 'page-tel.html') + '?ecran=' + ecran, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const petits = await page.evaluate(() => [...document.querySelectorAll('#racine input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), #racine select, #racine textarea')]
    .filter((el) => el.offsetParent && !el.disabled && parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.tagName.toLowerCase()}.${el.className} ${getComputedStyle(el).fontSize}`))
  if (petits.length) { echecs++; console.log(`✗ tablette ${ecran}\n    champs sous 16 px : ${[...new Set(petits)].slice(0, 4).join(', ')}`) }
  else console.log(`✓ tablette ${ecran}`)
  await page.close()
}
await navigateur.close()
process.exit(echecs ? 1 : 0)
