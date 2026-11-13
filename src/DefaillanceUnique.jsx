import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * Bilan « Éléments uniques » du plan d'implantation (13/11, migration 174).
 *
 * Le plan dit où sont les choses ; il ne disait pas ce qui se passe
 * quand l'une d'elles manque. La fonction `defaillance_unique` retire
 * un à un les moyens de sécurité et rend ce qui tombe : un DEA sans
 * lequel le suivant est à deux kilomètres, un groupe qui alimente seul
 * le QG, un groupe électrogène autour duquel se trouvent à la fois le
 * DEA, le QG et le poste de soins.
 *
 * Ce bilan ne calcule rien : il affiche ce que le serveur rend, le plus
 * grave d'abord, et laisse régler les seuils — ce sont des hypothèses
 * de travail, pas des normes. Un élément cité s'ouvre dans Conception,
 * là où on le déplace.
 */
const LIBELLE_FONCTION = {
  DEFIB: 'Défibrillation',
  SOINS: 'Soins',
  EXTINCTION: 'Extinction',
  SECOURISTES: 'Secouristes',
  SORTIES: 'Sorties de secours',
  RASSEMBLEMENT: 'Point de rassemblement',
  'ACCÈS SECOURS': 'Accès des secours',
  ALERTE: 'Alerte',
  COMMANDEMENT: 'Commandement',
  QG: 'QG',
  'ÉNERGIE': 'Énergie',
  'CAUSE COMMUNE': 'Cause commune',
  SITE: 'Site'
}
// Le niveau rendu par le serveur : 3 non assurée ou surcharge, 2 élément unique, 1 à vérifier, 0 tient.
const ETAT = { 3: 'chaud', 2: 'veille', 1: '', 0: '' }

export const SEUILS_DEFAUT = { dea: 225, soins: 300, extinct: 20, voisin: 30, site: 500 }
const SEUILS = [
  ['dea', 'DEA à portée d’un lieu public', 'm'],
  ['soins', 'Poste de soins à portée d’un lieu public', 'm'],
  ['extinct', 'Extincteur à portée d’un élément à risque', 'm'],
  ['voisin', 'Voisinage d’un élément à risque', 'm'],
  ['site', 'Rayon du site autour du point 0', 'm']
]

const enPhrase = (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : '')

