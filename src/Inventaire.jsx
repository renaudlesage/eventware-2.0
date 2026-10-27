import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser, supprimerOuRefuser } from './ecriture'
import { euros } from './Fournisseurs'

/**
 * (138) Le matériel de l'organisation : inventaire, prêts et locations.
 *
 * Au niveau de l'organisation, comme l'annuaire (130) : une tente
 * achetée en 2024 sert à chaque événement et se loue entre deux. Deux
 * tableaux, triables et filtrables colonne par colonne, chacun
 * imprimable tel qu'il est affiché :
 *   — l'inventaire : code, description, quantité, emplacement, valeur
 *     HTVA, prix de location, et ce qui est sorti ;
 *   — les prêts et locations : qui, quoi, depuis quand, retour prévu,
 *     prix, responsable Buco ; « Retour » clôt la sortie.
 * Chaque article porte une étiquette : un QR (lien ?materiel=INV-0001)
 * et, sur Android, une puce NFC écrite depuis la fiche. Scanner l'un ou
 * l'autre ouvre la fiche de l'article, pour le sortir ou le rentrer sur
 * place, comme à la laverie.
 */

const NATURES = [['pret', 'Prêt'], ['location', 'Location']]
const STATUTS = { sorti: 'sorti', en_retard: 'en retard', rendu: 'rendu' }
const dateFr = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-BE') : '')
const aujourdhui = () => new Date().toISOString().slice(0, 10)
const jours = (a, b) => (a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000)) : 1)
/** Le lien que portent l'étiquette QR et la puce NFC. */
export const lienMateriel = (code) => `${window.location.origin}${window.location.pathname}?materiel=${encodeURIComponent(code)}`
/** Le code d'article dans ce qu'on a scanné : un lien, ou le code nu. */
export function codeDepuisLecture(texte) {
  if (!texte) return null
  const m = /[?&]materiel=([^&#\s]+)/.exec(texte)
  if (m) return decodeURIComponent(m[1]).toUpperCase()
  const c = /\b(INV-\d{3,})\b/i.exec(texte)
  return c ? c[1].toUpperCase() : null
}

export default function Inventaire({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const organisation = evenement.organisation_id
  const [droits, setDroits] = useState({ lire: true, gerer: false })
  const [articles, setArticles] = useState(null)
  const [prets, setPrets] = useState(null)
  const [vue, setVue] = useState('inventaire')
  const [ouvert, setOuvert] = useState(null)        // id d'article
  const [creation, setCreation] = useState(false)
  const [sortie, setSortie] = useState(null)        // { article } : nouveau prêt
  const demande = useRef(new URLSearchParams(window.location.search).get('materiel'))

  async function charger() {
    const [d, a, p] = await Promise.all([
      supabase.rpc('mes_droits_annuaire', { p_organisation: organisation }),
      supabase.from('inventaire_etat').select('*').eq('organisation_id', organisation).order('code'),
      supabase.from('prets_inventaire_vue').select('*').eq('organisation_id', organisation).order('date_sortie', { ascending: false })
    ])
    if (d.data?.[0]) setDroits(d.data[0])
    if (a.error) setMessage({ type: 'erreur', texte: texteErreur(a.error) })
    setArticles(a.data ?? [])
    setPrets(p.data ?? [])
  }
  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation])

  // Arrivée par une étiquette (?materiel=INV-0001) : la fiche s'ouvre d'elle-même.
  useEffect(() => {
    if (!articles || !demande.current) return
    ouvrirCode(demande.current)
    demande.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles])

  function ouvrirCode(code) {
    const c = codeDepuisLecture(code) ?? String(code).trim().toUpperCase()
    const a = (articles ?? []).find((x) => x.code === c)
    if (a) { setOuvert(a.id); setVue('inventaire') } else setMessage({ type: 'erreur', texte: `Aucun article « ${c} » dans l'inventaire.` })
    return !!a
  }

  const peutGerer = droits.gerer
  const article = articles?.find((a) => a.id === ouvert)

  if (articles === null || prets === null) return <p className="vide">…</p>

  return (
    <div className="inv">
      <div className="onglets">
        {[['inventaire', `Inventaire (${articles.length})`], ['prets', `Prêts et locations (${prets.filter((p) => p.statut !== 'rendu').length} sortis)`], ['etiquettes', 'Étiquettes'], ['scanner', 'Scanner']].map(([k, l]) => (
          <button key={k} className={`module ${vue === k ? 'actif' : ''}`} onClick={() => { setVue(k); setOuvert(null) }}>{l}</button>
        ))}
      </div>

      {article && (
        <FicheArticle article={article} prets={prets.filter((p) => p.inventaire_id === article.id)} peutGerer={peutGerer} setMessage={setMessage}
          onFermer={() => setOuvert(null)} onFait={charger} onSortir={() => setSortie({ article })} />
      )}
      {creation && (
        <FicheArticle article={null} organisation={organisation} prets={[]} peutGerer setMessage={setMessage}
          onFermer={() => setCreation(false)} onFait={charger} />
      )}
      {sortie && (
        <FormPret organisation={organisation} articles={articles} article={sortie.article} membre={membre} setMessage={setMessage}
          onFermer={() => setSortie(null)} onFait={() => { setSortie(null); charger() }} />
      )}

      {vue === 'inventaire' && !article && !creation && (
        <TableInventaire articles={articles} peutGerer={peutGerer} onOuvrir={(a) => setOuvert(a.id)} onCreer={() => setCreation(true)} onSortir={(a) => setSortie({ article: a })} organisation={organisation} />
      )}
      {vue === 'prets' && !sortie && (
        <TablePrets prets={prets} peutGerer={peutGerer} setMessage={setMessage} onFait={charger} onNouveau={() => setSortie({ article: null })} onArticle={(id) => { setOuvert(id); setVue('inventaire') }} />
      )}
      {vue === 'etiquettes' && <Etiquettes articles={articles} />}
      {vue === 'scanner' && <Scanner onCode={ouvrirCode} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un tableau triable et filtrable colonne par colonne, imprimable      */

function Tableau({ colonnes, lignes, cle, vide, classeLigne, titre, impression }) {
  const [tri, setTri] = useState({ clef: colonnes[0].clef, sens: 1 })
  const [filtres, setFiltres] = useState({})

  const visibles = useMemo(() => {
    const f = Object.entries(filtres).filter(([, v]) => v)
    const col = colonnes.find((c) => c.clef === tri.clef)
    const valeur = (l, c) => (c.tri ? c.tri(l) : l[c.clef])
    return lignes
      .filter((l) => f.every(([k, v]) => {
        const c = colonnes.find((x) => x.clef === k)
        const t = c?.texte ? c.texte(l) : l[k]
        return String(t ?? '').toLowerCase().includes(v.toLowerCase())
      }))
      .sort((a, b) => {
        const x = valeur(a, col), y = valeur(b, col)
        if (x == null && y == null) return 0
        if (x == null) return 1
        if (y == null) return -1
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * tri.sens
      })
  }, [lignes, colonnes, tri, filtres])

  function trier(clef) {
    setTri((t) => (t.clef === clef ? { clef, sens: -t.sens } : { clef, sens: 1 }))
  }

  function imprimer() {
    const w = window.open('', '_blank')
    if (!w) return
    const entetes = colonnes.map((c) => `<th>${c.libelle}</th>`).join('')
    const corps = visibles.map((l) => `<tr>${colonnes.map((c) => `<td>${echapper(c.texte ? c.texte(l) : l[c.clef])}</td>`).join('')}</tr>`).join('')
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapper(titre)}</title>
      <style>body{font:12px/1.4 system-ui,sans-serif;margin:16mm}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#555}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #ccc;vertical-align:top}th{font-size:10px;text-transform:uppercase;letter-spacing:.06em}@media print{@page{size:A4 landscape;margin:12mm}}</style></head>
      <body><h1>${echapper(titre)}</h1><p>${echapper(impression ?? '')} · ${visibles.length} ligne${visibles.length > 1 ? 's' : ''} · imprimé le ${new Date().toLocaleDateString('fr-BE')}</p>
      <table><thead><tr>${entetes}</tr></thead><tbody>${corps}</tbody></table>
      <script>window.print()</script></body></html>`)
    w.document.close()
  }

  return (
    <div className="inv-tableau tableau-defilant">
      <div className="inv-tableau-outils">
        <span className="aide" style={{ margin: 0 }}>{visibles.length} sur {lignes.length} · clique un en-tête pour trier, tape sous un en-tête pour filtrer.</span>
        <button className="discret" onClick={imprimer} disabled={!visibles.length}>Imprimer / PDF</button>
        {Object.values(filtres).some(Boolean) && <button className="lien" onClick={() => setFiltres({})}>Effacer les filtres</button>}
      </div>
      <table className="tableau">
        <thead>
          <tr>
            {colonnes.map((c) => (
              <th key={c.clef} className={`inv-th ${tri.clef === c.clef ? 'actif' : ''} ${c.numerique ? 'num' : ''}`} onClick={() => trier(c.clef)} title="Trier">
                {c.libelle}{tri.clef === c.clef ? (tri.sens > 0 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
          <tr className="inv-filtres">
            {colonnes.map((c) => (
              <th key={c.clef}>
                {c.filtre !== false && (
                  <input value={filtres[c.clef] ?? ''} onChange={(e) => setFiltres((f) => ({ ...f, [c.clef]: e.target.value }))} placeholder="filtrer" aria-label={`Filtrer ${c.libelle}`} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibles.length === 0 && <tr><td colSpan={colonnes.length} className="vide">{vide}</td></tr>}
          {visibles.map((l) => (
            <tr key={cle(l)} className={classeLigne?.(l) ?? ''}>
              {colonnes.map((c) => <td key={c.clef} className={c.numerique ? 'mono num' : ''}>{c.rendu ? c.rendu(l) : l[c.clef]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const echapper = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* ------------------------------------------------------------------ */
/* L'inventaire                                                        */

function TableInventaire({ articles, peutGerer, onOuvrir, onCreer, onSortir }) {
  const colonnes = [
    { clef: 'code', libelle: 'Code', rendu: (a) => <button className="lien mono" onClick={() => onOuvrir(a)}>{a.code}</button> },
    { clef: 'description', libelle: 'Description', rendu: (a) => <button className="lien" onClick={() => onOuvrir(a)}><strong>{a.description}</strong></button> },
    { clef: 'categorie', libelle: 'Catégorie' },
    { clef: 'quantite', libelle: 'Qté', numerique: true, filtre: false },
    { clef: 'disponible', libelle: 'Dispo', numerique: true, filtre: false, rendu: (a) => <span className={a.disponible < a.quantite ? 'inv-sorti' : ''}>{a.disponible}{a.sorti ? <span className="aide" style={{ margin: 0 }}> ({a.sorti} sorti{a.sorti > 1 ? 's' : ''})</span> : null}</span> },
    { clef: 'emplacement', libelle: 'Emplacement' },
    { clef: 'valeur_htva', libelle: 'Valeur HTVA', numerique: true, filtre: false, texte: (a) => (a.valeur_htva != null ? euros(a.valeur_htva) : ''), rendu: (a) => (a.valeur_htva != null ? euros(a.valeur_htva) : '—') },
    { clef: 'prix_location', libelle: 'Location / jour', numerique: true, filtre: false, texte: (a) => (a.prix_location != null ? euros(a.prix_location) : ''), rendu: (a) => (a.prix_location != null ? euros(a.prix_location) : '—') }
  ]
  if (peutGerer) colonnes.push({ clef: 'actions', libelle: '', filtre: false, texte: () => '', rendu: (a) => <button className="discret inv-sortir" disabled={a.disponible <= 0} onClick={() => onSortir(a)}>Sortir</button> })
  const total = articles.reduce((s, a) => s + Number(a.valeur_htva ?? 0) * Number(a.quantite ?? 0), 0)
  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 8 }}>
        {peutGerer && <button onClick={onCreer}>Ajouter un article</button>}
        <span className="aide" style={{ margin: 0, alignSelf: 'center' }}>Valeur totale HTVA : <strong>{euros(total)}</strong></span>
      </div>
      <Tableau colonnes={colonnes} lignes={articles} cle={(a) => a.id} vide="Aucun article : l'inventaire se remplit avec « Ajouter un article »." titre="Inventaire du matériel" impression={`Valeur totale HTVA ${euros(total)}`} classeLigne={(a) => (a.actif ? '' : 'four-inactif')} />
    </>
  )
}

const VIDE = { description: '', categorie: '', quantite: 1, emplacement: '', valeur_htva: '', prix_location: '', notes: '', actif: true }

function FicheArticle({ article, organisation, prets, peutGerer, setMessage, onFermer, onFait, onSortir }) {
  const [v, setV] = useState(() => (article ? { ...VIDE, ...article, valeur_htva: article.valeur_htva ?? '', prix_location: article.prix_location ?? '' } : VIDE))
  const [occupe, setOccupe] = useState(false)
  const [nfc, setNfc] = useState(null)
  const champ = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const lecture = !peutGerer

  async function enregistrer() {
    if (!v.description.trim()) { setMessage({ type: 'erreur', texte: 'La description est obligatoire.' }); return }
    setOccupe(true)
    const champs = {
      description: v.description.trim(), categorie: v.categorie || null, quantite: Number(v.quantite) || 0, emplacement: v.emplacement || null,
      valeur_htva: v.valeur_htva === '' ? null : Number(v.valeur_htva), prix_location: v.prix_location === '' ? null : Number(v.prix_location),
      notes: v.notes || null, actif: !!v.actif
    }
    if (article) {
      const refus = await modifierOuRefuser('inventaire', champs, { id: article.id })
      if (refus) setMessage({ type: 'erreur', texte: refus })
      else { setMessage({ type: 'info', texte: 'Article enregistré.' }); onFait(); onFermer() }
    } else {
      const { error } = await supabase.from('inventaire').insert({ ...champs, organisation_id: organisation })
      if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
      else { setMessage({ type: 'info', texte: 'Article ajouté : son code et son étiquette sont dans la fiche.' }); onFait(); onFermer() }
    }
    setOccupe(false)
  }

  async function supprimer() {
    if (!window.confirm(`Retirer « ${article.description} » de l'inventaire ? Ses sorties passées restent lisibles.`)) return
    const refus = await supprimerOuRefuser('inventaire', article.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { onFermer(); onFait() }
  }

  // (138) Une puce NFC sur l'objet : Chrome Android sait l'écrire.
  async function ecrireNfc() {
    if (!('NDEFReader' in window)) { setNfc('Ce navigateur ne sait pas écrire de puce NFC (Chrome sur Android le fait).'); return }
    try {
      setNfc('Approche la puce du téléphone…')
      const lecteur = new window.NDEFReader()
      await lecteur.write({ records: [{ recordType: 'url', data: lienMateriel(article.code) }] })
      setNfc(`Puce écrite : ${article.code}. Un téléphone qui la touche ouvre cette fiche.`)
    } catch (e) {
      setNfc(`Écriture impossible : ${e?.message ?? e}`)
    }
  }

  return (
    <div className="bloc inv-fiche four-fiche">
      <div className="four-fiche-tete">
        <div>
          {article ? <span className="prc-jeton mono">{article.code}</span> : <strong>Nouvel article</strong>}
          {article && <strong style={{ marginLeft: 8 }}>{article.description}</strong>}
          {article && article.sorti > 0 && <span className="inv-sorti" style={{ marginLeft: 8 }}>{article.sorti} sorti{article.sorti > 1 ? 's' : ''}</span>}
        </div>
        <div className="ligne-boutons">
          {article && peutGerer && <button onClick={onSortir} disabled={article.disponible <= 0}>Sortir / louer</button>}
          <button className="discret" onClick={onFermer}>Fermer</button>
        </div>
      </div>
      <div className="inv-fiche-corps">
        <div className="four-grille">
          <label className="four-large">Description<input value={v.description} onChange={champ('description')} disabled={lecture} placeholder="Tente 3 × 3 m blanche, sono 2 × 300 W…" /></label>
          <label>Catégorie<input value={v.categorie ?? ''} onChange={champ('categorie')} disabled={lecture} placeholder="tentes, sono, électricité…" /></label>
          <label>Quantité<input type="number" min="0" value={v.quantite} onChange={champ('quantite')} disabled={lecture} /></label>
          <label>Emplacement<input value={v.emplacement ?? ''} onChange={champ('emplacement')} disabled={lecture} placeholder="hangar, étagère B3, remorque…" /></label>
          <label>Valeur unitaire HTVA (€)<input type="number" min="0" step="0.01" value={v.valeur_htva} onChange={champ('valeur_htva')} disabled={lecture} /></label>
          <label>Prix de location par jour HTVA (€)<input type="number" min="0" step="0.01" value={v.prix_location} onChange={champ('prix_location')} disabled={lecture} placeholder="vide : ne se loue pas" /></label>
          <label className="four-large">Notes<textarea rows={2} value={v.notes ?? ''} onChange={champ('notes')} disabled={lecture} /></label>
          {!lecture && <label className="case-a-cocher four-large"><input type="checkbox" checked={!!v.actif} onChange={champ('actif')} /> En service (décoché : réformé, cassé, vendu)</label>}
        </div>
        {article && (
          <div className="inv-etiquette">
            <QRCodeSVG value={lienMateriel(article.code)} size={120} level="M" includeMargin />
            <div className="mono">{article.code}</div>
            <div className="aide" style={{ margin: 0 }}>Scanner ce QR ouvre cette fiche.</div>
            {peutGerer && <button className="discret" onClick={ecrireNfc}>Écrire une puce NFC</button>}
            {nfc && <div className="aide" style={{ margin: 0 }}>{nfc}</div>}
          </div>
        )}
      </div>
      {!lecture && (
        <div className="ligne-boutons" style={{ marginTop: 10 }}>
          <button onClick={enregistrer} disabled={occupe}>{article ? 'Enregistrer' : 'Ajouter'}</button>
          {article && <button className="discret danger-texte" onClick={supprimer}>Retirer de l'inventaire</button>}
        </div>
      )}
      {article && (
        <>
          <h3>Sorties ({prets.length})</h3>
          {prets.length === 0 ? <p className="aide">Jamais sorti.</p> : (
            <table className="tableau">
              <thead><tr><th>Statut</th><th>Qté</th><th>Pour</th><th>Sortie</th><th>Retour prévu</th><th>Retour</th><th>Prix</th><th>Responsable</th></tr></thead>
              <tbody>
                {prets.map((p) => (
                  <tr key={p.id}>
                    <td><span className={`inv-statut ${p.statut}`}>{STATUTS[p.statut]}</span></td>
                    <td className="mono">{p.quantite}</td>
                    <td>{p.loueur}</td>
                    <td className="mono">{dateFr(p.date_sortie)}</td>
                    <td className="mono">{dateFr(p.date_retour_prevue)}</td>
                    <td className="mono">{dateFr(p.date_retour)}</td>
                    <td className="mono">{euros(p.prix)}</td>
                    <td>{p.responsable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Les prêts et locations                                              */

function TablePrets({ prets, peutGerer, setMessage, onFait, onNouveau, onArticle }) {
  async function retour(p) {
    if (!window.confirm(`Retour de « ${p.materiel} » (${p.quantite}) par ${p.loueur} aujourd'hui ?`)) return
    const refus = await modifierOuRefuser('prets_inventaire', { date_retour: aujourdhui() }, { id: p.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else onFait()
  }
  async function annuler(p) {
    if (!window.confirm(`Supprimer cette sortie (${p.materiel} pour ${p.loueur}) ? Pour un retour, utilise « Retour ».`)) return
    const refus = await supprimerOuRefuser('prets_inventaire', p.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else onFait()
  }
  const colonnes = [
    { clef: 'statut', libelle: 'Statut', texte: (p) => STATUTS[p.statut], tri: (p) => ({ en_retard: 0, sorti: 1, rendu: 2 }[p.statut]), rendu: (p) => <span className={`inv-statut ${p.statut}`}>{STATUTS[p.statut]}</span> },
    { clef: 'loueur', libelle: 'Loueur / emprunteur', rendu: (p) => <><strong>{p.loueur}</strong>{p.loueur_contact && <div className="aide" style={{ margin: 0 }}>{p.loueur_contact}</div>}</> },
    { clef: 'materiel', libelle: 'Matériel', texte: (p) => `${p.materiel_code} ${p.materiel}`, rendu: (p) => <button className="lien" onClick={() => onArticle(p.inventaire_id)}>{p.materiel} <span className="mono sourdine">{p.materiel_code}</span></button> },
    { clef: 'quantite', libelle: 'Qté', numerique: true, filtre: false },
    { clef: 'nature', libelle: 'Nature', texte: (p) => (p.nature === 'location' ? 'location' : 'prêt'), rendu: (p) => (p.nature === 'location' ? 'location' : 'prêt') },
    { clef: 'date_sortie', libelle: 'Sortie', texte: (p) => dateFr(p.date_sortie), rendu: (p) => <span className="mono">{dateFr(p.date_sortie)}</span> },
    { clef: 'date_retour_prevue', libelle: 'Retour prévu', texte: (p) => dateFr(p.date_retour_prevue), rendu: (p) => <span className="mono">{dateFr(p.date_retour_prevue)}</span> },
    { clef: 'date_retour', libelle: 'Retour', texte: (p) => dateFr(p.date_retour), rendu: (p) => <span className="mono">{dateFr(p.date_retour)}</span> },
    { clef: 'prix', libelle: 'Prix', numerique: true, filtre: false, texte: (p) => euros(p.prix), rendu: (p) => euros(p.prix) },
    { clef: 'responsable', libelle: 'Responsable Buco' }
  ]
  if (peutGerer) colonnes.push({ clef: 'actions', libelle: '', filtre: false, texte: () => '', rendu: (p) => (
    <span className="ligne-boutons" style={{ flexWrap: 'nowrap' }}>
      {p.statut !== 'rendu' && <button className="discret inv-retour" onClick={() => retour(p)}>Retour</button>}
      <button className="discret" onClick={() => imprimerBon(p)} title="Bon de sortie">Bon</button>
      <button className="lien danger-texte" onClick={() => annuler(p)} aria-label="Supprimer la sortie">✕</button>
    </span>
  ) })
  const sortis = prets.filter((p) => p.statut !== 'rendu')
  const encaisse = prets.filter((p) => p.nature === 'location').reduce((s, p) => s + Number(p.prix ?? 0), 0)
  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 8 }}>
        {peutGerer && <button onClick={onNouveau}>Nouveau prêt ou location</button>}
        <span className="aide" style={{ margin: 0, alignSelf: 'center' }}>
          {sortis.length} sortie{sortis.length > 1 ? 's' : ''} en cours{sortis.some((p) => p.statut === 'en_retard') ? `, dont ${sortis.filter((p) => p.statut === 'en_retard').length} en retard` : ''} · locations : <strong>{euros(encaisse)}</strong>
        </span>
      </div>
      <Tableau colonnes={colonnes} lignes={prets} cle={(p) => p.id} vide="Aucune sortie : « Nouveau prêt ou location », ou « Sortir » depuis un article." titre="Prêts et locations de matériel" impression="Sorties, retours, prix convenus" classeLigne={(p) => (p.statut === 'rendu' ? 'four-inactif' : p.statut === 'en_retard' ? 'inv-ligne-retard' : '')} />
    </>
  )
}

function imprimerBon(p) {
  const w = window.open('', '_blank')
  if (!w) return
  const l = (t, v) => `<tr><th>${t}</th><td>${echapper(v ?? '—')}</td></tr>`
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bon de sortie ${echapper(p.materiel_code)}</title>
    <style>body{font:13px/1.5 system-ui,sans-serif;margin:18mm;max-width:700px}h1{font-size:20px;margin:0 0 2px}table{border-collapse:collapse;width:100%;margin:12px 0}th{text-align:left;width:34%;padding:5px 6px;color:#555;font-weight:600}td{padding:5px 6px}tr{border-bottom:1px solid #ddd}.sig{display:flex;gap:30px;margin-top:40px}.sig div{flex:1;border-top:1px solid #000;padding-top:4px;font-size:12px}</style></head>
    <body><h1>Bon de ${p.nature === 'location' ? 'location' : 'prêt'} — ${echapper(p.materiel_code)}</h1>
    <table>${l('Matériel', `${p.materiel} (× ${p.quantite})`)}${l(p.nature === 'location' ? 'Loueur' : 'Emprunteur', p.loueur)}${l('Contact', p.loueur_contact)}${l('Sortie le', dateFr(p.date_sortie))}${l('Retour prévu le', dateFr(p.date_retour_prevue))}${l('Retour effectif le', dateFr(p.date_retour))}${l('Prix convenu', euros(p.prix))}${l('Responsable', p.responsable)}${l('Notes', p.notes)}</table>
    <p>Le matériel est rendu propre, complet et en état ; toute casse ou perte est due à sa valeur de remplacement.</p>
    <div class="sig"><div>Pour l'organisation</div><div>${p.nature === 'location' ? 'Le loueur' : 'L’emprunteur'}</div></div>
    <script>window.print()</script></body></html>`)
  w.document.close()
}

function FormPret({ organisation, articles, article, membre, setMessage, onFermer, onFait }) {
  const [v, setV] = useState({
    inventaire_id: article?.id ?? '', quantite: 1, nature: article?.prix_location != null ? 'location' : 'pret', loueur: '', loueur_contact: '',
    date_sortie: aujourdhui(), date_retour_prevue: '', prix: '', responsable: membre?.nom_affiche ?? '', notes: ''
  })
  const [occupe, setOccupe] = useState(false)
  const champ = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  const choisi = articles.find((a) => a.id === v.inventaire_id)
  // Une location : le prix se propose (jours × prix par jour × quantité) tant qu'on ne l'a pas touché.
  const propose = choisi?.prix_location != null && v.nature === 'location'
    ? Number(choisi.prix_location) * jours(v.date_sortie, v.date_retour_prevue) * (Number(v.quantite) || 1) : null

  async function enregistrer() {
    if (!v.inventaire_id) { setMessage({ type: 'erreur', texte: 'Choisis un article.' }); return }
    if (!v.loueur.trim()) { setMessage({ type: 'erreur', texte: 'Le nom du loueur ou de l’emprunteur est obligatoire.' }); return }
    if (choisi && Number(v.quantite) > choisi.disponible) { setMessage({ type: 'erreur', texte: `Seulement ${choisi.disponible} disponible${choisi.disponible > 1 ? 's' : ''} sur ${choisi.quantite}.` }); return }
    setOccupe(true)
    const { error } = await supabase.from('prets_inventaire').insert({
      organisation_id: organisation, inventaire_id: v.inventaire_id, quantite: Number(v.quantite) || 1, nature: v.nature,
      loueur: v.loueur.trim(), loueur_contact: v.loueur_contact || null, date_sortie: v.date_sortie, date_retour_prevue: v.date_retour_prevue || null,
      prix: v.prix === '' ? (propose ?? 0) : Number(v.prix), responsable: v.responsable || null, notes: v.notes || null
    })
    setOccupe(false)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { setMessage({ type: 'info', texte: 'Sortie enregistrée.' }); onFait() }
  }

  return (
    <div className="bloc inv-fiche four-fiche">
      <div className="four-fiche-tete">
        <strong>Nouveau prêt ou location</strong>
        <button className="discret" onClick={onFermer}>Annuler</button>
      </div>
      <div className="four-grille">
        <label className="four-large">Matériel
          <select value={v.inventaire_id} onChange={champ('inventaire_id')}>
            <option value="">— choisir dans l'inventaire —</option>
            {articles.filter((a) => a.actif).map((a) => <option key={a.id} value={a.id} disabled={a.disponible <= 0}>{a.code} · {a.description} ({a.disponible} dispo{a.emplacement ? `, ${a.emplacement}` : ''})</option>)}
          </select>
        </label>
        <label>Quantité<input type="number" min="1" max={choisi?.disponible ?? undefined} value={v.quantite} onChange={champ('quantite')} /></label>
        <label>Nature<select value={v.nature} onChange={champ('nature')}>{NATURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Nom du loueur / emprunteur<input value={v.loueur} onChange={champ('loueur')} placeholder="Comité des fêtes de Ferrières, Jean Dupont…" /></label>
        <label>Contact<input value={v.loueur_contact} onChange={champ('loueur_contact')} placeholder="téléphone, e-mail" /></label>
        <label>Date de sortie<input type="date" value={v.date_sortie} onChange={champ('date_sortie')} /></label>
        <label>Retour prévu<input type="date" value={v.date_retour_prevue} min={v.date_sortie} onChange={champ('date_retour_prevue')} /></label>
        <label>Prix convenu (€){propose != null && v.prix === '' ? <span className="aide" style={{ margin: 0, textTransform: 'none' }}>proposé : {euros(propose)}</span> : null}
          <input type="number" min="0" step="0.01" value={v.prix} onChange={champ('prix')} placeholder={propose != null ? String(propose) : '0 pour un prêt'} />
        </label>
        <label>Responsable Buco<input value={v.responsable} onChange={champ('responsable')} /></label>
        <label className="four-large">Notes<textarea rows={2} value={v.notes} onChange={champ('notes')} placeholder="état au départ, accessoires fournis, caution…" /></label>
      </div>
      <div className="ligne-boutons" style={{ marginTop: 10 }}>
        <button onClick={enregistrer} disabled={occupe}>Enregistrer la sortie</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Étiquettes et scanner                                               */

function Etiquettes({ articles }) {
  const [choisis, setChoisis] = useState(() => articles.map((a) => a.id))
  const [taille, setTaille] = useState(110)
  const basculer = (id) => setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const planche = articles.filter((a) => choisis.includes(a.id))
  return (
    <div className="inv-etiquettes">
      <p className="aide" style={{ marginTop: 0 }}>
        Une étiquette par article : le QR porte le lien de sa fiche. À imprimer sur papier autocollant, ou à écrire sur une puce NFC depuis la fiche de l'article (Chrome sur Android). Scanner l'étiquette ouvre la fiche, pour sortir ou rentrer l'objet sur place.
      </p>
      <div className="ligne-boutons" style={{ marginBottom: 8 }}>
        <button className="discret" onClick={() => setChoisis(articles.map((a) => a.id))}>Tout</button>
        <button className="discret" onClick={() => setChoisis([])}>Rien</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>Taille <input type="range" min="70" max="200" value={taille} onChange={(e) => setTaille(Number(e.target.value))} style={{ margin: 0 }} /></label>
        <button onClick={() => window.print()} disabled={!planche.length}>Imprimer les étiquettes</button>
      </div>
      <div className="inv-choix">
        {articles.map((a) => (
          <label key={a.id} className="case-a-cocher"><input type="checkbox" checked={choisis.includes(a.id)} onChange={() => basculer(a.id)} /> <span className="mono">{a.code}</span> {a.description}</label>
        ))}
      </div>
      <div className="inv-planche">
        {planche.map((a) => (
          <div key={a.id} className="inv-etiquette-carte">
            <QRCodeSVG value={lienMateriel(a.code)} size={taille} level="M" includeMargin />
            <div className="mono">{a.code}</div>
            <div className="inv-etiquette-nom">{a.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Scanner({ onCode }) {
  const [etat, setEtat] = useState('arret')   // arret | camera | nfc
  const [texte, setTexte] = useState('')
  const [info, setInfo] = useState(null)
  const video = useRef(null)
  const flux = useRef(null)
  const detecteurQr = typeof window !== 'undefined' && 'BarcodeDetector' in window
  const nfcPossible = typeof window !== 'undefined' && 'NDEFReader' in window

  useEffect(() => () => arreter(), [])

  function arreter() {
    flux.current?.getTracks().forEach((t) => t.stop())
    flux.current = null
    setEtat('arret')
  }

  async function camera() {
    if (!detecteurQr) { setInfo('Ce navigateur ne lit pas les QR dans la page : utilise l’appareil photo du téléphone, il ouvre le lien de l’étiquette.'); return }
    try {
      const f = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      flux.current = f
      video.current.srcObject = f
      await video.current.play()
      setEtat('camera')
      setInfo('Vise l’étiquette…')
      const d = new window.BarcodeDetector({ formats: ['qr_code'] })
      const boucle = async () => {
        if (!flux.current) return
        try {
          const codes = await d.detect(video.current)
          const code = codes.map((c) => codeDepuisLecture(c.rawValue)).find(Boolean)
          if (code) { arreter(); if (onCode(code)) return }
        } catch { /* une image non prête : on réessaie */ }
        setTimeout(boucle, 250)
      }
      boucle()
    } catch (e) {
      setInfo(`Caméra indisponible : ${e?.message ?? e}`)
    }
  }

  async function nfc() {
    if (!nfcPossible) { setInfo('Ce navigateur ne lit pas les puces NFC (Chrome sur Android le fait).'); return }
    try {
      const lecteur = new window.NDEFReader()
      await lecteur.scan()
      setEtat('nfc')
      setInfo('Approche la puce du téléphone…')
      lecteur.onreading = (ev) => {
        for (const r of ev.message.records) {
          const brut = r.recordType === 'url' || r.recordType === 'text' ? new TextDecoder(r.encoding ?? 'utf-8').decode(r.data) : ''
          const code = codeDepuisLecture(brut)
          if (code) { setEtat('arret'); onCode(code); return }
        }
        setInfo('Puce lue, mais sans code d’article dessus.')
      }
    } catch (e) {
      setInfo(`Lecture NFC impossible : ${e?.message ?? e}`)
    }
  }

  return (
    <div className="inv-scanner">
      <p className="aide" style={{ marginTop: 0 }}>
        Scanner l'étiquette d'un objet ouvre sa fiche : on le sort ou on le rentre sur place, sans chercher dans la liste. Le plus simple reste l'appareil photo du téléphone : le QR est un lien vers l'application.
      </p>
      <div className="ligne-boutons">
        {etat !== 'camera' ? <button onClick={camera}>Scanner un QR (caméra)</button> : <button className="discret" onClick={arreter}>Arrêter la caméra</button>}
        <button className="discret" onClick={nfc} disabled={etat === 'nfc'}>Lire une puce NFC</button>
      </div>
      <video ref={video} className="inv-video" style={{ display: etat === 'camera' ? 'block' : 'none' }} muted playsInline />
      {info && <p className="aide">{info}</p>}
      <form className="saisie-rapide" onSubmit={(e) => { e.preventDefault(); if (onCode(texte)) setTexte('') }}>
        <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="ou tape le code : INV-0001" />
        <button type="submit" className="discret">Ouvrir</button>
      </form>
    </div>
  )
}
