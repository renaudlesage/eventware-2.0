import { useEffect, useMemo, useState } from 'react'
import { Footprints, Mic2, PartyPopper, Flag, Wrench, Car } from 'lucide-react'
import { supabase } from './supabaseClient'

/**
 * Planning.
 *
 * Repris de la v18, qui fusionnait départs de balade, concerts, jalons
 * et transports attribués sur une même ligne de temps, avec ce qui est
 * en cours mis en évidence.
 *
 * Une différence de fond simplifie tout : la v18 travaillait sur des
 * libellés de jour figés ("Samedi 15/08") et devait donc bricoler une
 * règle pour rattacher les heures après minuit à la soirée précédente.
 * Ici chaque créneau porte un vrai horodatage complet — la date est
 * déjà correcte, aucun bricolage n'est nécessaire.
 *
 * Lecture ouverte à tout membre : c'est un document du dispositif, pas
 * un outil de pilotage.
 */

const COULEURS = {
  concert: 'prune',
  animation: 'mousse',
  depart: 'azur',
  ceremonie: 'orange',
  jalon: 'ardoise',
  transport: 'bronze'
}

/* Une icône par type, dans un carré coloré — repris du planning v18 :
   on reconnaît la nature d'un créneau au coup d'œil, avant même de lire
   son titre. Un simple point sur le rail ne portait pas cette info. */
const ICONES = {
  concert: Mic2,
  animation: PartyPopper,
  depart: Footprints,
  ceremonie: Flag,
  jalon: Wrench,
  transport: Car
}

export default function Planning({ evenement, peut, toutPouvoir }) {
  const [programme, setProgramme] = useState([])
  const [jalons, setJalons] = useState([])
  const [transports, setTransports] = useState([])
  const [now, setNow] = useState(new Date())
  const [jourActif, setJourActif] = useState(0)
  const [ouvrir, setOuvrir] = useState(false)
  const [message, setMessage] = useState(null)

  const peutEditer = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger() {
    const [p, j, t] = await Promise.all([
      supabase
        .from('programme')
        .select('*, lieux:lieu_id(nom)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null),
      supabase
        .from('jalons')
        .select('*')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null),
      supabase
        .from('transports')
        .select('*, chauffeur:chauffeur_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .not('souhaite_pour', 'is', null)
        .not('statut', 'in', '("annulee")')
    ])
    if (p.error) setMessage({ type: 'erreur', texte: p.error.message })
    setProgramme(p.data ?? [])
    setJalons(j.data ?? [])
    setTransports(t.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 30000)
    return () => clearInterval(t)
  }, [evenement.id])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  // Fusion en une seule liste d'items datés
  const items = useMemo(() => {
    const tout = [
      ...programme.map((p) => ({
        id: 'p' + p.id,
        heure: new Date(p.debut),
        type: p.categorie || 'concert',
        titre: p.titre,
        detail: [p.intervenant, p.lieux?.nom ?? p.lieu_libre].filter(Boolean).join(' · '),
        dureeMin: p.duree_min
      })),
      ...jalons.map((j) => ({
        id: 'j' + j.id,
        heure: new Date(j.echeance),
        type: 'jalon',
        titre: j.libelle,
        detail: [j.responsable, j.categorie].filter(Boolean).join(' · '),
        critique: j.critique,
        statut: j.statut
      })),
      ...transports.map((t) => ({
        id: 't' + t.id,
        heure: new Date(t.souhaite_pour),
        type: 'transport',
        titre: `${t.depart_libre ?? 'Départ'} → ${t.arrivee_libre ?? 'Arrivée'}`,
        detail: t.chauffeur?.nom_affiche
          ? `Chauffeur ${t.chauffeur.nom_affiche}`
          : 'Chauffeur à attribuer'
      }))
    ]
    return tout.sort((a, b) => a.heure - b.heure)
  }, [programme, jalons, transports])

  // Groupement par jour calendaire réel — aucun bricolage nécessaire,
  // l'horodatage porte déjà la bonne date.
  const jours = useMemo(() => {
    const cles = new Map()
    for (const it of items) {
      const cle = it.heure.toDateString()
      if (!cles.has(cle)) cles.set(cle, { date: it.heure, items: [] })
      cles.get(cle).items.push(it)
    }
    return [...cles.values()].sort((a, b) => a.date - b.date)
  }, [items])

  useEffect(() => {
    if (jourActif >= jours.length) setJourActif(0)
  }, [jours.length])

  if (items.length === 0 && !ouvrir) {
    return (
      <div className="bloc dom-azur planning">
        <div className="entete-dashboard">
          <h2>Planning</h2>
          {peutEditer && (
            <button className="lien" onClick={() => setOuvrir(true)}>
              Ajouter un créneau
            </button>
          )}
        </div>
        <p className="vide">
          Rien de planifié. Le planning fusionne le programme, les jalons datés et les
          transports attribués sur une même ligne de temps.
        </p>
        {ouvrir && (
          <FormProgramme
            evenement={evenement}
            onFait={() => {
              setOuvrir(false)
              charger()
            }}
            onAnnuler={() => setOuvrir(false)}
            setMessage={setMessage}
          />
        )}
      </div>
    )
  }

  const jour = jours[jourActif]
  const aujourdhui = jour && jour.date.toDateString() === now.toDateString()

  return (
    <div className="bloc dom-azur planning">
      <div className="entete-dashboard">
        <h2>Planning</h2>
        {peutEditer && (
          <button className="lien" onClick={() => setOuvrir(!ouvrir)}>
            {ouvrir ? 'Fermer' : 'Ajouter un créneau'}
          </button>
        )}
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {ouvrir && (
        <FormProgramme
          evenement={evenement}
          onFait={() => {
            setOuvrir(false)
            charger()
          }}
          onAnnuler={() => setOuvrir(false)}
          setMessage={setMessage}
        />
      )}

      {jours.length > 1 && (
        <div className="jours-planning">
          {jours.map((j, i) => (
            <button
              key={i}
              className={`jour-onglet ${jourActif === i ? 'actif' : ''}`}
              onClick={() => setJourActif(i)}
            >
              <span className="jour-nom">
                {j.date.toLocaleDateString('fr-BE', { weekday: 'short' })}
              </span>
              <span className="jour-date mono">
                {j.date.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })}
              </span>
              <span className="jour-compte">{j.items.length}</span>
            </button>
          ))}
        </div>
      )}

      {jour && (
        <div className="timeline">
          {jour.items.map((it, i) => {
            const debut = it.heure.getTime()
            const fin = jour.items[i + 1] ? jour.items[i + 1].heure.getTime() : debut + 3600000
            const enCours = aujourdhui && now.getTime() >= debut && now.getTime() < fin
            const passe = aujourdhui ? now.getTime() >= fin : jour.date < now && !aujourdhui
            const couleur = COULEURS[it.type] ?? 'gris'

            const Icone = ICONES[it.type] ?? Wrench

            return (
              <div
                key={it.id}
                className={`item-planning dom-${couleur} ${enCours ? 'en-cours' : ''} ${
                  passe ? 'passe' : ''
                } ${it.critique ? 'urgent' : ''}`}
              >
                <div className="item-heure mono">
                  {it.heure.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="item-icone">
                  <Icone size={15} strokeWidth={2} aria-hidden="true" />
                </div>
                <div className="item-corps">
                  <div className="item-titre">
                    {it.titre}
                    {it.critique && <span className="jeton alerte-texte"> critique</span>}
                  </div>
                  {it.detail && <div className="item-detail">{it.detail}</div>}
                </div>
                {enCours && <span className="jeton en-cours-jeton">en cours</span>}
              </div>
            )
          })}
        </div>
      )}

      <p className="aide">
        Fusionne le programme public, les jalons datés et les transports attribués. Lecture
        ouverte à tout le monde — c'est un document du dispositif, pas un outil de pilotage.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const CATEGORIES = [
  ['depart', 'Départ de groupe'],
  ['concert', 'Concert'],
  ['animation', 'Animation'],
  ['ceremonie', 'Cérémonie'],
  ['autre', 'Autre']
]

