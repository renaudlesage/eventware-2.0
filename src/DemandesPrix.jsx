import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser, supprimerOuRefuser } from './ecriture'
import PiecesJointes from './PiecesJointes'
import { euros } from './Fournisseurs'
import {
  CATEGORIES_FOURNISSEUR, libelleCategorieFournisseur, libelleVerdict,
  STATUTS_DEMANDE_PRIX, STATUTS_CONSULTATION, STATUTS_COMMANDE, libelleDe, TAUX_TVA, UNITES_LIGNE
} from './referentielsProduit'

/**
 * Demandes de prix (131) — par événement.
 *
 * Une demande consulte plusieurs fournisseurs de l'annuaire (130) :
 * lignes, offres reçues, grille de comparaison, décision tracée (motif
 * obligatoire, main courante, commande), suivi par un jalon créé au
 * premier envoi. Le statut de la demande est dérivé par la base ; on
 * ne le saisit pas, sauf « close ».
 *
 * Pas d'e-mail depuis l'application : « Envoyer » ouvre le client mail
 * (mailto: prérempli) et marque la consultation envoyée ; l'utilisateur
 * joint lui-même le PDF, imprimé d'ici en A4 portrait.
 *
 * Montants HT + taux de TVA, TTC calculé à l'affichage. Sous 940 px :
 * liste et fiche en lecture, saisie d'une offre possible (on reçoit un
 * prix au téléphone sur le terrain), pas la grille.
 */

