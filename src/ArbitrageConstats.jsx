import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { objetVise } from './objetVise'
import { texteErreur } from './erreurs'
import { DOMAINES, NATURES_REX, IMPACTS_REX } from './libelles'

/**
 * L'ARBITRAGE DES CONSTATS EN LOT (169).
 *
 * BFMF 2026 : 100 constats « à arbitrer », 4 arbitrés. Un par un, avec
 * quatre boutons et deux champs par carte, personne n'allait au bout.
 * Ce module ajoute à la liste des constats ce qu'il faut pour la
 * traiter comme une pile :
 *
 *   — des filtres (statut, nature, domaine, texte) et un tri par impact ;
 *   — une sélection multiple et des gestes en lot (retenir, rejeter,
 *     porteur, échéance) ;
 *   — le regroupement des doublons : les constats qui disent presque la
 *     même chose, à garder en un seul exemplaire ;
 *   — le report des constats retenus en jalons de l'édition suivante.
 *
 * Il rend des morceaux d'interface que la liste place où elle veut.
 */
const STATUTS = [['a_arbitrer', 'À arbitrer'], ['retenu', 'Retenus'], ['rejete', 'Rejetés'], ['realise', 'Réalisés']]
const RANG_IMPACT = { dangereux: 0, bloquant: 1, gene: 2, mineur: 3 }
const sansAccent = (t) => (t ?? '').toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '')
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`

export function useArbitrageLot({ evenement, lignes, charger, setMessage, actif }) {
  // Un lien direct vers un constat déjà arbitré doit le montrer : le filtre de statut se lève.
  const [statut, setStatut] = useState(() => (objetVise() ? 'tous' : 'a_arbitrer'))
  const [nature, setNature] = useState('toutes')
  const [domaine, setDomaine] = useState('tous')
  const [texte, setTexte] = useState('')
  const [tri, setTri] = useState('recents')
  const [selection, setSelection] = useState(() => new Set())
  const [occupe, setOccupe] = useState(false)
  const [porteur, setPorteur] = useState('')
  const [echeance, setEcheance] = useState('')
  const [groupes, setGroupes] = useState(null) // null : pas cherché ; [] : aucun doublon
  const [editions, setEditions] = useState([])
  const [cible, setCible] = useState('')

  // Les autres événements de l'organisation, pour le report ; celui qui se dit « édition suivante » d'abord.
  useEffect(() => {
    if (!actif || !evenement.organisation_id) return
    supabase.from('evenements').select('id, nom, date_debut, edition_precedente_id, phase').eq('organisation_id', evenement.organisation_id).neq('id', evenement.id).is('deleted_at', null).order('date_debut', { ascending: false })
      .then(({ data }) => {
        const liste = data ?? []
        setEditions(liste)
        setCible((c) => c || liste.find((e) => e.edition_precedente_id === evenement.id)?.id || '')
      })
  }, [evenement.id, evenement.organisation_id, actif])

  // Une sélection ne survit pas à un constat disparu.
  useEffect(() => {
    setSelection((s) => {
      const ids = new Set(lignes.map((r) => r.id))
      const garde = new Set([...s].filter((id) => ids.has(id)))
      return garde.size === s.size ? s : garde
    })
  }, [lignes])

  const comptes = useMemo(() => Object.fromEntries(STATUTS.map(([k]) => [k, lignes.filter((r) => (r.statut ?? 'a_arbitrer') === k).length])), [lignes])

  function filtrer(liste) {
    if (!actif) return liste
    const q = sansAccent(texte.trim())
    const sortie = liste.filter((r) =>
      (statut === 'tous' || (r.statut ?? 'a_arbitrer') === statut) &&
      (nature === 'toutes' || r.nature === nature) &&
      (domaine === 'tous' || r.module === domaine) &&
      (!q || sansAccent(r.constat).includes(q) || sansAccent(r.proposition).includes(q) || sansAccent(r.porteur).includes(q))
    )
    if (tri === 'impact') return [...sortie].sort((a, b) => (RANG_IMPACT[a.impact] ?? 9) - (RANG_IMPACT[b.impact] ?? 9) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    return sortie
  }

  const basculer = (id) => setSelection((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function appliquer(champs, libelle) {
    const ids = [...selection]
    if (!ids.length || occupe) return
    setOccupe(true)
    const { error, count } = await supabase.from('rex_entrees').update(champs, { count: 'exact' }).in('id', ids)
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    if (!count) return setMessage({ type: 'erreur', texte: 'Modification refusée : tes droits ne le permettent pas dans cette phase.' })
    setMessage({ type: 'succes', texte: `${pluriel(count, 'constat')} ${libelle}.` })
    setSelection(new Set())
    charger()
  }

  async function reporter() {
    const ids = [...selection]
    if (!ids.length || !cible || occupe) return
    const nom = editions.find((e) => e.id === cible)?.nom ?? 'l’édition suivante'
    setOccupe(true)
    const { data, error } = await supabase.rpc('rex_reporter', { p_evenement: evenement.id, p_cible: cible, p_ids: ids })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const n = Number(Array.isArray(data) ? data[0] : data) || 0
    setMessage({ type: n ? 'succes' : 'info', texte: n ? `${pluriel(n, 'constat')} reporté${n > 1 ? 's' : ''} en jalons de « ${nom} » (Planning › Jalons, codes REX-…).` : 'Rien à reporter : seuls les constats retenus ou réalisés, pas encore reportés, deviennent des jalons.' })
    setSelection(new Set())
    charger()
  }

  // Les doublons : des paires rendues par le serveur, assemblées ici en groupes.
  async function chercherDoublons() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('rex_doublons', { p_evenement: evenement.id })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const parent = {}
    const racine = (x) => (parent[x] === undefined || parent[x] === x ? x : (parent[x] = racine(parent[x])))
    for (const p of data ?? []) { parent[racine(p.id_a)] = racine(p.id_b) }
    const parRacine = {}
    for (const id of Object.keys(parent).concat((data ?? []).map((p) => p.id_b))) (parRacine[racine(id)] ??= new Set()).add(id)
    const parId = Object.fromEntries(lignes.map((r) => [r.id, r]))
    const g = Object.values(parRacine)
      .map((ids) => [...ids].map((id) => parId[id]).filter(Boolean).sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')))
      .filter((liste) => liste.length > 1)
      .sort((a, b) => b.length - a.length)
    setGroupes(g)
    if (!g.length) setMessage({ type: 'info', texte: 'Aucun doublon repéré parmi les constats à arbitrer.' })
  }

  async function fusionner(groupe) {
    const [garde, ...autres] = groupe
    setOccupe(true)
    const { error, count } = await supabase.from('rex_entrees')
      .update({ statut: 'rejete', suite: `Doublon de : ${garde.constat.slice(0, 120)}` }, { count: 'exact' })
      .in('id', autres.map((r) => r.id))
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    if (!count) return setMessage({ type: 'erreur', texte: 'Modification refusée : tes droits ne le permettent pas dans cette phase.' })
    setMessage({ type: 'succes', texte: `${pluriel(count, 'doublon')} écarté${count > 1 ? 's' : ''} ; le premier constat reste à arbitrer.` })
    setGroupes((g) => (g ?? []).filter((x) => x !== groupe))
    charger()
  }

  if (!actif) return { filtrer, barre: null, barreLot: null, doublons: null, caseCarte: () => null, visiblesIds: () => {} }

  const barre = (visibles) => (
    <div className="rex-lot-barre">
      <div className="onglets rex-statuts" role="group" aria-label="Statut des constats">
        {STATUTS.map(([k, l]) => (
          <button key={k} className={`module ${statut === k ? 'actif' : ''}`} aria-pressed={statut === k} onClick={() => setStatut(k)}>{l} ({comptes[k] ?? 0})</button>
        ))}
        <button className={`module ${statut === 'tous' ? 'actif' : ''}`} aria-pressed={statut === 'tous'} onClick={() => setStatut('tous')}>Tous ({lignes.length})</button>
      </div>
      <div className="rex-filtres">
        <label>Nature
          <select value={nature} onChange={(e) => setNature(e.target.value)}>
            <option value="toutes">Toutes</option>
            {NATURES_REX.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Domaine
          <select value={domaine} onChange={(e) => setDomaine(e.target.value)}>
            <option value="tous">Tous</option>
            {DOMAINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Trier par
          <select value={tri} onChange={(e) => setTri(e.target.value)}>
            <option value="recents">Les plus récents</option>
            <option value="impact">L’impact, du plus grave</option>
          </select>
        </label>
        <label>Chercher
          <input type="search" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="un mot du constat" />
        </label>
      </div>
      <div className="ligne-boutons rex-lot-selection">
        <button className="discret" onClick={() => setSelection(new Set(visibles.map((r) => r.id)))} disabled={!visibles.length}>Tout sélectionner ({visibles.length})</button>
        {selection.size > 0 && <button className="discret" onClick={() => setSelection(new Set())}>Ne rien sélectionner</button>}
        <button className="discret" onClick={chercherDoublons} disabled={occupe}>Regrouper les doublons</button>
      </div>
    </div>
  )

  const barreLot = selection.size > 0 && (
    <div className="rex-lot-actions" role="region" aria-label="Gestes sur la sélection">
      <strong>{pluriel(selection.size, 'constat')} sélectionné{selection.size > 1 ? 's' : ''}</strong>
      <div className="ligne-boutons">
        <button disabled={occupe} onClick={() => appliquer({ statut: 'retenu' }, `retenu${selection.size > 1 ? 's' : ''}`)}>Retenir</button>
        <button className="discret" disabled={occupe} onClick={() => appliquer({ statut: 'rejete' }, `rejeté${selection.size > 1 ? 's' : ''}`)}>Rejeter</button>
        <button className="discret" disabled={occupe} onClick={() => appliquer({ statut: 'realise' }, `marqué${selection.size > 1 ? 's' : ''} réalisé${selection.size > 1 ? 's' : ''}`)}>Réalisé</button>
        <button className="discret" disabled={occupe} onClick={() => appliquer({ statut: 'a_arbitrer' }, `remis${selection.size > 1 ? '' : ''} à arbitrer`)}>Remettre à arbitrer</button>
      </div>
      <div className="saisie-rapide">
        <input value={porteur} onChange={(e) => setPorteur(e.target.value)} placeholder="Porteur" aria-label="Porteur pour la sélection" />
        <input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} aria-label="Échéance pour la sélection" style={{ flex: '0 1 160px' }} />
        <button className="discret" disabled={occupe || (!porteur.trim() && !echeance)} onClick={() => appliquer({ ...(porteur.trim() ? { porteur: porteur.trim() } : {}), ...(echeance ? { echeance } : {}) }, 'mis à jour (porteur, échéance)')}>Appliquer</button>
      </div>
      {editions.length > 0 && (
        <div className="saisie-rapide rex-report">
          <select value={cible} onChange={(e) => setCible(e.target.value)} aria-label="Édition qui reçoit les constats retenus" style={{ width: 'auto', marginBottom: 0 }}>
            <option value="">— reporter dans… —</option>
            {editions.map((e) => <option key={e.id} value={e.id}>{e.nom}{e.edition_precedente_id === evenement.id ? ' (édition suivante)' : ''}</option>)}
          </select>
          <button className="discret" disabled={occupe || !cible} onClick={reporter} title="Chaque constat retenu devient un jalon de préparation, un mois avant l’événement">Reporter en jalons</button>
        </div>
      )}
    </div>
  )

  const doublons = groupes && groupes.length > 0 && (
    <div className="rex-doublons" role="region" aria-label="Doublons repérés">
      <div className="pave-titre">{pluriel(groupes.length, 'groupe')} de constats qui disent presque la même chose</div>
      {groupes.map((g, i) => (
        <div className="carte" key={g[0].id}>
          <ul>
            {g.map((r, j) => <li key={r.id}>{j === 0 ? <strong>{r.constat}</strong> : r.constat}</li>)}
          </ul>
          <div className="ligne-boutons">
            <button className="discret" disabled={occupe} onClick={() => fusionner(g)}>Garder le premier, écarter {pluriel(g.length - 1, 'doublon')}</button>
            <button className="lien" onClick={() => setGroupes(groupes.filter((_, k) => k !== i))}>Ce ne sont pas des doublons</button>
          </div>
        </div>
      ))}
    </div>
  )

  const caseCarte = (r) => (
    <label className="rex-case">
      <input type="checkbox" checked={selection.has(r.id)} onChange={() => basculer(r.id)} aria-label={`Sélectionner le constat : ${r.constat.slice(0, 60)}`} />
    </label>
  )

  return { filtrer, barre, barreLot, doublons, caseCarte }
}

export const LIBELLE_IMPACT = Object.fromEntries(IMPACTS_REX)