function FormProgramme({ evenement, onFait, onAnnuler, setMessage }) {
  const [titre, setTitre] = useState('')
  const [categorie, setCategorie] = useState('depart')
  const [intervenant, setIntervenant] = useState('')
  const [debut, setDebut] = useState('')
  const [dureeMin, setDureeMin] = useState('')
  const [lieuLibre, setLieuLibre] = useState('')
  const [occupe, setOccupe] = useState(false)

  async function creer() {
    if (!titre.trim() || !debut) return
    setOccupe(true)
    const numero = Math.random().toString(36).slice(2, 6).toUpperCase()
    const { error } = await supabase.from('programme').insert({
      evenement_id: evenement.id,
      code: 'PRG-' + numero,
      titre: titre.trim(),
      categorie,
      intervenant: intervenant.trim() || null,
      debut: new Date(debut).toISOString(),
      duree_min: dureeMin ? Number(dureeMin) : null,
      lieu_libre: lieuLibre.trim() || null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="formulaire">
      <div className="saisie-rapide">
        <select
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Titre" />
      </div>
      <div className="saisie-rapide">
        <input
          type="datetime-local"
          value={debut}
          onChange={(e) => setDebut(e.target.value)}
        />
        <input
          type="number"
          value={dureeMin}
          onChange={(e) => setDureeMin(e.target.value)}
          placeholder="Durée (min)"
          style={{ flex: '0 1 130px' }}
        />
      </div>
      <div className="saisie-rapide">
        <input
          value={intervenant}
          onChange={(e) => setIntervenant(e.target.value)}
          placeholder="Intervenant (facultatif)"
        />
        <input
          value={lieuLibre}
          onChange={(e) => setLieuLibre(e.target.value)}
          placeholder="Lieu"
        />
      </div>
      <div className="ligne-boutons">
        <button disabled={occupe || !titre.trim() || !debut} onClick={creer}>
          Ajouter au planning
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}