const jjmm = (s) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' }) : '')
const jjmmaa = (s) => (s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')
const jjmmHeure = (s) => (s ? new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
/** Un timestamptz → valeur d'un <input type="datetime-local">, en heure locale. */
function versLocal(s) {
  if (!s) return ''
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const depuisLocal = (v) => (v ? new Date(v).toISOString() : null)
const ttc = (ht, taux) => (ht == null ? null : Math.round(Number(ht) * (1 + Number(taux ?? 21) / 100) * 100) / 100)

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

export default function DemandesPrix({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState(null)
  const [filtre, setFiltre] = useState({ statut: '', categorie: '', moi: false })
  const [selection, setSelection] = useState(null)
  const [creation, setCreation] = useState(false)
  const etroit = useEtroit()
  const peutCreer = toutPouvoir || peut?.('logistique', 'creer')
  const peutModifier = toutPouvoir || peut?.('logistique', 'modifier')

  async function charger() {
    const { data, error } = await supabase.rpc('demandes_prix_vue', { p_evenement: evenement.id })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    setLignes(data ?? [])
  }
  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  const visibles = useMemo(() => (lignes ?? []).filter((d) =>
    (!filtre.statut || d.statut === filtre.statut) &&
    (!filtre.categorie || d.categorie === filtre.categorie) &&
    (!filtre.moi || d.responsable_membre_id === membre?.id)
  ), [lignes, filtre, membre?.id])

  if (lignes === null) return <p className="aide">Chargement…</p>
  const ouverte = selection ? lignes.find((d) => d.id === selection) : null
  const enRetard = lignes.filter((d) => d.en_retard).length

  return (
    <div className="dp">
      <div className="compteurs">
        <span>Demandes <strong>{lignes.length}</strong></span>
        <span className={enRetard ? 'alerte-texte' : ''}>En retard <strong>{enRetard}</strong></span>
        <span>Statut
          <select value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value })} style={{ width: 'auto', marginLeft: 6, marginBottom: 0 }}>
            <option value="">tous</option>
            {STATUTS_DEMANDE_PRIX.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </span>
        <span>Catégorie
          <select value={filtre.categorie} onChange={(e) => setFiltre({ ...filtre, categorie: e.target.value })} style={{ width: 'auto', marginLeft: 6, marginBottom: 0 }}>
            <option value="">toutes</option>
            {CATEGORIES_FOURNISSEUR.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </span>
        <label className="case-a-cocher" style={{ margin: 0 }}>
          <input type="checkbox" checked={filtre.moi} onChange={(e) => setFiltre({ ...filtre, moi: e.target.checked })} /> à traiter par moi
        </label>
      </div>

      {peutCreer && (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          <button onClick={() => { setCreation(!creation); setSelection(null) }}>{creation ? 'Fermer' : '+ Nouvelle demande de prix'}</button>
        </div>
      )}
      {creation && (
        <FormDemande evenement={evenement} membre={membre} setMessage={setMessage}
          onFait={async (id) => { setCreation(false); await charger(); setSelection(id) }} onFermer={() => setCreation(false)} />
      )}

      {ouverte && (
        <FicheDemande key={ouverte.id} demande={ouverte} evenement={evenement} membre={membre} peutModifier={peutModifier && !etroit}
          peutSaisirOffre={peutModifier} etroit={etroit} setMessage={setMessage} onFait={charger} onFermer={() => setSelection(null)} />
      )}

      {visibles.length === 0 ? (
        <p className="vide">{lignes.length ? 'Aucune demande ne répond au filtre.' : 'Aucune demande de prix. Crée la première : objet, lignes, puis consulte des fournisseurs de l’annuaire.'}</p>
      ) : (
        // (31/10, audit d'ergonomie) Huit colonnes ne tiennent pas sur un téléphone : le tableau défile seul,
        // au lieu de faire glisser toute la page de côté.
        <div className="tableau-defilant">
        <table className="tableau dp-liste">
          <thead>
            <tr><th>Réf.</th><th>Objet</th><th>Catégorie</th><th>Statut</th><th>Date limite</th><th>Offres</th><th>Meilleure</th><th>Retenu</th></tr>
          </thead>
          <tbody>
            {visibles.map((d) => (
              <tr key={d.id} className={`dp-ligne ${selection === d.id ? 'selectionne' : ''}`} data-reference={d.reference} onClick={() => { setSelection(selection === d.id ? null : d.id); setCreation(false) }}>
                <td className="mono">{d.reference}</td>
                <td><strong>{d.objet}</strong>{d.responsable ? <span className="sourdine"> · {d.responsable}</span> : null}</td>
                <td>{libelleCategorieFournisseur(d.categorie)}</td>
                <td><Pastille statut={d.statut} /></td>
                <td className={d.en_retard ? 'alerte-texte' : ''}>{jjmm(d.date_limite)}{d.en_retard ? ' · en retard' : ''}</td>
                <td className="mono">{d.nb_offres}/{d.nb_consultations}{d.nb_envoyees ? ` (${d.nb_envoyees} attendue${d.nb_envoyees > 1 ? 's' : ''})` : ''}</td>
                <td className="mono">{d.meilleure_offre_ht != null ? euros(d.meilleure_offre_ht) : '—'}</td>
                <td>{d.retenu_fournisseur ? `${d.retenu_fournisseur} · ${euros(d.retenu_montant_ht)} HT` : '—'}{d.commande_statut ? <span className="sourdine"> · {libelleDe(STATUTS_COMMANDE, d.commande_statut).toLowerCase()}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

export function Pastille({ statut, liste = STATUTS_DEMANDE_PRIX }) {
  return <span className={`dp-pastille statut-${statut}`}>{libelleDe(liste, statut)}</span>
}

/* ================================================================== */
/* Création                                                            */
/* ================================================================== */

function FormDemande({ evenement, membre, setMessage, onFait, onFermer }) {
  const [v, setV] = useState({ objet: '', categorie: '', description: '', date_limite: '', livraison_de: '', livraison_a: '', lieu_id: '', groupe_travail_id: '', responsable_membre_id: membre?.id ?? '' })
  const [refs, setRefs] = useState({ lieux: [], groupes: [], membres: [] })
  const [occupe, setOccupe] = useState(false)
  useEffect(() => { chargerReferences(evenement.id).then(setRefs) }, [evenement.id])
  const champ = (k) => (e) => setV({ ...v, [k]: e.target.value })

  async function creer() {
    if (!v.objet.trim()) return
    setOccupe(true)
    const { data, error } = await supabase.from('demandes_prix').insert({
      evenement_id: evenement.id, objet: v.objet.trim(), categorie: v.categorie || null, description: v.description || null,
      date_limite: depuisLocal(v.date_limite), livraison_de: depuisLocal(v.livraison_de), livraison_a: depuisLocal(v.livraison_a),
      lieu_id: v.lieu_id || null, groupe_travail_id: v.groupe_travail_id || null, responsable_membre_id: v.responsable_membre_id || null
    }).select('id').single()
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else onFait(data?.id)
    setOccupe(false)
  }
  return (
    <div className="formulaire dp-fiche">
      <div className="dp-fiche-tete"><strong>Nouvelle demande de prix</strong><button className="discret" onClick={onFermer}>✕</button></div>
      <ChampsDemande v={v} champ={champ} refs={refs} />
      <div className="ligne-boutons">
        <button onClick={creer} disabled={occupe || !v.objet.trim()}>Créer la demande</button>
      </div>
      <p className="aide">La référence (DP-01, DP-02…) est attribuée par la base. Ensuite : les lignes, puis les fournisseurs à consulter.</p>
    </div>
  )
}

async function chargerReferences(evenementId) {
  const [l, g, m] = await Promise.all([
    supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenementId).is('deleted_at', null).order('nom'),
    supabase.from('groupes_travail').select('id, nom').eq('evenement_id', evenementId).is('deleted_at', null).order('ordre'),
    supabase.from('membres_evenement').select('id, nom_affiche, telephone').eq('evenement_id', evenementId).is('deleted_at', null).order('nom_affiche', { nullsFirst: false })
  ])
  return { lieux: l.data ?? [], groupes: g.data ?? [], membres: m.data ?? [] }
}

function ChampsDemande({ v, champ, refs, lecture }) {
  return (
    <div className="grille-champs dp-grille">
      <label className="dp-large">Objet<input value={v.objet} onChange={champ('objet')} disabled={lecture} placeholder="Barriérage périmètre scène" /></label>
      <label>Catégorie
        <select value={v.categorie ?? ''} onChange={champ('categorie')} disabled={lecture}>
          <option value="">—</option>
          {CATEGORIES_FOURNISSEUR.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
        </select>
      </label>
      <label>Réponse attendue pour<input type="datetime-local" value={v.date_limite ?? ''} onChange={champ('date_limite')} disabled={lecture} /></label>
      <label>Mise à disposition du<input type="datetime-local" value={v.livraison_de ?? ''} onChange={champ('livraison_de')} disabled={lecture} /></label>
      <label>au<input type="datetime-local" value={v.livraison_a ?? ''} onChange={champ('livraison_a')} disabled={lecture} /></label>
      <label>Lieu de livraison
        <select value={v.lieu_id ?? ''} onChange={champ('lieu_id')} disabled={lecture}>
          <option value="">—</option>
          {refs.lieux.map((l) => <option key={l.id} value={l.id}>{l.code} {l.nom}</option>)}
        </select>
      </label>
      <label>Groupe de travail
        <select value={v.groupe_travail_id ?? ''} onChange={champ('groupe_travail_id')} disabled={lecture}>
          <option value="">—</option>
          {refs.groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
        </select>
      </label>
      <label>Responsable
        <select value={v.responsable_membre_id ?? ''} onChange={champ('responsable_membre_id')} disabled={lecture}>
          <option value="">—</option>
          {refs.membres.map((m) => <option key={m.id} value={m.id}>{m.nom_affiche}</option>)}
        </select>
      </label>
      <label className="dp-large">Description<textarea rows={2} value={v.description ?? ''} onChange={champ('description')} disabled={lecture} placeholder="Contexte, contraintes d'accès, horaires…" /></label>
    </div>
  )
}

/* ================================================================== */
/* La fiche                                                            */
/* ================================================================== */

function FicheDemande({ demande, evenement, membre, peutModifier, peutSaisirOffre, etroit, setMessage, onFait, onFermer }) {
  const [v, setV] = useState({
    objet: demande.objet, categorie: demande.categorie ?? '', description: demande.description ?? '',
    date_limite: versLocal(demande.date_limite), livraison_de: versLocal(demande.livraison_de), livraison_a: versLocal(demande.livraison_a),
    lieu_id: demande.lieu_id ?? '', groupe_travail_id: demande.groupe_travail_id ?? '', responsable_membre_id: demande.responsable_membre_id ?? ''
  })
  const [refs, setRefs] = useState({ lieux: [], groupes: [], membres: [] })
  const [lignes, setLignes] = useState([])
  const [consultations, setConsultations] = useState([])
  const [annuaire, setAnnuaire] = useState([])
  const [contacts, setContacts] = useState({})
  const [articles, setArticles] = useState([])
  const [commande, setCommande] = useState(null)
  const [organisation, setOrganisation] = useState(null)
  const [toutesCategories, setToutesCategories] = useState(false)
  const [fournisseurAjout, setFournisseurAjout] = useState('')
  const [offreOuverte, setOffreOuverte] = useState(null)
  const [piecesOuvertes, setPiecesOuvertes] = useState(null)
  const [retenir, setRetenir] = useState(null) // { consultation_id, motif }
  const occupe = useRef(false)
  const champ = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const close = demande.statut === 'close'
  const decidee = demande.statut === 'decidee' || close
  const lecture = !peutModifier || close

  async function chargerTout() {
    const [l, c, a, m, k, o] = await Promise.all([
      supabase.from('demande_prix_lignes').select('*').eq('demande_id', demande.id).is('deleted_at', null).order('ordre').order('created_at'),
      supabase.rpc('comparaison', { p_demande: demande.id }),
      evenement.organisation_id ? supabase.rpc('annuaire', { p_organisation: evenement.organisation_id }) : Promise.resolve({ data: [] }),
      supabase.from('materiel').select('id, code, nom, unite, categorie').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom'),
      demande.commande_id ? supabase.from('commandes').select('*').eq('id', demande.commande_id).maybeSingle() : Promise.resolve({ data: null }),
      evenement.organisation_id ? supabase.from('organisations').select('nom, contact_nom, contact_email, contact_tel').eq('id', evenement.organisation_id).maybeSingle() : Promise.resolve({ data: null })
    ])
    if (c.error) setMessage({ type: 'erreur', texte: texteErreur(c.error) })
    setLignes(l.data ?? [])
    // `comparaison()` nomme la clé consultation_id ; l'écran parle d'id.
    setConsultations((c.data ?? []).map((x) => ({ ...x, id: x.consultation_id })))
    setAnnuaire((a.data ?? []).filter((f) => f.actif !== false))
    setArticles(m.data ?? [])
    setCommande(k.data ?? null)
    setOrganisation(o.data ?? null)
    const ids = (c.data ?? []).map((x) => x.fournisseur_id)
    if (ids.length) {
      const r = await supabase.from('fournisseur_contacts').select('id, fournisseur_id, nom, fonction, email, telephone, principal').in('fournisseur_id', ids).is('deleted_at', null)
      const par = {}
      for (const ct of r.data ?? []) (par[ct.fournisseur_id] ||= []).push(ct)
      setContacts(par)
    }
  }
  useEffect(() => {
    chargerReferences(evenement.id).then(setRefs)
    chargerTout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demande.id, demande.updated_at, demande.commande_id])

  async function enregistrerEntete() {
    const refus = await modifierOuRefuser('demandes_prix', {
      objet: v.objet.trim(), categorie: v.categorie || null, description: v.description || null,
      date_limite: depuisLocal(v.date_limite), livraison_de: depuisLocal(v.livraison_de), livraison_a: depuisLocal(v.livraison_a),
      lieu_id: v.lieu_id || null, groupe_travail_id: v.groupe_travail_id || null, responsable_membre_id: v.responsable_membre_id || null
    }, { id: demande.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { setMessage({ type: 'info', texte: 'Demande enregistrée.' }); onFait() }
  }
  async function clore() {
    if (!window.confirm('Clore la demande ? Plus aucune offre ne sera retenue.')) return
    const refus = await modifierOuRefuser('demandes_prix', { statut: 'close' }, { id: demande.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else onFait()
  }
  async function supprimer() {
    if (!window.confirm(`Supprimer ${demande.reference} ? Le jalon de suivi est annulé.`)) return
    const refus = await supprimerOuRefuser('demandes_prix', demande.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { onFermer(); onFait() }
  }

  /* ---- lignes ---- */
  const [nouvelle, setNouvelle] = useState({ designation: '', quantite: '1', unite: 'pièce', precision: '', materiel_id: '' })
  function choisirArticle(id) {
    const a = articles.find((x) => x.id === id)
    setNouvelle({ ...nouvelle, materiel_id: id, designation: a ? a.nom : nouvelle.designation, unite: a?.unite || nouvelle.unite })
  }
  async function ajouterLigne() {
    if (!nouvelle.designation.trim()) return
    const { error } = await supabase.from('demande_prix_lignes').insert({
      demande_id: demande.id, ordre: lignes.length + 1, designation: nouvelle.designation.trim(),
      quantite: Number(nouvelle.quantite) || 1, unite: nouvelle.unite || 'pièce', precision: nouvelle.precision || null, materiel_id: nouvelle.materiel_id || null
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { setNouvelle({ designation: '', quantite: '1', unite: 'pièce', precision: '', materiel_id: '' }); chargerTout(); onFait() }
  }
  async function modifierLigne(l, champs) {
    const refus = await modifierOuRefuser('demande_prix_lignes', champs, { id: l.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else chargerTout()
  }
  async function retirerLigne(l) {
    const { error, count } = await supabase.from('demande_prix_lignes').delete({ count: 'exact' }).eq('id', l.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Suppression refusée : droits insuffisants.' })
    chargerTout(); onFait()
  }

  /* ---- consultations ---- */
  const dejaConsultes = new Set(consultations.map((c) => c.fournisseur_id))
  const candidats = annuaire.filter((f) => !dejaConsultes.has(f.id) && (toutesCategories || !demande.categorie || (f.categories ?? []).includes(demande.categorie)))
  async function consulter() {
    const f = annuaire.find((x) => x.id === fournisseurAjout)
    if (!f) return
    const { error } = await supabase.from('consultations').insert({ demande_id: demande.id, evenement_id: evenement.id, fournisseur_id: f.id, contact_id: f.contact_id ?? null })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { setFournisseurAjout(''); chargerTout(); onFait() }
  }
  async function changerContact(c, contactId) {
    const refus = await modifierOuRefuser('consultations', { contact_id: contactId || null }, { id: c.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else chargerTout()
  }
  const responsable = refs.membres.find((m) => m.id === (v.responsable_membre_id || demande.responsable_membre_id))
  const texte = () => texteDemande(demande, v, lignes, evenement, refs, responsable, organisation)
  function mailto(c) {
    const dest = c.contact_email ?? ''
    const sujet = `[Eventware] Demande de prix ${demande.reference} — ${demande.objet} — ${evenement.nom}`
    return `mailto:${encodeURIComponent(dest)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(texte())}`
  }
  async function marquerEnvoyee(c, moyen) {
    const { error } = await supabase.rpc('marquer_envoyee', { p_consultation: c.id, p_moyen: moyen })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { setMessage({ type: 'info', texte: `${demande.reference} marquée envoyée à ${c.fournisseur_nom}. Le jalon « Offres attendues » suit la date limite.` }); chargerTout(); onFait() }
  }
  async function relancer(c) {
    const note = window.prompt(`Relancer ${c.fournisseur_nom} — une note ?`, '')
    if (note === null) return
    const { error } = await supabase.rpc('relancer', { p_consultation: c.id, p_note: note || null, p_moyen: null })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { chargerTout(); onFait() }
  }
  async function statutConsultation(c, statut) {
    const refus = await modifierOuRefuser('consultations', { statut }, { id: c.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { chargerTout(); onFait() }
  }
  async function retirerConsultation(c) {
    if (!window.confirm(`Retirer ${c.fournisseur_nom} de la consultation ?`)) return
    const refus = await supprimerOuRefuser('consultations', c.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { chargerTout(); onFait() }
  }
  async function confirmerRetenir() {
    if (!retenir || occupe.current) return
    if (!retenir.motif.trim()) { setMessage({ type: 'erreur', texte: 'Le motif de la décision est obligatoire.' }); return }
    occupe.current = true
    const { error } = await supabase.rpc('retenir_offre', { p_consultation: retenir.consultation_id, p_motif: retenir.motif.trim() })
    occupe.current = false
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { setRetenir(null); setMessage({ type: 'info', texte: 'Offre retenue : commande ouverte, décision en main courante, jalon fait.' }); chargerTout(); onFait() }
  }

  /* ---- commande ---- */
  async function modifierCommande(champs) {
    const refus = await modifierOuRefuser('commandes', champs, { id: commande.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { chargerTout(); onFait() }
  }

  /* ---- impression ---- */
  function imprimer() {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(htmlImpression(demande, v, lignes, evenement, refs, responsable, organisation, conditionsGenerales(evenement.organisation_id)))
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  const offres = consultations.filter((c) => c.montant_ht != null && ['offre_recue', 'retenue', 'ecartee'].includes(c.statut))
  const retenue = consultations.find((c) => c.statut === 'retenue')

  return (
    <div className="formulaire dp-fiche" data-reference={demande.reference}>
      <div className="dp-fiche-tete">
        <strong><span className="mono">{demande.reference}</span> {demande.objet} <Pastille statut={demande.statut} /></strong>
        <span className="ligne-boutons">
          <button className="discret" onClick={imprimer}>Imprimer / PDF</button>
          {peutModifier && !close && <button className="discret" onClick={clore}>Clore</button>}
          {peutModifier && <button className="discret" onClick={supprimer}>Supprimer</button>}
          <button className="discret" onClick={onFermer}>✕</button>
        </span>
      </div>
      {demande.jalon_id && (
        <p className="aide">Suivi par le jalon « Offres attendues — {demande.objet} » ({demande.jalon_statut}) : visible dans Préparation et le Gantt.</p>
      )}
      {demande.decision_motif && <p className="dp-decision">Décision : {demande.retenu_fournisseur}, {euros(demande.retenu_montant_ht)} HT — {demande.decision_motif}</p>}

      <ChampsDemande v={v} champ={champ} refs={refs} lecture={lecture} />
      {!lecture && <div className="ligne-boutons"><button onClick={enregistrerEntete} disabled={!v.objet.trim()}>Enregistrer l'en-tête</button></div>}

      {/* ---- Lignes ---- */}
      <h3>Lignes</h3>
      <table className="tableau dp-lignes">
        <thead><tr><th>#</th><th>Désignation</th><th>Quantité</th><th>Unité</th><th>Précision</th>{!lecture && <th />}</tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={l.id}>
              <td className="mono">{i + 1}</td>
              <td>{lecture ? l.designation : <input defaultValue={l.designation} onBlur={(e) => e.target.value.trim() && e.target.value !== l.designation && modifierLigne(l, { designation: e.target.value.trim() })} />}</td>
              <td className="mono">{lecture ? Number(l.quantite) : <input type="number" defaultValue={Number(l.quantite)} style={{ width: 80 }} onBlur={(e) => Number(e.target.value) !== Number(l.quantite) && modifierLigne(l, { quantite: Number(e.target.value) || 1 })} />}</td>
              <td>{lecture ? l.unite : <input defaultValue={l.unite} style={{ width: 80 }} onBlur={(e) => e.target.value !== l.unite && modifierLigne(l, { unite: e.target.value || 'pièce' })} />}</td>
              <td>{lecture ? l.precision : <input defaultValue={l.precision ?? ''} onBlur={(e) => (e.target.value || null) !== (l.precision ?? null) && modifierLigne(l, { precision: e.target.value || null })} />}</td>
              {!lecture && <td><button className="lien" onClick={() => retirerLigne(l)}>retirer</button></td>}
            </tr>
          ))}
          {lignes.length === 0 && <tr><td colSpan={6} className="vide">Aucune ligne. Une ligne = une chose à chiffrer : désignation, quantité, unité.</td></tr>}
        </tbody>
      </table>
      {!lecture && (
        <div className="saisie-rapide dp-ajout-ligne">
          {articles.length > 0 && (
            <select value={nouvelle.materiel_id} onChange={(e) => choisirArticle(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
              <option value="">— article du stock —</option>
              {articles.map((a) => <option key={a.id} value={a.id}>{a.code} {a.nom}</option>)}
            </select>
          )}
          <input value={nouvelle.designation} onChange={(e) => setNouvelle({ ...nouvelle, designation: e.target.value })} placeholder="Désignation — Barrière Heras 3,5 m avec pied" />
          <input type="number" value={nouvelle.quantite} onChange={(e) => setNouvelle({ ...nouvelle, quantite: e.target.value })} style={{ flex: '0 1 80px' }} />
          <select value={nouvelle.unite} onChange={(e) => setNouvelle({ ...nouvelle, unite: e.target.value })} style={{ width: 'auto', marginBottom: 0 }}>
            {UNITES_LIGNE.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input value={nouvelle.precision} onChange={(e) => setNouvelle({ ...nouvelle, precision: e.target.value })} placeholder="Précision — livraison vendredi 8 h" />
          <button className="discret" onClick={ajouterLigne} disabled={!nouvelle.designation.trim()}>Ajouter la ligne</button>
        </div>
      )}

      {/* ---- Consultations ---- */}
      <h3>Fournisseurs consultés</h3>
      {consultations.length === 0 && <p className="vide">Personne n'est consulté. Choisis un fournisseur de l'annuaire{demande.categorie ? ` (catégorie ${libelleCategorieFournisseur(demande.categorie)})` : ''}.</p>}
      {consultations.map((c) => {
        const ouvertOffre = offreOuverte === c.id
        const attente = ['envoyee', 'relancee'].includes(c.statut)
        return (
          <div className={`dp-consultation statut-${c.statut}`} key={c.consultation_id} data-fournisseur={c.fournisseur_nom}>
            <div className="dp-consultation-tete">
              <strong>{c.fournisseur_nom}</strong>
              <Pastille statut={c.statut} liste={STATUTS_CONSULTATION} />
              {c.note_moyenne != null && <span className="four-note">{'★'.repeat(Math.round(c.note_moyenne))} {c.note_moyenne}</span>}
              {c.dernier_verdict && <span className={`four-verdict verdict-${c.dernier_verdict}`}>{libelleVerdict(c.dernier_verdict)}</span>}
              {c.envoyee_le && <span className="sourdine">envoyée le {jjmm(c.envoyee_le)}</span>}
              {c.relances?.length > 0 && <span className="sourdine">relancée {c.relances.length} fois</span>}
              {c.montant_ht != null && <span className="mono dp-montant">{euros(c.montant_ht)} HT · {euros(c.montant_ttc ?? ttc(c.montant_ht, c.taux_tva))} TTC</span>}
            </div>
            <div className="dp-consultation-corps">
              <span>
                Contact :{' '}
                {lecture ? (c.contact_nom ?? '—') : (
                  <select value={c.contact_id ?? ''} onChange={(e) => changerContact(c, e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
                    <option value="">— société —</option>
                    {(contacts[c.fournisseur_id] ?? []).map((ct) => <option key={ct.id} value={ct.id}>{ct.nom}{ct.fonction ? ` (${ct.fonction})` : ''}</option>)}
                  </select>
                )}
                {c.contact_email && <span className="sourdine"> {c.contact_email}</span>}
                {c.contact_telephone && <span className="mono"> {c.contact_telephone}</span>}
              </span>
              {c.offre_delai && <span>délai {c.offre_delai}</span>}
              {c.offre_validite && <span>valable jusqu'au {jjmmaa(c.offre_validite)}</span>}
              {c.offre_conditions && <span className="sourdine">{c.offre_conditions}</span>}
            </div>
            <div className="ligne-boutons dp-consultation-actions">
              {!lecture && c.statut === 'a_envoyer' && (
                <a className="bouton" href={mailto(c)} onClick={() => marquerEnvoyee(c, 'mailto')}>Envoyer par e-mail</a>
              )}
              {!lecture && c.statut === 'a_envoyer' && <button className="discret" onClick={() => marquerEnvoyee(c, 'autre')}>Marquer envoyée</button>}
              {!lecture && attente && <button className="discret" onClick={() => relancer(c)}>Relancer</button>}
              {peutSaisirOffre && !close && !decidee && (attente || c.statut === 'offre_recue' || c.statut === 'sans_reponse') && (
                <button className="discret" onClick={() => setOffreOuverte(ouvertOffre ? null : c.id)}>{ouvertOffre ? 'Fermer la saisie' : c.statut === 'offre_recue' ? 'Corriger l’offre' : 'Saisir l’offre'}</button>
              )}
              {!lecture && attente && <button className="discret" onClick={() => statutConsultation(c, 'sans_reponse')}>Sans réponse</button>}
              {!lecture && c.statut === 'offre_recue' && !etroit && (
                <button onClick={() => setRetenir({ consultation_id: c.id, motif: '' })}>Retenir</button>
              )}
              <button className="lien" onClick={() => setPiecesOuvertes(piecesOuvertes === c.id ? null : c.id)}>{piecesOuvertes === c.id ? 'masquer les pièces' : 'pièces de l’offre'}</button>
              {!lecture && c.statut === 'a_envoyer' && <button className="lien" onClick={() => retirerConsultation(c)}>retirer</button>}
            </div>
            {ouvertOffre && (
              <SaisieOffre consultation={c} lignes={lignes} setMessage={setMessage} onFait={() => { setOffreOuverte(null); chargerTout(); onFait() }} />
            )}
            {piecesOuvertes === c.id && (
              <PiecesJointes evenement={evenement} objetType="offre" objetId={c.id} peutGerer={peutSaisirOffre} setMessage={setMessage} />
            )}
          </div>
        )
      })}
      {!lecture && !decidee && (
        <div className="saisie-rapide dp-ajout-consultation">
          <select value={fournisseurAjout} onChange={(e) => setFournisseurAjout(e.target.value)} style={{ marginBottom: 0 }}>
            <option value="">— fournisseur de l'annuaire —</option>
            {candidats.map((f) => <option key={f.id} value={f.id}>{f.nom}{f.note_moyenne != null ? ` · ${f.note_moyenne} ★` : ''}{f.dernier_verdict ? ` · ${libelleVerdict(f.dernier_verdict)}` : ''}</option>)}
          </select>
          <button className="discret" onClick={consulter} disabled={!fournisseurAjout}>Consulter</button>
          {demande.categorie && (
            <label className="case-a-cocher" style={{ margin: 0 }}>
              <input type="checkbox" checked={toutesCategories} onChange={(e) => setToutesCategories(e.target.checked)} /> toutes les catégories
            </label>
          )}
          {candidats.length === 0 && <span className="aide">Aucun fournisseur disponible{demande.categorie && !toutesCategories ? ' dans cette catégorie' : ''} : complète l'annuaire (Logistique › Fournisseurs).</span>}
        </div>
      )}

      {/* ---- Comparaison ---- */}
      {offres.length > 0 && !etroit && (
        <>
          <h3>Comparaison</h3>
          <Comparaison lignes={lignes} offres={offres} retenue={retenue} peutRetenir={!lecture && !decidee}
            onRetenir={(c) => setRetenir({ consultation_id: c.id, motif: '' })} />
        </>
      )}
      {offres.length > 0 && etroit && <p className="aide">La grille de comparaison demande un écran large.</p>}
      {retenir && (
        <div className="message dp-retenir">
          Retenir <strong>{consultations.find((c) => c.id === retenir.consultation_id)?.fournisseur_nom}</strong> — pourquoi ? (obligatoire, écrit en main courante)
          <input value={retenir.motif} onChange={(e) => setRetenir({ ...retenir, motif: e.target.value })} placeholder="Moins cher à prestations égales ; livraison comprise…" autoFocus />
          <span className="ligne-boutons">
            <button onClick={confirmerRetenir} disabled={!retenir.motif.trim()}>Confirmer la décision</button>
            <button className="discret" onClick={() => setRetenir(null)}>Annuler</button>
          </span>
        </div>
      )}

      {/* ---- Commande ---- */}
      {commande && retenue && (
        <>
          <h3>Commande — {retenue.fournisseur_nom}</h3>
          <div className="grille-champs dp-grille">
            <label>Référence fournisseur (devis, bon)<input defaultValue={commande.reference_fournisseur ?? ''} disabled={!peutModifier} onBlur={(e) => (e.target.value || null) !== (commande.reference_fournisseur ?? null) && modifierCommande({ reference_fournisseur: e.target.value || null })} /></label>
            <label>Statut
              <select value={commande.statut} disabled={!peutModifier} onChange={(e) => modifierCommande({ statut: e.target.value })}>
                {STATUTS_COMMANDE.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </label>
            <label>Livrée le<input type="datetime-local" defaultValue={versLocal(commande.livree_le)} disabled={!peutModifier} onBlur={(e) => depuisLocal(e.target.value) !== commande.livree_le && modifierCommande({ livree_le: depuisLocal(e.target.value) })} /></label>
            <label>Facturée le<input type="datetime-local" defaultValue={versLocal(commande.facturee_le)} disabled={!peutModifier} onBlur={(e) => depuisLocal(e.target.value) !== commande.facturee_le && modifierCommande({ facturee_le: depuisLocal(e.target.value) })} /></label>
            <label>Montant facturé HT<input type="number" step="0.01" defaultValue={commande.montant_facture_ht ?? ''} disabled={!peutModifier} onBlur={(e) => (e.target.value === '' ? null : Number(e.target.value)) !== (commande.montant_facture_ht ?? null) && modifierCommande({ montant_facture_ht: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label>Écart avec l'offre<span className={`dp-ecart ${commande.montant_facture_ht != null && Number(commande.montant_facture_ht) > Number(retenue.montant_ht) ? 'alerte-texte' : ''}`}>
              {commande.montant_facture_ht == null ? '—' : euros(Number(commande.montant_facture_ht) - Number(retenue.montant_ht))}
            </span></label>
          </div>
        </>
      )}

      <h3>Pièces jointes de la demande</h3>
      <PiecesJointes evenement={evenement} objetType="demande_prix" objetId={demande.id} peutGerer={peutSaisirOffre} setMessage={setMessage} />
    </div>
  )
}

/* ================================================================== */
/* Saisie d'une offre : par lignes (le montant se recalcule) ou forfait */
/* ================================================================== */

function SaisieOffre({ consultation, lignes, setMessage, onFait }) {
  const existantes = useMemo(() => Object.fromEntries((consultation.lignes ?? []).map((o) => [o.ligne_id, o])), [consultation])
  const [prix, setPrix] = useState(() => Object.fromEntries(lignes.map((l) => [l.id, { pu: existantes[l.id]?.prix_unitaire_ht ?? '', q: existantes[l.id]?.quantite_offerte ?? '', remarque: existantes[l.id]?.remarque ?? '' }])))
  const [forfait, setForfait] = useState(() => (Object.keys(existantes).length ? '' : consultation.montant_ht ?? ''))
  const [v, setV] = useState({ taux_tva: consultation.taux_tva ?? 21, offre_delai: consultation.offre_delai ?? '', offre_validite: consultation.offre_validite ?? '', offre_conditions: consultation.offre_conditions ?? '', commentaire: consultation.commentaire ?? '' })
  const [occupe, setOccupe] = useState(false)
  const totalLignes = lignes.reduce((s, l) => {
    const p = prix[l.id]
    return p?.pu !== '' && p?.pu != null ? s + Number(p.pu) * (p.q !== '' && p.q != null ? Number(p.q) : Number(l.quantite)) : s
  }, 0)
  const parLignes = lignes.some((l) => prix[l.id]?.pu !== '' && prix[l.id]?.pu != null)

  async function enregistrer() {
    setOccupe(true)
    try {
      if (parLignes) {
        const rows = lignes.filter((l) => prix[l.id].pu !== '').map((l) => ({
          consultation_id: consultation.id, ligne_id: l.id, prix_unitaire_ht: Number(prix[l.id].pu),
          quantite_offerte: prix[l.id].q === '' ? null : Number(prix[l.id].q), remarque: prix[l.id].remarque || null
        }))
        const { error } = await supabase.from('offre_lignes').upsert(rows, { onConflict: 'consultation_id,ligne_id' })
        if (error) throw error
        const vides = lignes.filter((l) => prix[l.id].pu === '' && existantes[l.id]).map((l) => l.id)
        if (vides.length) {
          const r = await supabase.from('offre_lignes').delete().eq('consultation_id', consultation.id).in('ligne_id', vides)
          if (r.error) throw r.error
        }
      }
      const champs = {
        statut: 'offre_recue', taux_tva: Number(v.taux_tva), offre_delai: v.offre_delai || null, offre_validite: v.offre_validite || null,
        offre_conditions: v.offre_conditions || null, commentaire: v.commentaire || null
      }
      if (!parLignes) champs.montant_ht = forfait === '' ? null : Number(forfait)
      const refus = await modifierOuRefuser('consultations', champs, { id: consultation.id })
      if (refus) throw new Error(refus)
      onFait()
    } catch (e) {
      setMessage({ type: 'erreur', texte: texteErreur(e) })
    }
    setOccupe(false)
  }

  return (
    <div className="dp-offre">
      <table className="tableau">
        <thead><tr><th>Ligne</th><th>Qté demandée</th><th>Prix unitaire HT</th><th>Qté offerte</th><th>Remarque</th><th>Total HT</th></tr></thead>
        <tbody>
          {lignes.map((l) => {
            const p = prix[l.id]
            const total = p.pu === '' ? null : Number(p.pu) * (p.q === '' ? Number(l.quantite) : Number(p.q))
            return (
              <tr key={l.id}>
                <td>{l.designation}</td>
                <td className="mono">{Number(l.quantite)} {l.unite}</td>
                <td><input type="number" step="0.01" value={p.pu} onChange={(e) => setPrix({ ...prix, [l.id]: { ...p, pu: e.target.value } })} style={{ width: 100 }} /></td>
                <td><input type="number" value={p.q} placeholder={String(Number(l.quantite))} onChange={(e) => setPrix({ ...prix, [l.id]: { ...p, q: e.target.value } })} style={{ width: 80 }} /></td>
                <td><input value={p.remarque} onChange={(e) => setPrix({ ...prix, [l.id]: { ...p, remarque: e.target.value } })} /></td>
                <td className="mono">{total == null ? '' : euros(total)}</td>
              </tr>
            )
          })}
        </tbody>
        {parLignes && <tfoot><tr><td colSpan={5}>Total HT (recalculé par la base)</td><td className="mono" data-total>{euros(totalLignes)}</td></tr></tfoot>}
      </table>
      <div className="grille-champs dp-grille">
        <label>Forfait HT (sans prix par ligne)<input type="number" step="0.01" value={forfait} disabled={parLignes} onChange={(e) => setForfait(e.target.value)} placeholder="1850" /></label>
        <label>TVA
          <select value={v.taux_tva} onChange={(e) => setV({ ...v, taux_tva: e.target.value })}>
            {TAUX_TVA.map((t) => <option key={t} value={t}>{t} %</option>)}
          </select>
        </label>
        <label>Délai<input value={v.offre_delai} onChange={(e) => setV({ ...v, offre_delai: e.target.value })} placeholder="48 h, sous 3 semaines" /></label>
        <label>Offre valable jusqu'au<input type="date" value={v.offre_validite ?? ''} onChange={(e) => setV({ ...v, offre_validite: e.target.value })} /></label>
        <label className="dp-large">Conditions<input value={v.offre_conditions} onChange={(e) => setV({ ...v, offre_conditions: e.target.value })} placeholder="acompte, caution, transport inclus…" /></label>
        <label className="dp-large">Commentaire<input value={v.commentaire} onChange={(e) => setV({ ...v, commentaire: e.target.value })} /></label>
      </div>
      <div className="ligne-boutons">
        <button onClick={enregistrer} disabled={occupe || (!parLignes && forfait === '')}>Enregistrer l'offre</button>
      </div>
    </div>
  )
}

/* ================================================================== */
/* La grille : lignes × offres, meilleure valeur en vert                */
/* ================================================================== */

function Comparaison({ lignes, offres, retenue, peutRetenir, onRetenir }) {
  const prixDe = (o, l) => (o.lignes ?? []).find((x) => x.ligne_id === l.id)
  const meilleurParLigne = Object.fromEntries(lignes.map((l) => {
    const totaux = offres.map((o) => prixDe(o, l)?.total_ht).filter((t) => t != null).map(Number)
    return [l.id, totaux.length ? Math.min(...totaux) : null]
  }))
  const meilleurTotal = Math.min(...offres.map((o) => Number(o.montant_ht)))
  return (
    <div className="tableau-defilant">
      <table className="tableau dp-comparaison">
        <thead>
          <tr>
            <th />
            {offres.map((o) => (
              <th key={o.consultation_id} className={o.statut === 'retenue' ? 'dp-retenue' : ''}>
                {o.fournisseur_nom}
                {o.statut === 'retenue' && <span className="etiquette"> retenue</span>}
                {o.statut === 'ecartee' && <span className="etiquette"> écartée</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.designation} <span className="sourdine">× {Number(l.quantite)} {l.unite}</span></td>
              {offres.map((o) => {
                const p = prixDe(o, l)
                const meilleur = p?.total_ht != null && Number(p.total_ht) === meilleurParLigne[l.id]
                return (
                  <td key={o.consultation_id} className={`mono ${meilleur ? 'dp-meilleur' : ''}`}>
                    {p?.prix_unitaire_ht != null ? <>{euros(p.prix_unitaire_ht)} <span className="sourdine">× {p.quantite_offerte ?? Number(l.quantite)}</span> = {euros(p.total_ht)}</> : <span className="sourdine">—</span>}
                    {p?.remarque && <div className="sourdine">{p.remarque}</div>}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="dp-total">
            <td>Total HT</td>
            {offres.map((o) => <td key={o.consultation_id} className={`mono ${Number(o.montant_ht) === meilleurTotal ? 'dp-meilleur' : ''}`} data-total-ht>{euros(o.montant_ht)}</td>)}
          </tr>
          <tr>
            <td>TVA · total TTC</td>
            {offres.map((o) => <td key={o.consultation_id} className="mono">{Number(o.taux_tva)} % · {euros(o.montant_ttc ?? ttc(o.montant_ht, o.taux_tva))}</td>)}
          </tr>
          <tr><td>Délai</td>{offres.map((o) => <td key={o.consultation_id}>{o.offre_delai ?? '—'}</td>)}</tr>
          <tr><td>Validité</td>{offres.map((o) => <td key={o.consultation_id}>{o.offre_validite ? jjmmaa(o.offre_validite) : '—'}</td>)}</tr>
          <tr><td>Conditions</td>{offres.map((o) => <td key={o.consultation_id}>{o.offre_conditions ?? '—'}</td>)}</tr>
          <tr>
            <td>Historique</td>
            {offres.map((o) => (
              <td key={o.consultation_id}>
                {o.note_moyenne != null ? <span className="four-note">{'★'.repeat(Math.round(o.note_moyenne))} {o.note_moyenne}</span> : <span className="sourdine">jamais évalué</span>}
                {o.dernier_verdict && <span className={`four-verdict verdict-${o.dernier_verdict}`}> {libelleVerdict(o.dernier_verdict)}</span>}
              </td>
            ))}
          </tr>
          {peutRetenir && !retenue && (
            <tr>
              <td />
              {offres.map((o) => <td key={o.consultation_id}>{o.statut === 'offre_recue' && <button onClick={() => onRetenir(o)}>Retenir</button>}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ================================================================== */
/* Le texte de la demande (corps du mail), et sa page imprimable       */
/* ================================================================== */

const CLE_CG = (org) => `eventware:conditions-generales:${org}`
export function conditionsGenerales(org) {
  try { return localStorage.getItem(CLE_CG(org)) ?? '' } catch { return '' }
}
export function enregistrerConditionsGenerales(org, texte) {
  try { localStorage.setItem(CLE_CG(org), texte) } catch { /* stockage indisponible */ }
}

function texteDemande(demande, v, lignes, evenement, refs, responsable, organisation) {
  const lieu = refs.lieux.find((l) => l.id === (v.lieu_id || demande.lieu_id))
  const L = []
  L.push(`Demande de prix ${demande.reference} — ${v.objet || demande.objet}`)
  L.push(`${organisation?.nom ?? ''}${organisation?.nom ? ' — ' : ''}${evenement.nom}${evenement.date_debut ? ` (${jjmmaa(evenement.date_debut)}${evenement.date_fin && evenement.date_fin !== evenement.date_debut ? ` → ${jjmmaa(evenement.date_fin)}` : ''})` : ''}`)
  L.push('')
  if (v.description || demande.description) { L.push(v.description || demande.description); L.push('') }
  L.push('Lignes :')
  lignes.forEach((l, i) => L.push(`  ${i + 1}. ${l.designation} — ${Number(l.quantite)} ${l.unite}${l.precision ? ` (${l.precision})` : ''}`))
  L.push('')
  const de = v.livraison_de ? new Date(v.livraison_de) : demande.livraison_de
  const a = v.livraison_a ? new Date(v.livraison_a) : demande.livraison_a
  if (de || a) L.push(`Période de mise à disposition : ${de ? jjmmHeure(de) : '?'} → ${a ? jjmmHeure(a) : '?'}`)
  if (lieu) L.push(`Lieu de livraison : ${lieu.nom}`)
  const lim = v.date_limite ? new Date(v.date_limite) : demande.date_limite
  if (lim) L.push(`Réponse souhaitée pour le ${jjmmHeure(lim)}`)
  if (responsable) L.push(`Contact : ${responsable.nom_affiche}${responsable.telephone ? ` — ${responsable.telephone}` : ''}`)
  L.push('')
  L.push('Merci de préciser prix unitaires HT, TVA, délai, validité de l’offre et conditions (acompte, caution, transport).')
  return L.join('\n')
}

const html = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function htmlImpression(demande, v, lignes, evenement, refs, responsable, organisation, conditions) {
  const lieu = refs.lieux.find((l) => l.id === (v.lieu_id || demande.lieu_id))
  const de = v.livraison_de ? new Date(v.livraison_de) : demande.livraison_de
  const a = v.livraison_a ? new Date(v.livraison_a) : demande.livraison_a
  const lim = v.date_limite ? new Date(v.date_limite) : demande.date_limite
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${html(demande.reference)} — ${html(v.objet || demande.objet)}</title>
<style>
@page { size: A4 portrait; margin: 16mm; }
body { font-family: system-ui, sans-serif; font-size: 12pt; color: #16181c; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16181c; padding-bottom: 8px; margin-bottom: 16px; }
header img { max-height: 60px; }
h1 { font-size: 16pt; margin: 0 0 4px; }
.ref { font-family: ui-monospace, monospace; font-size: 11pt; color: #555; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; }
th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #bbb; vertical-align: top; }
th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #555; }
.bloc { margin: 8px 0; }
.cg { font-size: 10pt; color: #333; white-space: pre-wrap; border-top: 1px solid #bbb; padding-top: 8px; margin-top: 20px; }
.pied { font-size: 9pt; color: #777; margin-top: 24px; }
</style></head><body>
<header>
  <div>
    <div><strong>${html(organisation?.nom ?? '')}</strong></div>
    <div>${html(evenement.nom)}${evenement.date_debut ? ` — ${jjmmaa(evenement.date_debut)}${evenement.date_fin && evenement.date_fin !== evenement.date_debut ? ` → ${jjmmaa(evenement.date_fin)}` : ''}` : ''}</div>
    ${evenement.commune ? `<div>${html(evenement.commune)}</div>` : ''}
  </div>
  ${evenement.logo_url ? `<img src="${html(evenement.logo_url)}" alt="">` : ''}
</header>
<h1>Demande de prix — ${html(v.objet || demande.objet)}</h1>
<div class="ref">${html(demande.reference)} · ${html(libelleCategorieFournisseur(v.categorie || demande.categorie))} · émise le ${jjmmaa(new Date())}</div>
${(v.description || demande.description) ? `<p>${html(v.description || demande.description)}</p>` : ''}
<table><thead><tr><th>#</th><th>Désignation</th><th>Quantité</th><th>Unité</th><th>Précision</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead>
<tbody>${lignes.map((l, i) => `<tr><td>${i + 1}</td><td>${html(l.designation)}</td><td>${Number(l.quantite)}</td><td>${html(l.unite)}</td><td>${html(l.precision ?? '')}</td><td></td><td></td></tr>`).join('')}</tbody></table>
<div class="bloc"><strong>Période de mise à disposition :</strong> ${de ? jjmmHeure(de) : '?'} → ${a ? jjmmHeure(a) : '?'}</div>
${lieu ? `<div class="bloc"><strong>Lieu de livraison :</strong> ${html(lieu.nom)}</div>` : ''}
${lim ? `<div class="bloc"><strong>Réponse souhaitée pour le :</strong> ${jjmmHeure(lim)}</div>` : ''}
${responsable ? `<div class="bloc"><strong>Contact :</strong> ${html(responsable.nom_affiche)}${responsable.telephone ? ` — ${html(responsable.telephone)}` : ''}</div>` : ''}
<div class="bloc">Merci de préciser prix unitaires HT, TVA, délai, validité de l'offre et conditions (acompte, caution, transport).</div>
${conditions ? `<div class="cg">${html(conditions)}</div>` : ''}
<div class="pied">Généré par Eventware le ${jjmmHeure(new Date())}</div>
</body></html>`
}
