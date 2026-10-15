import { useMemo, useState } from 'react'
import { polygoneObjet, surfaceObjet, seChevauchent, distancePolygones, distancePolygoneLigne } from './geometrie'
import { LIBELLE_CALQUE, COULEUR_CALQUE } from './Implantation'

/**
 * Ce que le plan à l'échelle permet de calculer sans rien saisir de plus
 * (115, choix de Ren du 15/10) :
 *
 *   ÉNERGIE    — chaque groupe, ce qu'il alimente, sa charge ; les
 *                consommateurs non raccordés. kW → kVA avec cos φ 0,8,
 *                alerte à 80 % de charge (démarrages, foisonnement).
 *   EAU        — les points d'eau, ce qu'ils alimentent, les besoins non
 *                raccordés.
 *   CONTRÔLES  — chevauchements d'emprises ; distances de sécurité (un
 *                objet à distance de sécurité contre ce qui reçoit du
 *                public et les toiles) ; voies engins (élément du plan
 *                « voie_engins ») encombrées : 4 m de passage minimum.
 *   MÉTRÉ      — par équipement et par fournisseur : nombre, dimensions,
 *                surface, puissance ; CSV.
 *
 * Tout est calculé ici, à la lecture : rien n'est stocké, rien ne peut
 * être périmé.
 */

const COS_PHI = 0.8
const LARGEUR_VOIE_ENGINS = 4
const fr = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d).replace('.', ','))
const TOILES = new Set(['CHAP', 'TONN', 'PAGODE'])
const estToile = (o) => /chapiteau|tonnelle|pagode|tente/i.test(o.nom ?? '') || TOILES.has((o.code ?? '').split('-')[0].replace(/\d.*$/, ''))

