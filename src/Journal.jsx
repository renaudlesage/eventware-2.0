import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { DOMAINES } from './libelles'
import { texteErreur } from './erreurs'
import { ecrireOuEmpiler } from './fileEcritures'
import { nouvelleCle } from './reessai'

/**
 * Main courante (journal), sorti de Securite.jsx au lot 12 (26/09),
 * sans changement de comportement. Aussi utilisé par Logistique.
 */

/* ================================================================== */
/* Main courante                                                       */
/* ================================================================== */

// Pour la saisie manuelle : uniquement les domaines qu'une personne
// choisit elle-même, importés du module partagé — « Météo », « noyau »
// (alertes système) et « Analyse » n'existent que par écriture
// automatique, inutile de les proposer à la saisie, mais leurs
// entrées doivent rester filtrables et lisibles au même titre que les
// autres.
export const MODULES_SAISIE = DOMAINES
const MODULES_JOURNAL = [
  ...MODULES_SAISIE,
  ['meteo', 'Météo'],
  ['analyse', 'Analyse'],
  ['noyau', 'Plateforme']
]
export const LIBELLE_MODULE = Object.fromEntries(MODULES_JOURNAL)

export function Journal({ evenement, setMessage, moduleParDefaut = 'securite', peut, toutPouvoir, membre }) {
  const [lignes, setLignes] = useState([])
  const [texte, setTexte] = useState('')
  const [moduleSaisie, setModuleSaisie] = useState(moduleParDefaut)
  const [filtre, setFiltre] = useState('tout')
  const [filtreModule, setFiltreModule] = useState('tout')
  const [majeur, setMajeur] = useState(false)
  const [occupe, setOccupe] = useState(false)

  // Policy `journal_creation` : `journal:creer` — le coordinateur, et
  // depuis la 124 le chef d'équipe sur les phases terrain (il tenait la
  // main courante de son secteur dans BFMF) ; le bénévole lit. Les deux
  // écrans qui montent ce composant (Sécurité, Logistique) transmettent
  // `peut`.
  const peutInscrire = toutPouvoir || peut?.('journal', 'creer')

  // (11/11, audit C6) La liste était coupée à 200 lignes sans le dire, filtrée
  // après coup, et son compteur passait pour un total. Les filtres et la
  // recherche partent maintenant au serveur, le total est le vrai, et on
  // charge la suite à la demande.
  const PAS = 200
  const [limite, setLimite] = useState(PAS)
  const [total, setTotal] = useState(null)
  const [recherche, setRecherche] = useState('')
  const [charge, setCharge] = useState(false)

  async function charger() {
    let requete = supabase
      .from('journal')
      .select('*', { count: 'exact' })
      .eq('evenement_id', evenement.id)
    if (filtre === 'majeur') requete = requete.eq('importance', 'majeur')
    if (filtre === 'saisie') requete = requete.eq('source', 'saisie')
    if (filtreModule !== 'tout') requete = requete.eq('module', filtreModule)
    const q = recherche.trim()
    if (q) requete = requete.ilike('texte', `%${q.replace(/[%_]/g, ' ')}%`)
    const { data, error, count } = await requete.order('horodatage', { ascending: false }).range(0, limite - 1)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setLignes(data ?? [])
      setTotal(count ?? (data ?? []).length)
    }
    setCharge(true)
  }

  useEffect(() => {
    // La recherche attend la fin de la frappe ; le reste part tout de suite.
    const attente = setTimeout(charger, recherche ? 300 : 0)
    const t = setInterval(charger, 20000)
    return () => { clearTimeout(attente); clearInterval(t) }
  }, [evenement.id, filtre, filtreModule, recherche, limite])

  async function ajouter() {
    if (!texte.trim()) return
    setOccupe(true)
    // (audit C4) Par la file : une ligne dictée hors réseau part au retour du
    // signal. Elle porte son identifiant, donc un rejeu ne la double pas.
    const r = await ecrireOuEmpiler({
      nature: 'insert',
      table: 'journal',
      libelle: `Main courante : ${texte.trim().slice(0, 40)}`,
      champs: {
        id: nouvelleCle(),
        evenement_id: evenement.id,
        source: 'saisie',
        module: moduleSaisie,
        categorie: 'observation',
        texte: texte.trim(),
        phase: evenement.phase,
        horodatage: new Date().toISOString(),
        // Le nom tel qu'il se lit, figé à l'écriture : un SITREP doit
        // dire qui a consigné, même si le membre quitte l'événement
        // ensuite (comparatif BFMF 2026, main courante).
        auteur_nom: membre?.nom_affiche ?? null,
        // « Majeur » à la saisie (122) : BFMF avait l'étoile « Important »
        // ; ici l'importance n'était posée que par les déclencheurs.
        importance: majeur ? 'majeur' : 'routine'
      }
    })
    if (r.statut === 'refus') setMessage({ type: 'erreur', texte: r.message })
    else {
      if (r.statut === 'enfile') setMessage({ type: 'info', texte: 'Hors réseau : la ligne est gardée sur cet appareil et partira au retour du signal.' })
      setTexte('')
      setMajeur(false)
      charger()
    }
    setOccupe(false)
  }

  // Le serveur a déjà filtré.
  const visibles = lignes
  const filtree = filtre !== 'tout' || filtreModule !== 'tout' || !!recherche.trim()
  const jourDe = (iso) => new Date(iso).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      {peutInscrire && (
        <div className="saisie-rapide">
          <select
            value={moduleSaisie}
            onChange={(e) => setModuleSaisie(e.target.value)}
            style={{ flex: '0 1 150px' }}
          >
            {MODULES_SAISIE.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ajouter()}
            placeholder="Observation, décision, appel radio…"
          />
          <label className="case-a-cocher" title="Entrée majeure : mise en avant dans le journal et le SITREP">
            <input type="checkbox" checked={majeur} onChange={(e) => setMajeur(e.target.checked)} />
            Majeur
          </label>
          <button disabled={occupe || !texte.trim()} onClick={ajouter}>
            Inscrire
          </button>
        </div>
      )}

      {/* (29/10, retour de Ren) Deux listes au lieu de quatorze boutons :
          ce qu'on montre (tout, majeur, saisies) et le domaine. */}
      <div className="journal-filtres">
        <label>
          Afficher
          <select value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Afficher">
            <option value="tout">Tout</option>
            <option value="majeur">Majeur seulement</option>
            <option value="saisie">Saisies à la main</option>
          </select>
        </label>
        <label>
          Domaine
          <select value={filtreModule} onChange={(e) => setFiltreModule(e.target.value)} aria-label="Domaine">
            <option value="tout">Tous domaines</option>
            {MODULES_JOURNAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          Chercher
          <input type="search" value={recherche} onChange={(e) => { setRecherche(e.target.value); setLimite(PAS) }} placeholder="un mot, une référence…" aria-label="Chercher dans la main courante" />
        </label>
        <span className="aide journal-compte" role="status">
          {total == null ? '' : visibles.length < total ? `${visibles.length} affichées sur ${total}` : `${total} entrée${total > 1 ? 's' : ''}`}
        </span>
      </div>

      {!charge ? (
        <p className="vide">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p className="vide">
          {filtree
            ? 'Aucune entrée ne correspond à ces filtres. Élargis la recherche ou repasse sur « Tout ».'
            : peutInscrire ? 'La main courante est vide. Inscris la première observation ci-dessus ; les autres modules y écrivent aussi d’eux-mêmes.' : 'La main courante est vide pour l’instant.'}
        </p>
      ) : (
        <ul className="chrono">
          {visibles.map((l, i) => (
            <li key={l.id} className={`imp-${l.importance} src-${l.source}`}>
              {(i === 0 || jourDe(visibles[i - 1].horodatage) !== jourDe(l.horodatage)) && <span className="chrono-jour">{jourDe(l.horodatage)}</span>}
              <span className="heure mono">
                {new Date(l.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {l.texte}
                {l.module && <span className="tag">{LIBELLE_MODULE[l.module] ?? l.module}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {charge && total != null && visibles.length < total && (
        <button className="discret" onClick={() => setLimite((l) => l + PAS)}>
          Afficher les {Math.min(PAS, total - visibles.length)} suivantes
        </button>
      )}
      <p className="aide">
        Les entrées grises sont écrites automatiquement par les autres modules. Rien ne peut être
        modifié ni supprimé.
      </p>
    </>
  )
}

