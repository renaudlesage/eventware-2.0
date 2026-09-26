import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { DOMAINES } from './libelles'
import { texteErreur } from './erreurs'

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

export function Journal({ evenement, setMessage, moduleParDefaut = 'securite', peut, toutPouvoir }) {
  const [lignes, setLignes] = useState([])
  const [texte, setTexte] = useState('')
  const [moduleSaisie, setModuleSaisie] = useState(moduleParDefaut)
  const [filtre, setFiltre] = useState('tout')
  const [filtreModule, setFiltreModule] = useState('tout')
  const [occupe, setOccupe] = useState(false)

  // Policy `journal_creation` : `journal:creer` — chef d'équipe et
  // bénévole n'ont que la lecture. Les deux écrans qui montent ce
  // composant (Sécurité, Logistique) transmettent `peut`.
  const peutInscrire = toutPouvoir || peut?.('journal', 'creer')

  async function charger() {
    const { data, error } = await supabase
      .from('journal')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('horodatage', { ascending: false })
      .limit(200)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function ajouter() {
    if (!texte.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('journal').insert({
      evenement_id: evenement.id,
      source: 'saisie',
      module: moduleSaisie,
      categorie: 'observation',
      texte: texte.trim(),
      phase: evenement.phase
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setTexte('')
      charger()
    }
    setOccupe(false)
  }

  const visibles = lignes
    .filter((l) =>
      filtre === 'tout' ? true : filtre === 'saisie' ? l.source === 'saisie' : l.importance === 'majeur'
    )
    .filter((l) => filtreModule === 'tout' || l.module === filtreModule)

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
          <button disabled={occupe || !texte.trim()} onClick={ajouter}>
            Inscrire
          </button>
        </div>
      )}

      <div className="ligne-boutons" style={{ marginBottom: 6 }}>
        {[
          ['tout', 'Tout'],
          ['majeur', 'Majeur'],
          ['saisie', 'Saisies']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button
          className={`discret ${filtreModule === 'tout' ? 'actif' : ''}`}
          onClick={() => setFiltreModule('tout')}
        >
          Tous domaines
        </button>
        {MODULES_JOURNAL.map(([v, l]) => (
          <button
            key={v}
            className={`discret ${filtreModule === v ? 'actif' : ''}`}
            onClick={() => setFiltreModule(v)}
          >
            {l}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucune entrée.</p>
      ) : (
        <ul className="chrono">
          {visibles.map((l) => (
            <li key={l.id} className={`imp-${l.importance} src-${l.source}`}>
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
      <p className="aide">
        Une seule main courante pour la sécurité et la logistique — délibérément. Comprendre
        après coup les circonstances logistiques d'un événement sécurité demande qu'elles
        soient au même endroit, pas dans deux journaux qu'il faudrait recouper. Les entrées
        grises sont écrites automatiquement par les autres modules. Rien ne peut être modifié
        ni supprimé : une main courante qui se réécrit n'a aucune valeur.
      </p>
    </>
  )
}