export default function BilansImplantation({ elements }) {
  const [onglet, setOnglet] = useState('controles')
  const objets = useMemo(() => elements.filter((e) => e.centre_lat != null && e.largeur_m), [elements])
  const polys = useMemo(() => new Map(objets.map((o) => [o.id, polygoneObjet(o)])), [objets])
  const nom = Object.fromEntries(objets.map((o) => [o.id, o.nom]))

  /* ---- énergie --------------------------------------------------- */
  const energie = useMemo(() => {
    const groupes = objets.filter((o) => Number(o.production_kva) > 0)
    const lignes = groupes.map((g) => {
      const conso = objets.filter((o) => o.alimente_par === g.id)
      const kw = conso.reduce((s, o) => s + Number(o.puissance_kw || 0), 0)
      const kva = kw / COS_PHI
      return { g, conso, kw, kva, charge: Number(g.production_kva) ? kva / Number(g.production_kva) : 0 }
    })
    const orphelins = objets.filter((o) => Number(o.puissance_kw) > 0 && !o.alimente_par)
    const total = objets.reduce((s, o) => s + Number(o.puissance_kw || 0), 0)
    const prod = groupes.reduce((s, g) => s + Number(g.production_kva || 0), 0)
    return { lignes, orphelins, total, prod }
  }, [objets])

  /* ---- eau --------------------------------------------------------- */
  const eau = useMemo(() => {
    const sources = objets.filter((o) => o.source_eau)
    const lignes = sources.map((s) => ({ s, conso: objets.filter((o) => o.raccord_eau === s.id) }))
    const orphelins = objets.filter((o) => o.besoin_eau && !o.raccord_eau)
    return { lignes, orphelins }
  }, [objets])

  /* ---- contrôles --------------------------------------------------- */
  const controles = useMemo(() => {
    const liste = []
    const avecPoly = objets.filter((o) => polys.get(o.id))
    for (let i = 0; i < avecPoly.length; i++) {
      for (let j = i + 1; j < avecPoly.length; j++) {
        const a = avecPoly[i]
        const b = avecPoly[j]
        const pa = polys.get(a.id)
        const pb = polys.get(b.id)
        // Les barrières se touchent par construction ; on ne les compare pas entre elles.
        const barrieres = a.calque === 'circulation' && b.calque === 'circulation'
        if (!barrieres && seChevauchent(pa, pb)) {
          liste.push({ gravite: 'chaud', type: 'Chevauchement', texte: `${a.nom} et ${b.nom} se chevauchent`, ids: [a.id, b.id] })
          continue
        }
        for (const [x, y, px, py] of [[a, b, pa, pb], [b, a, pb, pa]]) {
          const d = Number(x.distance_securite_m || 0)
          if (!d) continue
          if (!(y.accueil_public || estToile(y))) continue
          const dist = distancePolygones(px, py)
          if (dist < d) {
            liste.push({
              gravite: 'chaud',
              type: 'Distance de sécurité',
              texte: `${x.nom} à ${fr(dist, 1)} m de ${y.nom} (${fr(d, 1)} m requis)`,
              ids: [x.id, y.id]
            })
          }
        }
      }
    }
    const voies = elements.filter((e) => e.categorie === 'voie_engins' && e.forme === 'ligne' && (e.geometrie ?? []).length > 1)
    for (const v of voies) {
      for (const o of avecPoly) {
        const d = distancePolygoneLigne(polys.get(o.id), v.geometrie)
        if (d < LARGEUR_VOIE_ENGINS / 2) {
          liste.push({ gravite: 'veille', type: 'Voie engins', texte: `${o.nom} empiète sur « ${v.nom} » (${fr(d, 1)} m de l'axe, ${LARGEUR_VOIE_ENGINS} m de passage requis)`, ids: [o.id] })
        }
      }
    }
    const sansLieu = objets.filter((o) => !polys.get(o.id) && o.nature !== 'ligne')
    return { liste, sansLieu }
  }, [objets, polys, elements])

  /* ---- métré ------------------------------------------------------- */
  const metre = useMemo(() => {
    const par = new Map()
    for (const o of objets) {
      // Une ligne de barrières compte ses modules (quantite), pas son tracé.
      const ligne = o.nature === 'ligne'
      const cle = ligne ? `${o.fournisseur ?? ''}|${o.catalogue_id ?? o.nom}|${o.largeur_m}` : `${o.fournisseur ?? ''}|${o.catalogue_id ?? o.nom}|${o.largeur_m}|${o.longueur_m}`
      const l = par.get(cle) ?? { fournisseur: o.fournisseur ?? '', libelle: ligne ? `${o.nom} (modules de ${fr(o.largeur_m, 1)} m)` : o.nom, calque: o.calque, largeur: o.largeur_m, longueur: ligne ? null : o.longueur_m, n: 0, surface: 0, kw: 0, kva: 0, codes: [] }
      l.n += ligne ? Number(o.quantite ?? 0) : 1
      l.surface += surfaceObjet(o)
      l.kw += Number(o.puissance_kw || 0)
      l.kva += Number(o.production_kva || 0)
      l.codes.push(o.code)
      par.set(cle, l)
    }
    return [...par.values()].sort((a, b) => a.fournisseur.localeCompare(b.fournisseur) || a.libelle.localeCompare(b.libelle))
  }, [objets])

  function csv() {
    const lignes = [['Fournisseur', 'Équipement', 'Calque', 'Largeur (m)', 'Longueur (m)', 'Nombre', 'Surface (m²)', 'Consommation (kW)', 'Production (kVA)', 'Codes']]
    for (const l of metre) lignes.push([l.fournisseur, l.libelle, LIBELLE_CALQUE[l.calque] ?? '', fr(l.largeur, 2), fr(l.longueur, 2), l.n, fr(l.surface, 1), fr(l.kw, 1), fr(l.kva, 0), l.codes.join(' ')])
    const texte = lignes.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + texte], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'metre-implantation.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const nbChaud = controles.liste.filter((c) => c.gravite === 'chaud').length

  return (
    <div className="impl-bilans">
      <div className="onglets">
        {[
          ['controles', `Contrôles (${controles.liste.length})`],
          ['energie', 'Énergie'],
          ['eau', 'Eau'],
          ['metre', 'Métré']
        ].map(([k, l]) => (
          <button key={k} className={`module ${onglet === k ? 'actif' : ''}`} onClick={() => setOnglet(k)}>{l}</button>
        ))}
      </div>

      {onglet === 'controles' && (
        <section>
          <div className="etat prc-cadrans">
            <Cadran libelle="Chevauchements / distances" v={nbChaud} etat={nbChaud ? 'chaud' : ''} />
            <Cadran libelle="Voies engins encombrées" v={controles.liste.length - nbChaud} etat={controles.liste.length - nbChaud ? 'veille' : ''} />
            <Cadran libelle="Objets placés" v={objets.length} />
            <Cadran libelle="Non confirmés sur site" v={objets.filter((o) => !o.confirme).length} etat={objets.some((o) => !o.confirme) ? 'veille' : ''} />
          </div>
          {controles.liste.length === 0 ? (
            <p className="aide">Aucun chevauchement, aucune distance de sécurité en défaut, aucune voie engins encombrée.</p>
          ) : (
            <div className="prc-liste">
              {controles.liste.map((c, i) => (
                <div key={i} className="prc-ligne">
                  <span className={`prc-jeton ${c.gravite}`}>{c.type}</span>
                  <span>{c.texte}</span>
                </div>
              ))}
            </div>
          )}
          <p className="aide">
            Distance de sécurité : celle de l'objet (gaz, feu, groupe) vis-à-vis de ce qui reçoit du
            public et des toiles. Voie engins : {LARGEUR_VOIE_ENGINS} m de passage libre, mesuré
            depuis l'axe tracé dans le plan. Rien ici ne remplace l'avis de la zone de secours.
          </p>
        </section>
      )}

      {onglet === 'energie' && (
        <section>
          <div className="etat prc-cadrans">
            <Cadran libelle="Consommation totale" v={`${fr(energie.total, 1)} kW`} />
            <Cadran libelle="Production installée" v={`${fr(energie.prod, 0)} kVA`} />
            <Cadran libelle="Groupes" v={energie.lignes.length} />
            <Cadran libelle="Non raccordés" v={energie.orphelins.length} etat={energie.orphelins.length ? 'veille' : ''} />
          </div>
          {energie.lignes.map(({ g, conso, kw, kva, charge }) => (
            <div key={g.id} className={`prc-lieu ${charge > 0.8 ? 'chaud' : ''}`} style={{ marginBottom: 8 }}>
              <div className="prc-lieu-tete">
                <h4>{g.nom}</h4>
                <span className="prc-jeton">{g.code}</span>
              </div>
              <dl className="prc-chiffres">
                <div><dt>Produit</dt><dd>{fr(g.production_kva, 0)} kVA</dd></div>
                <div><dt>Demandé</dt><dd>{fr(kw, 1)} kW ≈ {fr(kva, 1)} kVA</dd></div>
                <div><dt>Charge</dt><dd className={charge > 0.8 ? 'chaud' : charge > 0.6 ? 'veille' : ''}>{Math.round(charge * 100)} %</dd></div>
              </dl>
              <div className="prc-liens">
                <div>Alimente : <span>{conso.map((o) => `${o.nom} (${fr(o.puissance_kw, 1)} kW)`).join(', ') || '—'}</span></div>
              </div>
            </div>
          ))}
          {energie.orphelins.length > 0 && (
            <>
              <h4 className="prc-titre">À raccorder</h4>
              <div className="prc-liste">
                {energie.orphelins.map((o) => (
                  <div key={o.id} className="prc-ligne"><span className="mono sourdine">{o.code}</span><span>{o.nom}</span><span className="mono" style={{ marginLeft: 'auto' }}>{fr(o.puissance_kw, 1)} kW</span></div>
                ))}
              </div>
            </>
          )}
          <p className="aide">kW → kVA avec cos φ {COS_PHI} ; au-delà de 80 % de charge, prévoir le foisonnement et les démarrages (frigos, pompes).</p>
        </section>
      )}

      {onglet === 'eau' && (
        <section>
          {eau.lignes.map(({ s, conso }) => (
            <div key={s.id} className="prc-lieu" style={{ marginBottom: 8 }}>
              <div className="prc-lieu-tete"><h4>{s.nom}</h4><span className="prc-jeton">{s.code}</span></div>
              <div className="prc-liens"><div>Alimente : <span>{conso.map((o) => o.nom).join(', ') || '—'}</span></div></div>
            </div>
          ))}
          {eau.lignes.length === 0 && <p className="aide">Aucun point d'eau placé.</p>}
          {eau.orphelins.length > 0 && (
            <>
              <h4 className="prc-titre">Besoins non raccordés</h4>
              <div className="prc-liste">
                {eau.orphelins.map((o) => <div key={o.id} className="prc-ligne"><span className="mono sourdine">{o.code}</span><span>{o.nom}</span></div>)}
              </div>
            </>
          )}
        </section>
      )}

      {onglet === 'metre' && (
        <section>
          <div className="ligne-boutons"><button className="discret" onClick={csv} disabled={!metre.length}>Exporter en CSV</button></div>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Fournisseur</th><th>Équipement</th><th>Calque</th><th>Dimensions</th><th>Nombre</th><th>Surface</th><th>kW</th><th>kVA</th></tr></thead>
              <tbody>
                {metre.map((l, i) => (
                  <tr key={i}>
                    <td>{l.fournisseur || <span className="sourdine">—</span>}</td>
                    <td>{l.libelle}</td>
                    <td><span className="impl-pastille" style={{ '--c': COULEUR_CALQUE[l.calque] }} /> {LIBELLE_CALQUE[l.calque] ?? ''}</td>
                    <td className="mono">{fr(l.largeur, 1)} × {fr(l.longueur, 1)} m</td>
                    <td className="mono">{l.n}</td>
                    <td className="mono">{fr(l.surface, 0)} m²</td>
                    <td className="mono">{l.kw ? fr(l.kw, 1) : ''}</td>
                    <td className="mono">{l.kva ? fr(l.kva, 0) : ''}</td>
                  </tr>
                ))}
                {metre.length === 0 && <tr><td colSpan={8} className="aide">Rien de placé.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="aide">Une ligne par équipement et par fournisseur. Surface : emprise au sol cumulée.</p>
        </section>
      )}
    </div>
  )
}

function Cadran({ libelle, v, etat = '' }) {
  return (
    <div className={`cadran ${etat}`}>
      <span className="cadran-libelle">{libelle}</span>
      <span className="cadran-valeur">{v}</span>
    </div>
  )
}
