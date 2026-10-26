import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser, supprimerOuRefuser } from './ecriture'
import { CATEGORIES_FOURNISSEUR, libelleCategorieFournisseur, libelleVerdict, STATUTS_CONSULTATION, libelleDe } from './referentielsProduit'
import { COLONNES_FOURNISSEURS, modeleCsvFournisseurs, normaliserEntete, normaliser } from './colonnesImport'

/**
 * Annuaire des fournisseurs (130) — niveau organisation.
 *
 * Un loueur de barrières, un sanitaire mobile se rappellent chaque
 * année : ce qui vaut, c'est l'historique (prix de l'an dernier,
 * ponctualité, REX). L'annuaire appartient donc à l'organisation et
 * survit aux événements ; il s'ouvre depuis Logistique, dans
 * l'événement courant, qui sert à épingler un fournisseur dans ses
 * contacts (copie, pas lien : l'opérationnel veut un nom et un numéro).
 *
 * Lecture pour tout membre de l'organisation ; gestion pour qui a
 * `referentiels : modifier` sur un événement vivant (`peut_gerer_annuaire`).
 */
export default function Fournisseurs({ evenement, peut, toutPouvoir, setMessage }) {
  const organisation = evenement.organisation_id
  const [droits, setDroits] = useState({ lire: true, gerer: false })
  const [lignes, setLignes] = useState(null)
  const [categorie, setCategorie] = useState('')
  const [recherche, setRecherche] = useState('')
  const [selection, setSelection] = useState(null)
  const [creation, setCreation] = useState(false)
  const [importer, setImporter] = useState(false)
  const peutEpingler = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger() {
    if (!organisation) return
    const [d, a] = await Promise.all([
      supabase.rpc('mes_droits_annuaire', { p_organisation: organisation }),
      supabase.rpc('annuaire', { p_organisation: organisation })
    ])
    const dr = Array.isArray(d.data) ? d.data[0] : d.data
    if (dr) setDroits({ lire: !!dr.lire, gerer: !!dr.gerer })
    if (a.error) setMessage({ type: 'erreur', texte: texteErreur(a.error) })
    setLignes(a.data ?? [])
  }
  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation])

  const visibles = useMemo(() => {
    const q = normaliser(recherche)
    return (lignes ?? []).filter(
      (f) => (!categorie || (f.categories ?? []).includes(categorie)) && (!q || normaliser(f.nom).includes(q))
    )
  }, [lignes, categorie, recherche])

  async function epingler(f) {
    const { error } = await supabase.rpc('epingler_fournisseur', { p_evenement: evenement.id, p_fournisseur: f.id })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setMessage({ type: 'info', texte: `${f.nom} épinglé dans les contacts de l'événement (Sécurité › Contacts).` })
  }

  if (!organisation) return <p className="vide">Cet événement n'est rattaché à aucune organisation : pas d'annuaire.</p>
  if (lignes === null) return <p className="aide">Chargement…</p>

  const ouvert = selection ? lignes.find((f) => f.id === selection) : null

  return (
    <div className="four">
      <div className="compteurs">
        <span>Fournisseurs <strong>{lignes.length}</strong></span>
        <span>Catégorie
          <select value={categorie} onChange={(e) => setCategorie(e.target.value)} style={{ width: 'auto', marginLeft: 6, marginBottom: 0 }}>
            <option value="">toutes</option>
            {CATEGORIES_FOURNISSEUR.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </span>
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un nom" style={{ width: 220, marginBottom: 0 }} />
      </div>

      {droits.gerer && (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          <button onClick={() => { setCreation(!creation); setImporter(false); setSelection(null) }}>{creation ? 'Fermer' : '+ Ajouter un fournisseur'}</button>
          <button className="discret" onClick={() => { setImporter(!importer); setCreation(false); setSelection(null) }}>{importer ? 'Fermer l’import' : 'Importer (CSV)'}</button>
        </div>
      )}
      {!droits.gerer && (
        <p className="aide">Lecture seule : la gestion de l'annuaire demande le droit de modifier les référentiels sur un événement de l'organisation.</p>
      )}

      {creation && (
        <FicheFournisseur organisation={organisation} evenement={evenement} fournisseur={null} peutGerer setMessage={setMessage}
          onFait={() => { setCreation(false); charger() }} onFermer={() => setCreation(false)} />
      )}
      {importer && (
        <ImportFournisseurs organisation={organisation} evenement={evenement} existants={lignes} setMessage={setMessage}
          onFait={() => { setImporter(false); charger() }} />
      )}
      {ouvert && (
        <FicheFournisseur organisation={organisation} evenement={evenement} fournisseur={ouvert} peutGerer={droits.gerer} setMessage={setMessage}
          onFait={charger} onFermer={() => setSelection(null)} />
      )}

      {visibles.length === 0 ? (
        <p className="vide">{lignes.length ? 'Aucun fournisseur ne répond au filtre.' : 'Aucun fournisseur. Ajoute-les un par un, ou importe ton tableur.'}</p>
      ) : (
        visibles.map((f) => (
          <div className={`carte four-carte ${!f.actif ? 'four-inactif' : ''} ${selection === f.id ? 'selectionne' : ''}`} key={f.id} data-nom={f.nom}>
            <div className="titre">
              {f.nom}
              {!f.actif && <span className="etiquette"> inactif</span>}
              {f.note_moyenne != null && <span className="four-note" title={`${f.nb_evaluations} évaluation(s)`}> {'★'.repeat(Math.round(f.note_moyenne))} {f.note_moyenne}</span>}
              {f.dernier_verdict && <span className={`four-verdict verdict-${f.dernier_verdict}`}>{libelleVerdict(f.dernier_verdict)}</span>}
            </div>
            <div className="meta">
              {(f.categories ?? []).map((c) => <span key={c} className="etiquette">{libelleCategorieFournisseur(c)}</span>)}
              {f.contact_nom && <span>{f.contact_nom}{f.contact_fonction ? ` (${f.contact_fonction})` : ''}</span>}
              {(f.contact_telephone || f.telephone) && <span className="mono">{f.contact_telephone || f.telephone}</span>}
              {(f.contact_email || f.email) && <span>{f.contact_email || f.email}</span>}
              {f.zone && <span>{f.zone}</span>}
              <span className="sourdine">{f.nb_consultations} consultation{f.nb_consultations > 1 ? 's' : ''}{f.nb_retenues ? `, ${f.nb_retenues} retenue${f.nb_retenues > 1 ? 's' : ''}` : ''}</span>
            </div>
            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button className="discret" onClick={() => { setSelection(selection === f.id ? null : f.id); setCreation(false); setImporter(false) }}>{selection === f.id ? 'Fermer' : 'Ouvrir'}</button>
              {peutEpingler && <button className="discret" onClick={() => epingler(f)}>Épingler dans les contacts de l'événement</button>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

/* ================================================================== */
/* La fiche : coordonnées, catégories, contacts, historique, évaluations */
/* ================================================================== */

const VIDE = { nom: '', tva: '', adresse: '', site: '', telephone: '', email: '', zone: '', notes: '', categories: [], actif: true }

export function FicheFournisseur({ organisation, evenement, fournisseur, peutGerer, setMessage, onFait, onFermer }) {
  const [v, setV] = useState(() => (fournisseur ? { ...VIDE, ...fournisseur, categories: fournisseur.categories ?? [] } : VIDE))
  const [contacts, setContacts] = useState([])
  const [historique, setHistorique] = useState([])
  const [evaluations, setEvaluations] = useState([])
  const [nouveau, setNouveau] = useState({ nom: '', fonction: '', telephone: '', email: '' })
  const [occupe, setOccupe] = useState(false)
  const champ = (k) => (e) => setV({ ...v, [k]: e.target.value })

  async function chargerDetail() {
    if (!fournisseur) return
    const [c, h, e] = await Promise.all([
      supabase.from('fournisseur_contacts').select('*').eq('fournisseur_id', fournisseur.id).is('deleted_at', null).order('principal', { ascending: false }).order('created_at'),
      supabase.rpc('historique_fournisseur', { p_fournisseur: fournisseur.id }),
      supabase.from('fournisseur_evaluations').select('*, evenements(nom)').eq('fournisseur_id', fournisseur.id).is('deleted_at', null).order('created_at', { ascending: false })
    ])
    setContacts(c.data ?? [])
    setHistorique(h.data ?? [])
    setEvaluations(e.data ?? [])
  }
  useEffect(() => {
    chargerDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fournisseur?.id])

  async function enregistrer() {
    if (!v.nom.trim()) return
    setOccupe(true)
    const champs = {
      nom: v.nom.trim(), tva: v.tva || null, adresse: v.adresse || null, site: v.site || null, telephone: v.telephone || null,
      email: v.email || null, zone: v.zone || null, notes: v.notes || null, categories: v.categories, actif: v.actif
    }
    if (fournisseur) {
      const refus = await modifierOuRefuser('fournisseurs', champs, { id: fournisseur.id })
      if (refus) setMessage({ type: 'erreur', texte: refus })
      else { setMessage({ type: 'info', texte: 'Fournisseur enregistré.' }); onFait() }
    } else {
      const { error } = await supabase.from('fournisseurs').insert({ ...champs, organisation_id: organisation })
      if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
      else onFait()
    }
    setOccupe(false)
  }

  async function supprimer() {
    if (!window.confirm(`Retirer « ${fournisseur.nom} » de l'annuaire ? Ses consultations passées restent lisibles.`)) return
    const refus = await supprimerOuRefuser('fournisseurs', fournisseur.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { onFermer(); onFait() }
  }

  async function ajouterContact() {
    if (!nouveau.nom.trim()) return
    const { error } = await supabase.from('fournisseur_contacts').insert({
      fournisseur_id: fournisseur.id, nom: nouveau.nom.trim(), fonction: nouveau.fonction || null,
      telephone: nouveau.telephone || null, email: nouveau.email || null, principal: contacts.length === 0
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else { setNouveau({ nom: '', fonction: '', telephone: '', email: '' }); chargerDetail(); onFait() }
  }
  async function principal(c) {
    const refus = await modifierOuRefuser('fournisseur_contacts', { principal: true }, { id: c.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { chargerDetail(); onFait() }
  }
  async function retirerContact(c) {
    const refus = await supprimerOuRefuser('fournisseur_contacts', c.id)
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else { chargerDetail(); onFait() }
  }

  const lecture = !peutGerer
  return (
    <div className="formulaire four-fiche">
      <div className="four-fiche-tete">
        <strong>{fournisseur ? fournisseur.nom : 'Nouveau fournisseur'}</strong>
        <button className="discret" onClick={onFermer}>✕</button>
      </div>
      <div className="grille-champs four-grille">
        <label>Nom<input value={v.nom} onChange={champ('nom')} disabled={lecture} /></label>
        <label>N° TVA<input value={v.tva ?? ''} onChange={champ('tva')} disabled={lecture} placeholder="BE 0123.456.789" /></label>
        <label>Téléphone<input value={v.telephone ?? ''} onChange={champ('telephone')} disabled={lecture} /></label>
        <label>Courriel<input value={v.email ?? ''} onChange={champ('email')} disabled={lecture} /></label>
        <label>Site<input value={v.site ?? ''} onChange={champ('site')} disabled={lecture} /></label>
        <label>Zone d'action<input value={v.zone ?? ''} onChange={champ('zone')} disabled={lecture} placeholder="province de Liège, toute la Belgique…" /></label>
        <label className="four-large">Adresse<input value={v.adresse ?? ''} onChange={champ('adresse')} disabled={lecture} /></label>
        <label className="four-large">Notes<textarea value={v.notes ?? ''} onChange={champ('notes')} disabled={lecture} rows={2} /></label>
      </div>
      <div className="four-categories">
        {CATEGORIES_FOURNISSEUR.map(([c, l, ex]) => (
          <label key={c} className="case-a-cocher" title={ex}>
            <input type="checkbox" disabled={lecture} checked={v.categories.includes(c)}
              onChange={(e) => setV({ ...v, categories: e.target.checked ? [...v.categories, c] : v.categories.filter((x) => x !== c) })} /> {l}
          </label>
        ))}
      </div>
      {fournisseur && (
        <label className="case-a-cocher">
          <input type="checkbox" disabled={lecture} checked={!!v.actif} onChange={(e) => setV({ ...v, actif: e.target.checked })} /> Actif (proposé dans les demandes de prix)
        </label>
      )}
      {peutGerer && (
        <div className="ligne-boutons">
          <button onClick={enregistrer} disabled={occupe || !v.nom.trim()}>{fournisseur ? 'Enregistrer' : 'Créer'}</button>
          {fournisseur && <button className="danger" onClick={supprimer}>Retirer de l'annuaire</button>}
        </div>
      )}

      {fournisseur && (
        <>
          <h3>Contacts</h3>
          {contacts.length === 0 && <p className="vide">Aucun contact. Le premier ajouté devient le contact principal.</p>}
          {contacts.map((c) => (
            <div className="four-contact" key={c.id}>
              <span>{c.principal ? '★ ' : ''}<strong>{c.nom}</strong>{c.fonction ? ` · ${c.fonction}` : ''}</span>
              {c.telephone && <span className="mono">{c.telephone}</span>}
              {c.email && <span>{c.email}</span>}
              {peutGerer && (
                <span className="ligne-boutons">
                  {!c.principal && <button className="lien" onClick={() => principal(c)}>principal</button>}
                  <button className="lien" onClick={() => retirerContact(c)}>retirer</button>
                </span>
              )}
            </div>
          ))}
          {peutGerer && (
            <div className="saisie-rapide">
              <input value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} placeholder="Nom du contact" />
              <input value={nouveau.fonction} onChange={(e) => setNouveau({ ...nouveau, fonction: e.target.value })} placeholder="Fonction" style={{ flex: '0 1 140px' }} />
              <input value={nouveau.telephone} onChange={(e) => setNouveau({ ...nouveau, telephone: e.target.value })} placeholder="Téléphone" style={{ flex: '0 1 140px' }} />
              <input value={nouveau.email} onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })} placeholder="Courriel" />
              <button className="discret" onClick={ajouterContact} disabled={!nouveau.nom.trim()}>Ajouter</button>
            </div>
          )}

          <h3>Consultations, tous événements</h3>
          {historique.length === 0 ? <p className="vide">Jamais consulté.</p> : (
            <table className="tableau four-historique">
              <thead><tr><th>Événement</th><th>Demande</th><th>Statut</th><th>Montant HT</th></tr></thead>
              <tbody>
                {historique.map((h) => (
                  <tr key={h.consultation_id} className={h.retenue ? 'four-retenue' : ''}>
                    <td>{h.evenement}</td>
                    <td><span className="mono">{h.reference}</span> {h.objet}</td>
                    <td>{libelleDe(STATUTS_CONSULTATION, h.statut)}</td>
                    <td className="mono">{h.montant_ht != null ? euros(h.montant_ht) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Évaluations</h3>
          {evaluations.length === 0 ? <p className="vide">Pas encore évalué. L'évaluation se fait dans Analyse / REX, dès le démontage.</p> : (
            evaluations.map((e) => (
              <div className="four-evaluation" key={e.id}>
                <span>{'★'.repeat(e.note)}{'☆'.repeat(5 - e.note)}</span>
                <span className={`four-verdict verdict-${e.verdict}`}>{libelleVerdict(e.verdict)}</span>
                <span>{e.evenements?.nom}</span>
                {e.commentaire && <span className="sourdine">{e.commentaire}</span>}
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}

export const euros = (n) => Number(n).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/* ================================================================== */
/* Import CSV : réimport tolérant sur le nom (met à jour, ne doublonne pas) */
/* ================================================================== */

function ImportFournisseurs({ organisation, evenement, existants, setMessage, onFait }) {
  const [analyse, setAnalyse] = useState(null)
  const [mode, setMode] = useState('ajouter')
  const [nomFichier, setNomFichier] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [bilan, setBilan] = useState(null)
  const parNom = useMemo(() => new Map(existants.map((f) => [normaliser(f.nom), f])), [existants])
  const codes = new Set(CATEGORIES_FOURNISSEUR.map(([c]) => c))
  const parLibelle = new Map(CATEGORIES_FOURNISSEUR.map(([c, l]) => [normaliser(l), c]))

  function analyser(fichier) {
    setBilan(null)
    setNomFichier(fichier.name)
    Papa.parse(fichier, {
      header: true, skipEmptyLines: true, transformHeader: normaliserEntete,
      complete: (res) => {
        const entetes = res.meta.fields ?? []
        if (!entetes.includes('nom')) {
          setMessage({ type: 'erreur', texte: `Colonne « nom » absente. En-têtes lues : ${entetes.join(' ; ') || 'aucune'}. Attendu : ${COLONNES_FOURNISSEURS.map((c) => c.champ).join(' ; ')}.` })
          return
        }
        const vus = new Set()
        const lignes = res.data.map((b, i) => {
          const nom = (b.nom ?? '').trim()
          const erreurs = []
          if (!nom) erreurs.push('nom manquant')
          const cle = normaliser(nom)
          if (nom && vus.has(cle)) erreurs.push('nom en double dans le fichier')
          vus.add(cle)
          const categories = String(b.categories ?? '').split(/[|,;]/).map((x) => x.trim()).filter(Boolean)
            .map((x) => (codes.has(x) ? x : parLibelle.get(normaliser(x)) ?? null))
          const inconnues = String(b.categories ?? '').split(/[|,;]/).map((x) => x.trim()).filter(Boolean).filter((x, k) => categories[k] == null)
          if (inconnues.length) erreurs.push(`catégorie inconnue : ${inconnues.join(', ')}`)
          const existant = parNom.get(cle)
          return {
            numero: i + 2, erreurs, existant,
            statut: erreurs.length ? 'rejete' : existant ? 'existant' : 'nouveau',
            valeurs: {
              nom, tva: b.tva || null, adresse: b.adresse || null, telephone: b.telephone || null, email: b.email || null,
              categories: categories.filter(Boolean), notes: b.notes || null
            },
            contact: b.contact_nom ? { nom: b.contact_nom, fonction: b.contact_fonction || null, telephone: b.contact_telephone || null, email: b.contact_email || null } : null
          }
        })
        setAnalyse({ lignes, entetes })
      },
      error: (e) => setMessage({ type: 'erreur', texte: texteErreur(e) })
    })
  }

  async function appliquer() {
    setOccupe(true)
    const valides = analyse.lignes.filter((l) => l.statut !== 'rejete')
    const nouveaux = valides.filter((l) => !l.existant)
    const existantsL = valides.filter((l) => l.existant)
    let creees = 0, modifiees = 0, refusees = 0
    try {
      if (mode !== 'ignorer' && nouveaux.length) {
        const { data, error } = await supabase.from('fournisseurs')
          .insert(nouveaux.map((l) => ({ ...l.valeurs, organisation_id: organisation, origine: 'import' })))
          .select('id, nom')
        if (error) throw error
        creees = nouveaux.length
        const ids = new Map((data ?? []).map((f) => [normaliser(f.nom), f.id]))
        const contacts = nouveaux.filter((l) => l.contact && ids.get(normaliser(l.valeurs.nom)))
          .map((l) => ({ ...l.contact, fournisseur_id: ids.get(normaliser(l.valeurs.nom)), principal: true }))
        if (contacts.length) {
          const r = await supabase.from('fournisseur_contacts').insert(contacts)
          if (r.error) throw r.error
        }
      }
      if (mode === 'mettre_a_jour') {
        for (const l of existantsL) {
          const refus = await modifierOuRefuser('fournisseurs', l.valeurs, { id: l.existant.id })
          if (refus) refusees++
          else modifiees++
        }
      }
      const resultat = {
        lues: analyse.lignes.length, creees, modifiees,
        ignorees: mode === 'ajouter' ? existantsL.length : mode === 'ignorer' ? valides.length : 0,
        rejetees: analyse.lignes.length - valides.length
      }
      await supabase.from('journal_imports').insert({
        evenement_id: evenement.id, ressource: 'fournisseurs', fichier: nomFichier, mode,
        lignes_lues: resultat.lues, lignes_creees: resultat.creees, lignes_modifiees: resultat.modifiees,
        lignes_ignorees: resultat.ignorees, lignes_rejetees: resultat.rejetees,
        detail: { rejets: analyse.lignes.filter((l) => l.statut === 'rejete').map((l) => ({ ligne: l.numero, erreurs: l.erreurs })) }
      })
      setBilan(resultat)
      if (refusees) setMessage({ type: 'erreur', texte: `${refusees} ligne(s) refusée(s) : vos droits ne permettent pas de modifier l'annuaire.` })
      setAnalyse(null)
      onFait()
    } catch (e) {
      setMessage({ type: 'erreur', texte: texteErreur(e) })
    }
    setOccupe(false)
  }

  function telechargerModele() {
    const url = URL.createObjectURL(new Blob(['﻿' + modeleCsvFournisseurs()], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'fournisseurs.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="formulaire four-import">
      <h3>Importer des fournisseurs</h3>
      <p className="aide">
        Colonnes : <span className="mono">{COLONNES_FOURNISSEURS.map((c) => c.champ).join(' ; ')}</span>. Les catégories sont séparées par « | » (codes ou libellés).
        Un nom déjà dans l'annuaire est mis à jour si tu le demandes, jamais doublonné.{' '}
        <button className="lien" onClick={telechargerModele}>Télécharger le modèle</button>
      </p>
      <div className="saisie-rapide">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && analyser(e.target.files[0])} />
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: 'auto', marginBottom: 0 }}>
          <option value="ajouter">Ajouter les nouveaux seulement</option>
          <option value="mettre_a_jour">Ajouter et mettre à jour les existants</option>
          <option value="ignorer">Analyser sans écrire</option>
        </select>
      </div>
      {analyse && (
        <>
          <p>
            {analyse.lignes.filter((l) => l.statut === 'nouveau').length} à créer, {analyse.lignes.filter((l) => l.statut === 'existant').length} déjà connus, {analyse.lignes.filter((l) => l.statut === 'rejete').length} rejetés.
          </p>
          {analyse.lignes.filter((l) => l.statut === 'rejete').map((l) => (
            <p key={l.numero} className="aide alerte">ligne {l.numero} : {l.erreurs.join(', ')}</p>
          ))}
          <div className="ligne-boutons">
            <button onClick={appliquer} disabled={occupe}>Appliquer</button>
            <button className="discret" onClick={() => setAnalyse(null)}>Annuler</button>
          </div>
        </>
      )}
      {bilan && (
        <p className="aide">Import terminé : {bilan.creees} créé(s), {bilan.modifiees} mis à jour, {bilan.ignorees} ignoré(s), {bilan.rejetees} rejeté(s).</p>
      )}
    </div>
  )
}
