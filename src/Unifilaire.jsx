import { useMemo, useRef } from 'react'
import { arbreElectrique, arbreEau, estSource, estDistributeur, COS_PHI } from './reseaux'

/**
 * Schéma unifilaire généré depuis le plan (118, 15/10).
 *
 * Une colonne par niveau : sources à gauche, coffrets au milieu, postes
 * à droite. Chaque liaison porte le câble tracé (type, section, longueur)
 * et chaque appareil son calibre, son différentiel et sa charge. Le
 * dessin est un SVG : il s'exporte tel quel pour le dossier RGIE (3.1.2)
 * et s'imprime.
 */

const fr = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d).replace('.', ','))

const L_BOITE = 220
const H_BOITE = 54
const PAS_X = 430
const PAS_Y = 72
const MARGE = 24

/** Dispose l'arbre : chaque feuille prend une ligne, un parent se centre sur ses enfants. */
function disposer(racines) {
  const places = []
  let ligne = 0
  function placer(n, prof) {
    const debut = ligne
    if (!n.enfants.length) {
      n._y = ligne++
    } else {
      for (const e of n.enfants) placer(e, prof + 1)
      n._y = (n.enfants[0]._y + n.enfants[n.enfants.length - 1]._y) / 2
    }
    n._x = prof
    places.push(n)
    return debut
  }
  for (const r of racines) {
    placer(r, 0)
    ligne += 0.5 // un demi-rang entre deux sources
  }
  const prof = Math.max(0, ...places.map((n) => n._x))
  return { places, lignes: Math.max(1, ligne), profondeur: prof }
}

function Boite({ n, x, y, reseau }) {
  const o = n.o
  const source = reseau === 'electricite' ? estSource(o) : !!o.source_eau && !o.raccord_eau
  const distrib = reseau === 'electricite' ? estDistributeur(o) : !!o.source_eau
  const charge = reseau === 'electricite' && Number(o.production_kva) > 0 ? n.kva / Number(o.production_kva) : null
  const bord = charge != null && charge > 1 ? '#b3311d' : charge != null && charge > 0.8 ? '#a86a00' : source ? '#8a6212' : distrib ? '#23557f' : '#5d6874'
  const l1 = reseau === 'electricite'
    ? [o.tension_v ? `${o.tension_v} V` : null, o.phases ? (Number(o.phases) === 1 ? 'mono' : 'tri') : null, o.calibre_a ? `${fr(o.calibre_a, 0)} A` : null, o.differentiel_ma ? `Δ ${o.differentiel_ma} mA` : null].filter(Boolean).join(' · ')
    : [o.diametre_mm ? `Ø ${o.diametre_mm} mm` : null].filter(Boolean).join(' · ')
  const l2 = reseau === 'electricite'
    ? (source
        ? `${fr(o.production_kva, 0)} kVA — charge ${fr(n.kva, 1)} kVA (${charge != null ? Math.round(charge * 100) + ' %' : '—'})`
        : distrib
          ? `${fr(n.kwTotal, 1)} kW · ${fr(n.intensite, 0)} A${n.chute ? ` · ΔU ${fr(n.chute, 1)} %` : ''}`
          : `${fr(n.kwPropre, 1)} kW · ${fr(n.intensite, 0)} A${n.chute ? ` · ΔU ${fr(n.chute, 1)} %` : ''}`)
    : (o.besoin_eau ? 'besoin d’eau' : o.source_eau ? 'point d’eau' : '')
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={L_BOITE} height={H_BOITE} rx={4} fill="#fff" stroke={bord} strokeWidth={source ? 2.5 : 1.5} />
      {source && <rect x={0} y={0} width={6} height={H_BOITE} fill={bord} />}
      <text x={12} y={16} fontSize={11.5} fontWeight={700} fill="#10151b">{(o.nom ?? '').length > 22 ? (o.nom ?? '').slice(0, 21) + '…' : o.nom}</text>
      <text x={L_BOITE - 8} y={16} fontSize={9.5} textAnchor="end" fill="#5d6874" fontFamily="ui-monospace, monospace">{o.code}</text>
      <text x={12} y={31} fontSize={10} fill="#10151b">{l1}</text>
      <text x={12} y={45} fontSize={10} fill="#5d6874">{l2}</text>
      {reseau === 'electricite' && o.ip && <text x={L_BOITE - 8} y={45} fontSize={9.5} textAnchor="end" fill="#5d6874">{o.ip}</text>}
      {reseau === 'electricite' && source && <text x={L_BOITE - 8} y={31} fontSize={9.5} textAnchor="end" fill={o.terre ? '#1f6f4f' : '#b3311d'}>{o.terre ? '⏚ terre' : '⏚ terre ?'}</text>}
    </g>
  )
}

