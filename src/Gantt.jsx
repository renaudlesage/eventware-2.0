import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur, estDoublon } from './erreurs'
import { libelleStatutJalon } from './jalons'
import FicheJalon from './FicheJalon'

/**
 * Gantt de l'avant / après-événement (129, briefing du 26/10).
 *
 * De J-90 à J+7 environ : la préparation, le montage, le démontage.
 * Le jour J lui-même (programme, créneaux, transports) reste à la
 * frise « Jour J » du Planning. Construit sur `jalons` — Préparation,
 * la frise, la Situation et ce Gantt voient la même donnée — avec les
 * dépendances fin-à-début de `jalon_dependances` et le chemin critique
 * calculé par le serveur (`gantt()`).
 *
 * Dessin SVG maison, sur le modèle de l'unifilaire (118) : export SVG
 * et impression A3 paysage. Les couleurs disent un état (à venir, en
 * cours, fait, en retard), jamais une appartenance ; elles viennent du
 * thème par classes CSS, et sont incrustées à l'export pour que le
 * fichier se suffise.
 *
 * Interactions (droit rh:modifier) : glisser une barre la déplace,
 * tirer un bord change le début ou la fin ; l'écriture ne part qu'au
 * relâchement, par `deplacer_jalon`, qui pousse les successeurs si
 * « Entraîner les suivantes » est coché. Sous 940 px, pas de Gantt :
 * la liste des jalons par groupe, et un renvoi vers Préparation.
 */

const COL = 260 // colonne des libellés
const LIGNE = 28
const ENTETE = 48
const GROUPE = 26
const BAS = 18
const JOUR_MS = 86400000
const PX_PAR_JOUR = { jours: 18, heures: 14 * 24 }
const AVANT_J = 120
const APRES_J = 14
const PHASES_LIB = { preparation: 'Préparation', montage: 'Montage', exploitation: 'Jour J', demontage: 'Démontage' }

const dateLocale = (s) => {
  if (!s) return null
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
const jourDe = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
function plusJours(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
const jjmm = (d) => d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })
const jjmmaa = (d) => d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })
const tronquer = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s ?? '')

function useEtroit() {
  const [etroit, setEtroit] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 939px)').matches)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 939px)')
    const f = () => setEtroit(q.matches)
    q.addEventListener('change', f)
    return () => q.removeEventListener('change', f)
  }, [])
  return etroit
}

/** Un lien est violé si le successeur commence avant la fin du prédécesseur + battement (en jours). */
export function lienViole(pred, succ, decalage) {
  if (!pred?.fin || !succ?.fin) return false
  const finP = jourDe(new Date(pred.fin))
  const debS = jourDe(new Date(succ.debut ?? succ.fin))
  return debS < plusJours(finP, decalage ?? 0)
}

/**
 * Les couleurs du SVG viennent de classes CSS ; un fichier SVG seul ne
 * les a pas. On recopie les styles calculés en attributs sur un clone.
 */
function cloneAutonome(svg) {
  const clone = svg.cloneNode(true)
  const src = svg.querySelectorAll('*')
  const dst = clone.querySelectorAll('*')
  const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family']
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    for (const p of props) {
      const v = cs.getPropertyValue(p)
      if (v) dst[i].setAttribute(p, v)
    }
  })
  return clone
}

/** Le dessin complet : la colonne des libellés à gauche, le temps à droite, dans un seul SVG. */
function svgComplet(colonne, temps, titre) {
  const l = Number(colonne.getAttribute('width')) + Number(temps.getAttribute('width'))
  const h = Number(temps.getAttribute('height')) + 18
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('viewBox', `0 0 ${l} ${h}`)
  svg.setAttribute('width', l)
  svg.setAttribute('height', h)
  svg.setAttribute('font-family', 'system-ui, sans-serif')
  const fond = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  fond.setAttribute('width', l); fond.setAttribute('height', h); fond.setAttribute('fill', '#fff')
  svg.appendChild(fond)
  const c = cloneAutonome(colonne)
  const t = cloneAutonome(temps)
  t.setAttribute('x', colonne.getAttribute('width'))
  svg.appendChild(c)
  svg.appendChild(t)
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  txt.setAttribute('x', 8); txt.setAttribute('y', h - 5); txt.setAttribute('font-size', 10); txt.setAttribute('fill', '#5d6874')
  txt.textContent = titre
  svg.appendChild(txt)
  return svg
}

/**
 * (28/10) Un jalon de plus, depuis la frise : code, libellé, groupe,
 * début facultatif, échéance, responsable, critique. Même table que
 * Préparation ; le code se vérifie contre les jalons existants avant
 * d'envoyer, et un code libre est proposé.
 */