export default function DefaillanceUnique({ evenement, elements, onOuvrir, onCompte }) {
  const [lignes, setLignes] = useState(null)
  const [etat, setEtat] = useState('charge') // charge | pret | absent | erreur
  const [erreur, setErreur] = useState(null)
  const [seuils, setSeuils] = useState(SEUILS_DEFAUT)
  const [saisie, setSaisie] = useState(SEUILS_DEFAUT)

  async function calculer(s = seuils) {
    setEtat('charge')
    const { data, error } = await supabase.rpc('defaillance_unique', {
      p_evenement: evenement.id, p_dea_m: s.dea, p_soins_m: s.soins, p_extinct_m: s.extinct, p_voisin_m: s.voisin, p_site_m: s.site
    })
    if (error) {
      // La fonction arrive avec la migration 174 : tant qu'elle n'est pas appliquée, on le dit simplement.
      const absente = error.code === 'PGRST202' || /defaillance_unique/.test(error.message ?? '')
      setEtat(absente ? 'absent' : 'erreur')
      setErreur(absente ? null : texteErreur(error))
      setLignes(null)
      onCompte?.(null)
      return
    }
    const l = data ?? []
    setLignes(l)
    setEtat('pret')
    onCompte?.(l.filter((x) => x.niveau >= 2).length)
  }
  useEffect(() => {
    calculer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  const parCode = useMemo(() => new Map((elements ?? []).filter((e) => e.code).map((e) => [e.code, e])), [elements])
  const compte = (n) => (lignes ?? []).filter((l) => l.niveau === n).length
  // Le plus grave d'abord ; à gravité égale, l'ordre du serveur (fonction par fonction).
  const aTraiter = useMemo(() => (lignes ?? []).filter((l) => l.niveau > 0).sort((a, b) => b.niveau - a.niveau || a.ordre - b.ordre), [lignes])
  const tient = useMemo(() => (lignes ?? []).filter((l) => l.niveau === 0), [lignes])
  const modifies = SEUILS.some(([k]) => seuils[k] !== SEUILS_DEFAUT[k])

  function appliquerSeuils(e) {
    e.preventDefault()
    const propres = Object.fromEntries(SEUILS.map(([k]) => [k, Math.max(1, Math.round(Number(saisie[k]) || SEUILS_DEFAUT[k]))]))
    setSeuils(propres)
    setSaisie(propres)
    calculer(propres)
  }

  return (
    <section className="unique">
      {etat === 'absent' && (
        <p className="aide" role="status">Cette analyse n'est pas encore activée sur cette base (migration 174).</p>
      )}
      {etat === 'erreur' && <p className="message erreur" role="alert">{erreur}</p>}
      {etat === 'charge' && !lignes && <p className="aide" role="status">Analyse du plan…</p>}

      {lignes && (
        <>
          <div className="etat prc-cadrans">
            <Cadran libelle="Fonctions non assurées" v={compte(3)} etat={compte(3) ? 'chaud' : ''} />
            <Cadran libelle="Éléments uniques" v={compte(2)} etat={compte(2) ? 'veille' : ''} />
            <Cadran libelle="À vérifier" v={compte(1)} />
            <Cadran libelle="Tient" v={compte(0)} />
          </div>

          {aTraiter.length === 0 ? (
            <p className="aide">Aucune fonction de sécurité ne tient à un seul élément, avec ces seuils.</p>
          ) : (
            <div className="prc-liste">
              {aTraiter.map((l, i) => <Ligne key={i} l={l} parCode={parCode} onOuvrir={onOuvrir} />)}
            </div>
          )}

          {tient.length > 0 && (
            <details className="unique-tient">
              <summary>Ce qui tient ({tient.length})</summary>
              <div className="prc-liste">
                {tient.map((l, i) => <Ligne key={i} l={l} parCode={parCode} onOuvrir={onOuvrir} />)}
              </div>
            </details>
          )}
        </>
      )}

      {etat !== 'absent' && (
        <details className="unique-seuils" open={modifies}>
          <summary>Seuils{modifies ? ' (modifiés)' : ''}</summary>
          <form className="unique-seuils-form" onSubmit={appliquerSeuils}>
            {SEUILS.map(([k, libelle, unite]) => (
              <label key={k} htmlFor={`seuil-${k}`}>
                {libelle}
                <span className="unique-seuil-champ">
                  <input id={`seuil-${k}`} type="number" min="1" max="5000" inputMode="numeric" value={saisie[k]}
                    onChange={(e) => setSaisie({ ...saisie, [k]: e.target.value })} />
                  {unite}
                </span>
              </label>
            ))}
            <div className="ligne-boutons">
              <button type="submit" disabled={etat === 'charge'}>{etat === 'charge' ? 'Analyse…' : 'Recalculer'}</button>
              {modifies && (
                <button type="button" className="discret" onClick={() => { setSeuils(SEUILS_DEFAUT); setSaisie(SEUILS_DEFAUT); calculer(SEUILS_DEFAUT) }}>
                  Revenir aux valeurs par défaut
                </button>
              )}
            </div>
          </form>
        </details>
      )}

      <p className="aide">
        On retire un à un les moyens du plan et on regarde ce qui tombe. <strong>Élément unique</strong> : sa perte,
        à elle seule, fait tomber une fonction. <strong>Cause commune</strong> : un élément à risque (groupe, friteuse,
        feu) qui a dans son voisinage tous les moyens d'une fonction. Les distances sont à vol d'oiseau, de centre à
        centre ; les sorties, le point de rassemblement et les accès des secours sont comptés, pas situés. Un lieu
        ne compte comme public, un élément comme à risque, que si sa fiche le dit. Les seuils sont des hypothèses de
        travail (225 m : trois minutes aller-retour en courant) : rien ici ne remplace l'avis de la zone de secours.
      </p>
    </section>
  )
}

/** Une ligne du résultat : le verdict, la fonction, le détail, et l'élément en cause s'il est sur le plan. */
function Ligne({ l, parCode, onOuvrir }) {
  const cible = l.element ? parCode.get(l.element) : null
  return (
    <div className="prc-ligne unique-ligne">
      <span className={`prc-jeton ${ETAT[l.niveau]}`}>{enPhrase(l.verdict)}</span>
      <span className="prc-ligne-texte">
        <span>
          <strong>{LIBELLE_FONCTION[l.fonction] ?? l.fonction}</strong>
          {l.ligne !== 'état nominal' && <> — {l.ligne}</>}
        </span>
        <span className="unique-detail">{l.detail}</span>
      </span>
      {cible && onOuvrir && (
        <button className="lien bilan-objet" onClick={() => onOuvrir(cible.id)} title="Ouvrir sa fiche dans Conception">
          {l.element}
        </button>
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