function Liaison({ parent, n, reseau }) {
  const x1 = MARGE + parent._x * PAS_X + L_BOITE
  const y1 = MARGE + parent._y * PAS_Y + H_BOITE / 2
  const x2 = MARGE + n._x * PAS_X
  const y2 = MARGE + n._y * PAS_Y + H_BOITE / 2
  const xm = x1 + (x2 - x1) / 2
  const c = reseau === 'electricite' ? n.cable : n.conduite
  const etiquette = c
    ? reseau === 'electricite'
      ? `${c.type_cable ?? ''} ${c.phases ? (Number(c.phases) === 1 ? '3G' : '5G') : ''}${c.section_mm2 ? fr(c.section_mm2, c.section_mm2 < 10 ? 1 : 0) : '?'} · ${fr(c.longueur_m, 0)} m · ${c.calibre_a ? fr(c.calibre_a, 0) + ' A' : ''}`
      : `${c.nom} · ${fr(c.longueur_m, 0)} m`
    : 'câble non tracé'
  const mauvais = reseau === 'electricite' && c && Number(c.calibre_a) && n.intensite > Number(c.calibre_a)
  return (
    <g>
      <path d={`M${x1},${y1} H${xm} V${y2} H${x2}`} fill="none" stroke={c ? (mauvais ? '#b3311d' : '#10151b') : '#9aa3ad'} strokeWidth={c ? 1.5 : 1} strokeDasharray={c ? null : '4 3'} />
      {/* Protection au départ : le symbole du disjoncteur, au calibre du câble */}
      {reseau === 'electricite' && c && Number(c.calibre_a) > 0 && (
        <g transform={`translate(${x2 - 30},${y2})`}>
          <path d="M0,0 L7,0 M7,0 L18,-7 M18,0 L26,0" fill="none" stroke="#10151b" strokeWidth={1.5} />
          <text x={13} y={-10} fontSize={8} textAnchor="middle" fill="#10151b" paintOrder="stroke" stroke="#fff" strokeWidth={3}>{fr(c.calibre_a, 0)} A</text>
        </g>
      )}
      <text x={x2 - 34} y={y2 - 5} fontSize={8.5} textAnchor="end" fill={c ? '#10151b' : '#9aa3ad'} paintOrder="stroke" stroke="#fff" strokeWidth={3}>{etiquette}</text>
    </g>
  )
}

export default function Unifilaire({ objets, evenement, reseau = 'electricite' }) {
  const ref = useRef(null)
  const arbre = useMemo(() => (reseau === 'electricite' ? arbreElectrique(objets) : arbreEau(objets)), [objets, reseau])
  const { places, lignes, profondeur } = useMemo(() => disposer(arbre.racines), [arbre])
  const largeur = MARGE * 2 + (profondeur + 1) * PAS_X - (PAS_X - L_BOITE)
  const hauteur = MARGE * 2 + lignes * PAS_Y + 30
  const titre = `${reseau === 'electricite' ? 'Schéma unifilaire' : 'Réseau d’eau'} — ${evenement?.nom ?? ''}`
  const date = new Date().toLocaleDateString('fr-BE')

  function exporter() {
    const svg = ref.current
    if (!svg) return
    const src = new XMLSerializer().serializeToString(svg)
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + src], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${reseau === 'electricite' ? 'unifilaire' : 'reseau-eau'}-${(evenement?.nom ?? 'plan').replace(/[^A-Za-z0-9]+/g, '-')}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  function imprimer() {
    const svg = ref.current
    if (!svg) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titre}</title><style>body{margin:12mm;font-family:system-ui,sans-serif}svg{max-width:100%;height:auto}@page{size:A3 landscape;margin:10mm}</style></head><body>${new XMLSerializer().serializeToString(svg)}</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  if (!arbre.racines.length) {
    return <p className="aide">{reseau === 'electricite' ? 'Aucune source (groupe, raccordement réseau) placée : rien à dessiner. Pose un groupe ou un raccordement, des coffrets, et trace les câbles entre eux.' : 'Aucun point d’eau placé.'}</p>
  }

  return (
    <div className="unifilaire">
      <div className="ligne-boutons">
        <button className="discret" onClick={exporter}>Télécharger le SVG</button>
        <button className="discret" onClick={imprimer}>Imprimer (A3 paysage)</button>
      </div>
      <div className="unifilaire-cadre">
        <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${largeur} ${hauteur}`} width={largeur} height={hauteur} fontFamily="system-ui, sans-serif" style={{ background: '#fff' }}>
          <text x={MARGE} y={hauteur - 10} fontSize={10} fill="#5d6874">
            {titre} — généré par Eventware le {date}
            {reseau === 'electricite' ? ` · cos φ ${COS_PHI} · ΔU cumulée depuis la source · calibres de départ = courant admissible du câble tracé, à confirmer sur le tableau réel` : ''}
          </text>
          {places.map((n) => n.enfants.map((e) => <Liaison key={e.o.id} parent={n} n={e} reseau={reseau} />))}
          {places.map((n) => <Boite key={n.o.id} n={n} x={MARGE + n._x * PAS_X} y={MARGE + n._y * PAS_Y} reseau={reseau} />)}
        </svg>
      </div>
      {reseau === 'electricite' && (
        <p className="aide">
          Lecture : source (bande ocre) → coffrets (bleu) → postes. Sur chaque liaison : type et section du câble tracé sur le plan, longueur mesurée, et le calibre
          que doit avoir la protection au départ. Les boîtes rouges dépassent leur capacité. Le dossier RGIE demande en plus les calibres réels des
          départs et le plan de position — l'onglet Conception imprimé en tient lieu.
        </p>
      )}
    </div>
  )
}