function FormJalon({ evenement, lignes, groupes, membres, J, onFait, onFermer }) {
  const [f, setF] = useState({ code: '', libelle: '', groupe_travail_id: '', debut: '', echeance: '', responsable_membre_id: '', critique: false })
  const [erreur, setErreur] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const champ = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const codes = new Set(lignes.map((l) => String(l.code ?? '').toUpperCase()))
  const codeTape = f.code.trim().toUpperCase()
  const pris = codeTape ? lignes.find((l) => String(l.code ?? '').toUpperCase() === codeTape) : null
  // GJ-01 pris → GJ-02, GJ-03… (même longueur de numéro) ; COM pris → COM-2.
  function codeLibre(base) {
    const m = /^(.*?)(\d+)$/.exec(base || 'J')
    if (m) {
      const essai = (k) => m[1] + String(k).padStart(m[2].length, '0')
      let n = Number(m[2]) + 1
      while (codes.has(essai(n))) n++
      return essai(n)
    }
    let n = 2
    while (codes.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }
  const pret = f.code.trim() && f.libelle.trim() && f.echeance && !pris && (!f.debut || f.debut <= f.echeance)

  async function creer() {
    if (!pret) return
    setOccupe(true)
    setErreur(null)
    const { error } = await supabase.from('jalons').insert({
      evenement_id: evenement.id,
      code: f.code.trim(),
      libelle: f.libelle.trim(),
      groupe_travail_id: f.groupe_travail_id || null,
      debut: f.debut ? new Date(f.debut + 'T09:00:00').toISOString() : null,
      echeance: new Date(f.echeance + 'T17:00:00').toISOString(),
      responsable_membre_id: f.responsable_membre_id || null,
      critique: !!f.critique
    })
    setOccupe(false)
    if (error) {
      setErreur(estDoublon(error)
        ? { texte: `Le code « ${f.code.trim()} » est déjà pris sur cet événement, peut-être par une ligne supprimée.`, proposition: codeLibre(codeTape) }
        : { texte: texteErreur(error) })
    } else onFait()
  }

  return (
    <div className="formulaire gantt-ajout">
      <div className="saisie-rapide">
        <input value={f.code} onChange={champ('code')} placeholder="Code" style={{ flex: '0 1 90px' }} autoFocus aria-label="Code" />
        <input value={f.libelle} onChange={champ('libelle')} placeholder="L'échéance — ex. Dépôt du dossier à la commune" aria-label="Libellé" />
      </div>
      <div className="saisie-rapide">
        <select value={f.groupe_travail_id} onChange={champ('groupe_travail_id')} style={{ flex: '1 1 160px' }} aria-label="Groupe">
          <option value="">Sans groupe (jalon de l'événement)</option>
          {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
        </select>
        <label className="case-a-cocher" style={{ margin: 0, gap: 4 }}>début <input type="date" value={f.debut} onChange={champ('debut')} max={f.echeance || undefined} style={{ width: 'auto', marginBottom: 0 }} aria-label="Début" /></label>
        <label className="case-a-cocher" style={{ margin: 0, gap: 4 }}>échéance <input type="date" value={f.echeance} onChange={champ('echeance')} min={f.debut || undefined} style={{ width: 'auto', marginBottom: 0 }} aria-label="Échéance" /></label>
        <select value={f.responsable_membre_id} onChange={champ('responsable_membre_id')} style={{ flex: '1 1 140px' }} aria-label="Responsable">
          <option value="">Qui en répond ? (facultatif)</option>
          {membres.map((m) => <option key={m.id} value={m.id}>{m.nom_affiche ?? 'sans nom'}</option>)}
        </select>
        <label className="case-confirme" style={{ margin: 0 }}><input type="checkbox" checked={f.critique} onChange={champ('critique')} /><span>critique</span></label>
        <button disabled={!pret || occupe} onClick={creer}>Ajouter</button>
        <button className="discret" onClick={onFermer}>Annuler</button>
      </div>
      {pris && (
        <p className="aide alerte-texte gantt-doublon">
          Le code « {codeTape} » est déjà pris par « {pris.libelle} ».{' '}
          <button className="lien" onClick={() => setF({ ...f, code: codeLibre(codeTape) })}>Utiliser {codeLibre(codeTape)}</button>
        </p>
      )}
      {erreur && !pris && (
        <p className="aide alerte-texte gantt-erreur">
          {erreur.texte}{' '}
          {erreur.proposition && <button className="lien" onClick={() => { setF({ ...f, code: erreur.proposition }); setErreur(null) }}>Utiliser {erreur.proposition}</button>}
        </p>
      )}
      <p className="aide">
        Un jalon a toujours une échéance ; un début en fait une barre, sans début c'est un losange.
        {J ? ` Jour J : ${J.toLocaleDateString('fr-BE')}.` : ''} Il apparaît aussi dans Préparation et, confié à quelqu'un, dans son écran « Mes missions ».
      </p>
    </div>
  )
}

export default function Gantt({ evenement, peut, toutPouvoir, onAller }) {
  const [lignes, setLignes] = useState(null)
  const [liens, setLiens] = useState([])
  const [membres, setMembres] = useState([])
  const [message, setMessage] = useState(null)
  const [echelle, setEchelle] = useState(() => (['montage', 'demontage'].includes(evenement.phase) ? 'heures' : 'jours'))
  const [entrainer, setEntrainer] = useState(true)
  const [masquerFaits, setMasquerFaits] = useState(false)
  const [selection, setSelection] = useState(null)
  const [glisse, setGlisse] = useState(null)
  const [survol, setSurvol] = useState(null)
  const [lienASupprimer, setLienASupprimer] = useState(null)
  // (28/10) Ajouter un jalon sans quitter la frise.
  const [ajout, setAjout] = useState(false)
  const [groupes, setGroupes] = useState([])
  const svgRef = useRef(null)
  const colonneRef = useRef(null)
  const cadreRef = useRef(null)
  const etroit = useEtroit()
  const peutModifier = toutPouvoir || peut?.('rh', 'modifier')
  const peutCreer = toutPouvoir || peut?.('rh', 'creer')

  async function charger() {
    const [g, d, m, gt, jc] = await Promise.all([
      supabase.rpc('gantt', { p_evenement: evenement.id }),
      supabase.from('jalon_dependances').select('*').eq('evenement_id', evenement.id),
      supabase.from('membres_evenement').select('id, nom_affiche').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom_affiche', { nullsFirst: false }),
      supabase.from('groupes_travail').select('id, nom, couleur').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom'),
      // (146) Les couleurs propres des jalons : gantt() ne les porte pas, on les lit à part.
      supabase.from('jalons').select('id, couleur').eq('evenement_id', evenement.id).is('deleted_at', null)
    ])
    if (g.error) setMessage({ type: 'erreur', texte: texteErreur(g.error) })
    const couleurs = Object.fromEntries((jc.data ?? []).filter((x) => x.couleur).map((x) => [x.id, x.couleur]))
    setLignes((g.data ?? []).map((l) => ({ ...l, couleur: couleurs[l.id] ?? null })))
    setLiens(d.data ?? [])
    setMembres(m.data ?? [])
    setGroupes(gt.data ?? [])
  }
  // (146) La teinte d'un jalon : la sienne, sinon celle de son groupe, sinon rien (le statut remplit).
  const couleurGroupe = useMemo(() => Object.fromEntries(groupes.filter((x) => x.couleur).map((x) => [x.id, x.couleur])), [groupes])
  const teinteDe = (j) => j.couleur ?? (j.groupe_travail_id ? couleurGroupe[j.groupe_travail_id] : null) ?? null
  const groupesColores = groupes.filter((x) => x.couleur)
  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  // Au premier dessin : aujourd'hui vers le tiers gauche de la fenêtre
  // (ce qui vient est à droite) ; sans aujourd'hui dans la plage, J vers
  // le tiers droit (la préparation est à gauche, c'est elle qu'on vient
  // voir).
  const cadre = useRef(false)
  function aller(cible) {
    const el = cadreRef.current
    if (!el) return
    if (cible === 'debut') { el.scrollLeft = 0; return }
    const x = el.querySelector(cible === 'aujourdhui' ? '.gantt-aujourdhui' : '.gantt-j')?.getAttribute('x1')
    if (x == null) return
    el.scrollLeft = Math.max(0, Number(x) - el.clientWidth * (cible === 'aujourdhui' ? 0.3 : 0.7))
  }
  useEffect(() => {
    if (cadre.current || !lignes || !cadreRef.current) return
    const el = cadreRef.current
    if (el.querySelector('.gantt-aujourdhui')) aller('aujourdhui')
    else if (el.querySelector('.gantt-j')) aller('j')
    else return
    cadre.current = true
  }, [lignes, echelle, evenement.date_debut])

  const px = PX_PAR_JOUR[echelle]
  const J = dateLocale(evenement.date_debut)
  const finEv = dateLocale(evenement.date_fin) ?? J
  const montage = dateLocale(evenement.date_montage)
  const demontage = dateLocale(evenement.date_demontage)
  const aujourdhui = jourDe(new Date())

  const parId = useMemo(() => Object.fromEntries((lignes ?? []).map((l) => [l.id, l])), [lignes])

  // La plage, les rangs et les positions.
  const plan = useMemo(() => {
    const tous = lignes ?? []
    const dates = tous.filter((l) => l.fin && !(masquerFaits && l.statut === 'fait'))
    const sansDate = tous.filter((l) => !l.fin)
    let t0, t1
    const debuts = dates.map((l) => jourDe(new Date(l.debut ?? l.fin)))
    const fins = dates.map((l) => jourDe(new Date(l.fin)))
    if (debuts.length) {
      t0 = new Date(Math.min(...debuts.map((d) => d.getTime())))
      t1 = new Date(Math.max(...fins.map((d) => d.getTime())))
    } else {
      t0 = J ? plusJours(J, -30) : plusJours(aujourdhui, -7)
      t1 = J ?? plusJours(aujourdhui, 30)
    }
    if (demontage && demontage > t1) t1 = demontage
    else if (finEv && finEv > t1) t1 = finEv
    if (montage && montage < t0) t0 = montage
    // (27/10) La fenêtre couvre tous les jalons datés, et au moins les
    // AVANT_J jours avant J et APRES_J après. Avant, elle était coupée à
    // J − 120 : un jalon de novembre pour un événement d'août n'existait
    // plus à l'écran, et rien ne remontait dans le temps.
    if (J) {
      if (t0 > plusJours(J, -AVANT_J)) t0 = plusJours(J, -AVANT_J)
      if (t1 < plusJours(J, APRES_J)) t1 = plusJours(J, APRES_J)
    }
    t0 = plusJours(t0, -3)
    t1 = plusJours(t1, 4)
    if (t1 <= t0) t1 = plusJours(t0, 7)
    // La colonne des libellés est un SVG à part, collé à gauche
    // (position: sticky) : elle reste lisible quand on fait défiler le
    // temps. X ne compte donc que le temps.
    const X = (d) => ((d.getTime() - t0.getTime()) / JOUR_MS) * px
    const largeur = X(t1)

    // Un groupe = un bloc, dans l'ordre d'apparition (gantt() trie par
    // groupe puis par phase et date) ; les sans-groupe en dernier.
    const groupes = new Map()
    for (const l of dates) {
      const cle = l.groupe_travail_id ?? 'sans'
      if (!groupes.has(cle)) groupes.set(cle, { cle, nom: l.groupe_nom ?? 'Sans groupe', pilote: l.groupe_pilote, jalons: [] })
      groupes.get(cle).jalons.push(l)
    }
    const ordonnes = [...groupes.values()].sort((a, b) => (a.cle === 'sans') - (b.cle === 'sans'))
    const rangs = []
    let y = ENTETE
    for (const g of ordonnes) {
      rangs.push({ type: 'groupe', cle: g.cle, nom: g.nom, pilote: g.pilote, y })
      y += GROUPE
      for (const l of g.jalons) {
        rangs.push({ type: 'jalon', j: l, y })
        y += LIGNE
      }
    }
    const hauteur = y + BAS
    const yDe = Object.fromEntries(rangs.filter((r) => r.type === 'jalon').map((r) => [r.j.id, r.y]))
    return { t0, t1, X, largeur, rangs, hauteur, yDe, sansDate, dates }
  }, [lignes, masquerFaits, px, evenement.date_debut, evenement.date_fin, evenement.date_montage, evenement.date_demontage])

  /** Les dates d'un jalon, avec l'aperçu du glisser en cours. */
  function datesDe(j) {
    let debut = j.debut ? new Date(j.debut) : null
    let fin = new Date(j.fin)
    if (glisse && glisse.id === j.id && glisse.d) {
      const ms = glisse.d * JOUR_MS
      if (glisse.mode === 'deplacer') {
        if (debut) debut = new Date(debut.getTime() + ms)
        fin = new Date(fin.getTime() + ms)
      } else if (glisse.mode === 'gauche' && debut) {
        debut = new Date(Math.min(debut.getTime() + ms, fin.getTime()))
      } else if (glisse.mode === 'droite') {
        fin = new Date(Math.max(fin.getTime() + ms, (debut ?? fin).getTime()))
      }
    }
    return { debut, fin }
  }

  // Glisser : la position se dessine en local ; l'écriture part au relâchement.
  function debutGlisse(e, j, mode) {
    if (!peutModifier) return
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const pas = echelle === 'heures' ? 1 / 24 : 1
    let d = 0
    setGlisse({ id: j.id, mode, d: 0 })
    const bouge = (m) => {
      d = Math.round(((m.clientX - x0) / px) / pas) * pas
      setGlisse({ id: j.id, mode, d })
    }
    const fin = async () => {
      window.removeEventListener('pointermove', bouge)
      window.removeEventListener('pointerup', fin)
      setGlisse(null)
      if (Math.abs(d) < pas / 2) {
        setSelection(j.id)
        return
      }
      const apres = datesDe({ ...j })
      const ms = d * JOUR_MS
      let nDebut = j.debut ? new Date(new Date(j.debut).getTime()) : null
      let nFin = new Date(j.fin)
      if (mode === 'deplacer') {
        if (nDebut) nDebut = new Date(nDebut.getTime() + ms)
        nFin = new Date(nFin.getTime() + ms)
      } else if (mode === 'gauche' && nDebut) {
        nDebut = new Date(Math.min(nDebut.getTime() + ms, nFin.getTime()))
      } else if (mode === 'droite') {
        nFin = new Date(Math.max(nFin.getTime() + ms, (nDebut ?? nFin).getTime()))
      }
      void apres
      const { data, error } = await supabase.rpc('deplacer_jalon', {
        p_jalon: j.id,
        p_debut: nDebut ? nDebut.toISOString() : null,
        p_fin: nFin.toISOString(),
        p_entrainer: entrainer
      })
      if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
      else {
        const r = Array.isArray(data) ? data[0] : data
        if (r?.apres_j > 0) setMessage({ type: 'veille', texte: `${r.apres_j} jalon${r.apres_j > 1 ? 's passent' : ' passe'} après le début de l'événement.` })
        else if (r?.deplaces > 0) setMessage({ type: 'info', texte: `${r.deplaces} jalon${r.deplaces > 1 ? 's suivants décalés' : ' suivant décalé'}.` })
        else setMessage(null)
      }
      charger()
    }
    window.addEventListener('pointermove', bouge)
    window.addEventListener('pointerup', fin)
  }

  async function supprimerLien(l) {
    const { error, count } = await supabase.from('jalon_dependances').delete({ count: 'exact' }).eq('id', l.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Suppression refusée : droits insuffisants.' })
    setLienASupprimer(null)
    charger()
  }

  const titreDessin = () => `Planning avant / après — ${evenement?.nom ?? ''} — généré par Eventware le ${new Date().toLocaleDateString('fr-BE')}`
  function exporter() {
    const svg = svgRef.current
    if (!svg || !colonneRef.current) return
    const src = new XMLSerializer().serializeToString(svgComplet(colonneRef.current, svg, titreDessin()))
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + src], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gantt-${(evenement?.nom ?? 'planning').replace(/[^A-Za-z0-9]+/g, '-')}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }
  function imprimer() {
    const svg = svgRef.current
    if (!svg || !colonneRef.current) return
    const w = window.open('', '_blank')
    if (!w) return
    const titre = `Planning avant / après — ${evenement?.nom ?? ''}`
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titre}</title><style>body{margin:12mm;font-family:system-ui,sans-serif}svg{max-width:100%;height:auto}@page{size:A3 landscape;margin:10mm}</style></head><body>${new XMLSerializer().serializeToString(svgComplet(colonneRef.current, svg, titreDessin()))}</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  if (lignes === null) return <p className="aide">Chargement…</p>

  const selectionne = selection ? parId[selection] : null
  const { t0, t1, X, largeur, rangs, hauteur, yDe, sansDate, dates } = plan

  // ---- Sous 940 px : la liste, pas le dessin --------------------------
  if (etroit) {
    const groupes = []
    for (const l of lignes) {
      const cle = l.groupe_travail_id ?? 'sans'
      let g = groupes.find((x) => x.cle === cle)
      if (!g) { g = { cle, nom: l.groupe_nom ?? 'Sans groupe', lignes: [] }; groupes.push(g) }
      g.lignes.push(l)
    }
    return (
      <div className="gantt gantt-liste">
        <p className="aide" style={{ marginTop: 0 }}>
          Le dessin du planning demande un écran large. Ici, les jalons par groupe de travail, triés par fin.
          {onAller && <> <button className="lien" onClick={() => onAller('preparation')}>Ouvrir Préparation</button></>}
        </p>
        {groupes.map((g) => (
          <section key={g.cle} className="bloc">
            <h2>{g.nom}</h2>
            {g.lignes.sort((a, b) => (a.fin ?? '9') < (b.fin ?? '9') ? -1 : 1).map((l) => (
              <div key={l.id} className={`carte ${l.en_retard ? 'urgent' : ''}`}>
                <div className="titre">{l.libelle}<span className="code-discret">{l.code}</span></div>
                <div className="meta">
                  <span className={l.en_retard ? 'alerte-texte' : ''}>{l.fin ? jjmm(new Date(l.fin)) : 'sans date'}</span>
                  <span>{libelleStatutJalon(l.statut)}</span>
                  <span className="mono">{l.avancement ?? 0} %</span>
                  {l.en_retard && <span className="alerte-texte">en retard</span>}
                  {l.sur_chemin_critique && <span className="alerte-texte">chemin critique</span>}
                  {l.responsable && <span>{l.responsable}</span>}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    )
  }

  // ---- L'axe du temps --------------------------------------------------
  const graduations = []
  for (let d = new Date(t0); d < t1; d = plusJours(d, 1)) {
    const x = X(d)
    const lundi = d.getDay() === 1
    const premier = d.getDate() === 1
    if (echelle === 'jours') {
      graduations.push(<line key={'g' + d} x1={x} y1={ENTETE - 6} x2={x} y2={hauteur - BAS} className={`gantt-grille ${lundi ? 'semaine' : ''}`} />)
      if (px >= 14 || d.getDate() % 2 === 1)
        graduations.push(<text key={'t' + d} x={x + px / 2} y={ENTETE - 10} textAnchor="middle" className="gantt-axe-jour">{d.getDate()}</text>)
      const finDeMois = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      if (premier || (d.getTime() === t0.getTime() && (finDeMois - d) / JOUR_MS >= 6))
        graduations.push(<text key={'m' + d} x={x + 3} y={ENTETE - 30} className="gantt-axe-mois">{d.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })}</text>)
    } else {
      graduations.push(<line key={'g' + d} x1={x} y1={ENTETE - 30} x2={x} y2={hauteur - BAS} className="gantt-grille semaine" />)
      graduations.push(<text key={'t' + d} x={x + 4} y={ENTETE - 30} className="gantt-axe-mois">{d.toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</text>)
      for (let h = 6; h < 24; h += 6) {
        const xh = x + (h / 24) * px
        graduations.push(<line key={'h' + d + h} x1={xh} y1={ENTETE - 6} x2={xh} y2={hauteur - BAS} className="gantt-grille" />)
        graduations.push(<text key={'th' + d + h} x={xh} y={ENTETE - 10} textAnchor="middle" className="gantt-axe-jour">{h} h</text>)
      }
    }
  }

  // ---- Les bandes de phase --------------------------------------------
  const bandes = []
  const bande = (cle, a, b) => {
    if (!a || !b || b <= a) return
    const xa = Math.max(X(a), 0)
    const xb = Math.min(X(b), largeur)
    if (xb <= xa) return
    bandes.push(<rect key={cle} x={xa} y={ENTETE - 6} width={xb - xa} height={hauteur - ENTETE + 6 - BAS} className={`gantt-bande ${cle}`} />)
    if (xb - xa >= 70) bandes.push(<text key={'l' + cle} x={xa + 4} y={hauteur - 5} className="gantt-bande-libelle">{PHASES_LIB[cle]}</text>)
  }
  if (J) {
    bande('montage', montage, J)
    bande('exploitation', J, plusJours(finEv, 1))
    bande('demontage', plusJours(finEv, 1), demontage ? plusJours(demontage, 1) : null)
  }

  // ---- Les liens --------------------------------------------------------
  const fleches = liens.map((l) => {
    const p = parId[l.precede_id]
    const s = parId[l.jalon_id]
    if (!p || !s || yDe[p.id] == null || yDe[s.id] == null) return null
    const dp = datesDe(p)
    const ds = datesDe(s)
    const x1 = X(dp.fin)
    const y1 = yDe[p.id] + LIGNE / 2
    const x2 = X(ds.debut ?? ds.fin) - (ds.debut ? 0 : 7)
    const y2 = yDe[s.id] + LIGNE / 2
    const viole = lienViole({ fin: dp.fin }, { debut: ds.debut, fin: ds.fin }, l.decalage_j)
    const chemin = x2 >= x1 + 14
      ? `M ${x1} ${y1} H ${x1 + 7} V ${y2} H ${x2 - 5}`
      : `M ${x1} ${y1} H ${x1 + 7} V ${y1 + LIGNE / 2} H ${x2 - 12} V ${y2} H ${x2 - 5}`
    return (
      <g key={l.id} className={`gantt-lien ${viole ? 'viole' : ''} ${lienASupprimer?.id === l.id ? 'actif' : ''}`}
        onClick={(e) => { e.stopPropagation(); if (peutModifier) setLienASupprimer(l) }} style={{ cursor: peutModifier ? 'pointer' : 'default' }}>
        <path d={chemin} fill="none" />
        <polygon points={`${x2 - 6},${y2 - 4} ${x2},${y2} ${x2 - 6},${y2 + 4}`} />
        <title>{p.code} → {s.code}{l.decalage_j ? ` (+${l.decalage_j} j)` : ''}{viole ? ' — contrainte violée' : ''}</title>
      </g>
    )
  })

  return (
    <div className="gantt">
      <div className="ligne-boutons gantt-outils">
        <label className="case-a-cocher" style={{ margin: 0 }}>
          Échelle
          <select value={echelle} onChange={(e) => setEchelle(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
            <option value="jours">jours</option>
            <option value="heures">heures</option>
          </select>
        </label>
        {peutModifier && (
          <label className="case-a-cocher" style={{ margin: 0 }} title="En déplaçant un jalon, pousser ceux qui l'attendent">
            <input type="checkbox" checked={entrainer} onChange={(e) => setEntrainer(e.target.checked)} /> Entraîner les suivantes
          </label>
        )}
        <label className="case-a-cocher" style={{ margin: 0 }}>
          <input type="checkbox" checked={masquerFaits} onChange={(e) => setMasquerFaits(e.target.checked)} /> Masquer les jalons faits
        </label>
        {peutCreer && <button onClick={() => setAjout((a) => !a)}>{ajout ? 'Fermer' : '+ Jalon'}</button>}
        <button className="discret" onClick={exporter}>Télécharger le SVG</button>
        <button className="discret" onClick={imprimer}>Imprimer (A3 paysage)</button>
        <button className="discret" onClick={charger}>Rafraîchir</button>
        <span className="aide gantt-aller" style={{ margin: 0 }}>
          Aller à : <button className="lien" onClick={() => aller('debut')}>début</button>
          {' · '}<button className="lien" onClick={() => aller('aujourdhui')}>aujourd'hui</button>
          {J && <>{' · '}<button className="lien" onClick={() => aller('j')}>jour J</button></>}
        </span>
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>{message.texte}</div>
      )}

      {ajout && peutCreer && (
        <FormJalon evenement={evenement} lignes={lignes ?? []} groupes={groupes} membres={membres} J={J}
          onFait={() => { setAjout(false); charger() }} onFermer={() => setAjout(false)} />
      )}

      {lienASupprimer && (
        <div className="message">
          Supprimer la dépendance {parId[lienASupprimer.precede_id]?.code} → {parId[lienASupprimer.jalon_id]?.code} ?{' '}
          <button className="danger" onClick={() => supprimerLien(lienASupprimer)}>Supprimer</button>{' '}
          <button className="discret" onClick={() => setLienASupprimer(null)}>Garder</button>
        </div>
      )}

      {selectionne && (
        <FicheJalon
          jalon={selectionne}
          info={selectionne}
          lignes={lignes}
          liens={liens}
          membres={membres}
          evenement={evenement}
          peutModifier={peutModifier}
          statut
          onFait={charger}
          onFermer={() => setSelection(null)}
          setMessage={setMessage}
        />
      )}

      {dates.length === 0 ? (
        <p className="vide">
          Aucun jalon daté. Pose les échéances dans Préparation ou dans l'onglet Jalons : le Gantt les dessine, et Réglages › Dates place le jour J.
        </p>
      ) : (
        <div className="gantt-cadre" ref={cadreRef} onPointerLeave={() => setSurvol(null)}>
          <div className="gantt-colonne">
            <svg ref={colonneRef} viewBox={`0 0 ${COL} ${hauteur}`} width={COL} height={hauteur} className="gantt-svg gantt-svg-colonne" fontFamily="system-ui, sans-serif">
              <rect x={0} y={0} width={COL} height={hauteur} className="gantt-fond" />
              {rangs.map((r) =>
                r.type === 'groupe' ? (
                  <g key={'g' + r.cle}>
                    <rect x={0} y={r.y} width={COL} height={GROUPE} className="gantt-groupe" style={couleurGroupe[r.cle] ? { fill: couleurGroupe[r.cle], fillOpacity: 0.22 } : undefined} />
                    {couleurGroupe[r.cle] && <rect x={0} y={r.y} width={4} height={GROUPE} style={{ fill: couleurGroupe[r.cle] }} />}
                    <text x={8} y={r.y + 17} className="gantt-groupe-nom">{tronquer(r.nom, 30)}{r.pilote ? ` · ${r.pilote}` : ''}</text>
                  </g>
                ) : (
                  <g key={r.j.id} className={`gantt-jalon statut-${r.j.statut} ${r.j.sur_chemin_critique ? 'chemin' : ''} ${selection === r.j.id ? 'selectionne' : ''}`}
                    onClick={() => setSelection(r.j.id)} style={{ cursor: 'pointer' }}>
                    <line x1={0} y1={r.y + LIGNE} x2={COL} y2={r.y + LIGNE} className="gantt-separateur" />
                    <text x={8} y={r.y + 12} className="gantt-libelle"><title>{r.j.code} — {r.j.libelle}</title>{tronquer(r.j.libelle, 34)}</text>
                    <text x={8} y={r.y + 24} className="gantt-responsable">{tronquer([r.j.code, r.j.responsable].filter(Boolean).join(' · '), 40)}</text>
                  </g>
                )
              )}
              <line x1={COL - 1} y1={0} x2={COL - 1} y2={hauteur} className="gantt-grille semaine" />
            </svg>
          </div>
          <svg ref={svgRef} viewBox={`0 0 ${largeur} ${hauteur}`} width={largeur} height={hauteur} className="gantt-svg" fontFamily="system-ui, sans-serif"
            onClick={() => { setSelection(null); setLienASupprimer(null) }}>
            <rect x={0} y={0} width={largeur} height={hauteur} className="gantt-fond" />
            {bandes}
            {graduations}
            {rangs.map((r) => (r.type === 'groupe' ? <rect key={'g' + r.cle} x={0} y={r.y} width={largeur} height={GROUPE} className="gantt-groupe" style={couleurGroupe[r.cle] ? { fill: couleurGroupe[r.cle], fillOpacity: 0.22 } : undefined} /> : null))}
            {rangs.map((r) => (r.type === 'jalon' ? <line key={'s' + r.j.id} x1={0} y1={r.y + LIGNE} x2={largeur} y2={r.y + LIGNE} className="gantt-separateur" /> : null))}
            {J && <line x1={X(J)} y1={ENTETE - 34} x2={X(J)} y2={hauteur - BAS} className="gantt-j" data-jour={evenement.date_debut} />}
            {J && <text x={X(J) + 3} y={ENTETE - 36} className="gantt-j-libelle">J</text>}
            {aujourdhui >= t0 && aujourdhui <= t1 && <line x1={X(aujourdhui)} y1={ENTETE - 6} x2={X(aujourdhui)} y2={hauteur - BAS} className="gantt-aujourdhui" />}
            {fleches}
            {rangs.map((r) => {
              if (r.type !== 'jalon') return null
              const j = r.j
              const { debut, fin } = datesDe(j)
              const y = r.y
              const x2 = X(fin)
              const x1 = debut ? X(debut) : x2
              const teinte = teinteDe(j)
              const classes = `gantt-jalon statut-${j.statut} ${j.en_retard ? 'en-retard' : ''} ${j.critique ? 'critique' : ''} ${j.sur_chemin_critique ? 'chemin' : ''} ${selection === j.id ? 'selectionne' : ''} ${teinte ? 'teinte' : ''}`
              const sur = (e) => setSurvol({ j, x: e.clientX, y: e.clientY })
              return (
                <g key={j.id} className={classes} data-code={j.code} onPointerEnter={sur} onPointerMove={sur} onPointerLeave={() => setSurvol(null)}>
                  {debut ? (
                    <>
                      <rect x={x1} y={y + 6} width={Math.max(2, x2 - x1)} height={16} rx={2} className="gantt-barre"
                        onPointerDown={(e) => debutGlisse(e, j, 'deplacer')} onClick={(e) => { e.stopPropagation(); if (!peutModifier) setSelection(j.id) }}
                        style={{ cursor: peutModifier ? 'grab' : 'pointer', fill: teinte ?? undefined }} />
                      {j.avancement > 0 && <rect x={x1} y={y + 6} width={Math.max(0, (x2 - x1) * Math.min(100, j.avancement) / 100)} height={16} rx={2} className="gantt-avancement" pointerEvents="none" />}
                      {j.sur_chemin_critique && <rect x={x1} y={y + 23} width={Math.max(2, x2 - x1)} height={2} className="gantt-chemin" pointerEvents="none" />}
                      {peutModifier && (
                        <>
                          <rect x={x1 - 1} y={y + 6} width={6} height={16} className="gantt-poignee" onPointerDown={(e) => debutGlisse(e, j, 'gauche')} />
                          <rect x={x2 - 5} y={y + 6} width={6} height={16} className="gantt-poignee" onPointerDown={(e) => debutGlisse(e, j, 'droite')} />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <polygon points={`${x2},${y + 6} ${x2 + 8},${y + 14} ${x2},${y + 22} ${x2 - 8},${y + 14}`} className="gantt-losange"
                        onPointerDown={(e) => debutGlisse(e, j, 'deplacer')} onClick={(e) => { e.stopPropagation(); if (!peutModifier) setSelection(j.id) }}
                        style={{ cursor: peutModifier ? 'grab' : 'pointer', fill: teinte ?? undefined }} />
                      {j.sur_chemin_critique && <rect x={x2 - 8} y={y + 24} width={16} height={2} className="gantt-chemin" pointerEvents="none" />}
                    </>
                  )}
                </g>
              )
            })}
          </svg>
          {survol && !glisse && (
            <div className="gantt-bulle" style={{ left: survol.x - (cadreRef.current?.getBoundingClientRect().left ?? 0) + 12, top: survol.y - (cadreRef.current?.getBoundingClientRect().top ?? 0) + 12 }}>
              <strong><span className="mono">{survol.j.code}</span> {survol.j.libelle}</strong>
              <div>{survol.j.debut ? `${jjmmaa(new Date(survol.j.debut))} → ` : ''}{jjmmaa(new Date(survol.j.fin))} · {libelleStatutJalon(survol.j.statut)} · {survol.j.avancement ?? 0} %</div>
              {survol.j.responsable && <div>{survol.j.responsable}</div>}
              {survol.j.marge_j != null && <div className={survol.j.sur_chemin_critique ? 'alerte-texte' : ''}>{survol.j.sur_chemin_critique ? 'sur le chemin critique' : `marge ${survol.j.marge_j} j`}</div>}
              {survol.j.en_retard && <div className="alerte-texte">en retard</div>}
              {survol.j.predecesseurs?.length > 0 && <div className="sourdine">après : {survol.j.predecesseurs.map((id) => parId[id]?.code ?? '?').join(', ')}</div>}
            </div>
          )}
        </div>
      )}

      {sansDate.length > 0 && (
        <p className="aide">
          Sans date, donc hors du dessin : {sansDate.map((l) => `${l.code} ${l.libelle}`).join(' · ')}. Une fin dans Préparation les y met.
        </p>
      )}
      <ul className="legende-carte gantt-legende">
        <li><span className="puce-carte puce-gantt-a-venir" /> à venir</li>
        <li><span className="puce-carte puce-gantt-en-cours" /> en cours</li>
        <li><span className="puce-carte puce-ok" /> fait</li>
        <li><span className="puce-carte puce-chaud" /> en retard</li>
        <li><span className="trait-gantt-chemin" /> chemin critique</li>
        <li><span className="trait-gantt-viole" /> dépendance violée</li>
      </ul>
      {/* (146) Les groupes colorés : le remplissage dit le groupe, le contour dit le statut. */}
      {groupesColores.length > 0 && (
        <ul className="legende-carte gantt-legende gantt-legende-groupes">
          {groupesColores.map((g) => <li key={g.id}><span className="couleur-pastille" style={{ background: g.couleur }} /> {g.nom}</li>)}
          <li className="sourdine">remplissage : le groupe (ou la couleur du jalon) · contour : le statut</li>
        </ul>
      )}
      <p className="aide">
        {peutModifier
          ? 'Glisse une barre pour la déplacer, tire un bord pour changer le début ou la fin ; clique un jalon pour sa fiche, une flèche pour retirer la dépendance. Un jalon sans début est un losange.'
          : 'Clique un jalon pour sa fiche. Lecture seule : le déplacement demande le droit de modifier les bénévoles et jalons.'}
      </p>
    </div>
  )
}
