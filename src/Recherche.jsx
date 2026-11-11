import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Link2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { lienVers } from './route'
import { useTiroir } from './tiroir'

/**
 * La recherche globale (11/11, audit : fonction manquante n° 5).
 *
 * « SEC-014 », « la clé du local », « Dupont », « P3 » : jusqu'ici il
 * fallait savoir dans quel écran, puis dans quelle rubrique, chercher
 * à l'œil. Un seul champ interroge les demandes, les signalements, les
 * transports, les contacts, les membres, les lieux, les jalons, les
 * créneaux, les fiches réflexe, les constats et la main courante.
 *
 * La fonction `rechercher` tourne avec les droits de la personne : on
 * ne trouve que ce qu'on a le droit de lire. Un résultat mène à son
 * écran, à sa rubrique, et y ouvre l'objet.
 *
 * Ouverture : le bouton de l'en-tête, Ctrl+K (ou ⌘K), ou « / » hors
 * d'un champ de saisie.
 */
const GENRES = {
  demande: 'Demandes',
  signalement: 'Signalements',
  transport: 'Transports',
  contact: 'Contacts',
  membre: 'Membres',
  lieu: 'Lieux',
  jalon: 'Jalons',
  'créneau': 'Créneaux',
  'fiche réflexe': 'Fiches réflexe',
  constat: 'Constats',
  'main courante': 'Main courante'
}

function dansUnChamp(el) {
  if (!el) return false
  const n = el.tagName
  return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || el.isContentEditable
}

export function BoutonRecherche({ onOuvrir }) {
  return (
    <button className="discret recherche-bouton" onClick={onOuvrir} aria-label="Rechercher" title="Rechercher (Ctrl+K)">
      <Search size={16} aria-hidden="true" />
      <span className="recherche-bouton-texte">Rechercher</span>
    </button>
  )
}

export default function Recherche({ evenement, ecransPermis, onAller }) {
  const [ouvert, setOuvert] = useState(false)
  const [q, setQ] = useState('')
  const [resultats, setResultats] = useState([])
  const [etat, setEtat] = useState('repos') // repos | cherche | fait | absent | erreur
  const [erreur, setErreur] = useState(null)
  const [actif, setActif] = useState(0)
  const [copie, setCopie] = useState(null)
  const champ = useRef(null)
  const tour = useRef(0)

  function fermer() {
    setOuvert(false)
    setQ('')
    setResultats([])
    setEtat('repos')
    setCopie(null)
  }
  const tiroir = useTiroir(ouvert, fermer)

  // Le raccourci et le bouton de l'en-tête (ou du tiroir « Plus ») ouvrent la même fenêtre.
  useEffect(() => {
    const ouvrir = () => setOuvert(true)
    const surTouche = (e) => {
      const k = e.key?.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault()
        setOuvert(true)
      } else if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !dansUnChamp(document.activeElement)) {
        e.preventDefault()
        setOuvert(true)
      }
    }
    window.addEventListener('eventware:recherche', ouvrir)
    document.addEventListener('keydown', surTouche)
    return () => {
      window.removeEventListener('eventware:recherche', ouvrir)
      document.removeEventListener('keydown', surTouche)
    }
  }, [])

  useEffect(() => {
    if (ouvert) setTimeout(() => champ.current?.focus(), 0)
  }, [ouvert])

  // La frappe interroge après un court silence ; seule la dernière réponse compte.
  useEffect(() => {
    if (!ouvert) return undefined
    const texte = q.trim()
    if (texte.length < 2) {
      setResultats([])
      setEtat('repos')
      return undefined
    }
    const moi = ++tour.current
    setEtat('cherche')
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('rechercher', { p_evenement: evenement.id, p_q: texte, p_limite: 6 })
      if (moi !== tour.current) return
      if (error) {
        // La fonction arrive avec la migration 169 : tant qu'elle n'est pas appliquée, on le dit simplement.
        const absente = error.code === 'PGRST202' || /rechercher/.test(error.message ?? '')
        setEtat(absente ? 'absent' : 'erreur')
        setErreur(absente ? null : texteErreur(error))
        setResultats([])
        return
      }
      // On ne propose pas un résultat dont l'écran n'est pas ouvert à cette personne.
      setResultats((data ?? []).filter((r) => !ecransPermis || ecransPermis.includes(r.ecran)))
      setActif(0)
      setEtat('fait')
    }, 220)
    return () => clearTimeout(t)
  }, [q, ouvert, evenement.id, ecransPermis])

  const groupes = useMemo(() => {
    const g = []
    for (const r of resultats) {
      let bloc = g.find((x) => x.genre === r.genre)
      if (!bloc) g.push((bloc = { genre: r.genre, lignes: [] }))
      bloc.lignes.push(r)
    }
    return g
  }, [resultats])
  // L'ordre d'affichage, pour les flèches du clavier.
  const aPlat = useMemo(() => groupes.flatMap((g) => g.lignes), [groupes])

  function ouvrirResultat(r) {
    fermer()
    onAller(r.ecran, r.rubrique, r.objet)
  }

  async function copierLien(r, e) {
    e.stopPropagation()
    const lien = lienVers({ ecran: r.ecran, rubrique: r.rubrique, objet: r.objet })
    try {
      await navigator.clipboard.writeText(lien)
      setCopie(r.id)
    } catch {
      // Presse-papiers refusé (ancien navigateur, page non sécurisée) : on montre le lien, à copier à la main.
      window.prompt('Le lien vers cet élément :', lien)
    }
  }

  function surTouche(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActif((i) => Math.min(aPlat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActif((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && aPlat[actif]) {
      e.preventDefault()
      ouvrirResultat(aPlat[actif])
    }
  }

  if (!ouvert) return null

  return (
    <div className="recherche-voile" onClick={fermer}>
      <div className="recherche" {...tiroir} aria-label="Rechercher dans l'événement" onClick={(e) => e.stopPropagation()}>
        <div className="recherche-champ">
          <Search size={18} aria-hidden="true" />
          <input
            ref={champ}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={surTouche}
            placeholder="Une référence, un nom, un lieu, un mot…"
            aria-label="Rechercher"
            aria-controls="recherche-resultats"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button className="lien" onClick={fermer}>Fermer</button>
        </div>

        <div id="recherche-resultats" className="recherche-resultats" role="listbox" aria-label="Résultats">
          {etat === 'repos' && (
            <p className="aide">
              Cherche dans les demandes, signalements, transports, contacts, membres, lieux, jalons,
              créneaux, fiches réflexe, constats et la main courante de {evenement.nom}.
            </p>
          )}
          {etat === 'cherche' && resultats.length === 0 && <p className="aide" role="status">Recherche…</p>}
          {etat === 'absent' && (
            <p className="aide" role="status">La recherche n'est pas encore activée sur cette base (migration 169).</p>
          )}
          {etat === 'erreur' && <p className="message erreur" role="alert">{erreur}</p>}
          {etat === 'fait' && resultats.length === 0 && (
            <p className="vide" role="status">Rien ne correspond à « {q.trim()} ».</p>
          )}

          {groupes.map((g) => (
            <section key={g.genre} className="recherche-groupe">
              <h3>{GENRES[g.genre] ?? g.genre}</h3>
              {g.lignes.map((r) => {
                const i = aPlat.indexOf(r)
                return (
                  <div
                    key={`${r.genre}:${r.id}`}
                    role="option"
                    aria-selected={i === actif}
                    tabIndex={-1}
                    className={`recherche-ligne ${i === actif ? 'actif' : ''}`}
                    onMouseEnter={() => setActif(i)}
                    onClick={() => ouvrirResultat(r)}
                  >
                    <span className="recherche-texte">
                      <span className="recherche-titre">
                        {r.reference && <span className="mono">{r.reference}</span>}
                        {r.titre}
                      </span>
                      {r.detail && <span className="recherche-detail">{r.detail}</span>}
                    </span>
                    {r.objet && (
                      <button
                        className="lien recherche-lien"
                        onClick={(e) => copierLien(r, e)}
                        aria-label={`Copier le lien vers ${r.reference ?? r.titre}`}
                        title="Copier le lien"
                      >
                        {copie === r.id ? 'Lien copié' : <Link2 size={16} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
