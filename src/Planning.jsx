import { useEffect, useMemo, useState } from 'react'
import { Footprints, Mic2, PartyPopper, Flag, Wrench, Car } from 'lucide-react'
import { supabase } from './supabaseClient'
import { heure } from './libelles'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import VisibiliteJalon from './VisibiliteJalon'
import { STATUTS_JALON, libelleStatutJalon, jalonEnRetard, supprimerJalon } from './jalons'

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
  const [onglet, setOnglet] = useState('frise')
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
        .is('deleted_at', null)
        // Une action de préparation sans échéance n'a pas sa place sur une
        // ligne de temps : new Date(null) vaut 1970, elle s'afficherait tout
        // au début de la frise.
        .not('echeance', 'is', null),
      supabase
        .from('transports')
        .select('*, chauffeur:chauffeur_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .not('souhaite_pour', 'is', null)
        .not('statut', 'in', '("annulee")')
    ])
    if (p.error) setMessage({ type: 'erreur', texte: texteErreur(p.error) })
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

  const jour = jours[jourActif]
  const aujourdhui = jour && jour.date.toDateString() === now.toDateString()

  return (
    <div className="bloc dom-azur planning">
      <div className="entete-dashboard">
        <h2>Planning</h2>
        {peutEditer && onglet === 'frise' && (
          <button className="lien" onClick={() => setOuvrir(!ouvrir)}>
            {ouvrir ? 'Fermer' : 'Ajouter un créneau'}
          </button>
        )}
      </div>

      <div className="onglets">
        {[
          ['frise', 'Frise'],
          ['jalons', 'Jalons']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${onglet === k ? 'actif' : ''}`}
            onClick={() => setOnglet(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'jalons' && (
        <Jalons
          evenement={evenement}
          // Créer un jalon : `rh:creer` (policy jalons_creation) ; le
          // modifier ou le supprimer : `rh:modifier`. Deux gardes, parce
          // que la campagne du 20/09 a vu un bénévole devant le
          // formulaire d'ajout (2d-04) — il l'aurait envoyé pour rien.
          peutCreer={toutPouvoir || peut?.('rh', 'creer')}
          peutGerer={toutPouvoir || peut?.('rh', 'modifier')}
          toutPouvoir={toutPouvoir}
          setMessage={setMessage}
        />
      )}

      {onglet === 'frise' && (
        <>
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

      {items.length === 0 && !ouvrir && (
        <p className="vide">
          Rien de planifié. La frise fusionne le programme, les jalons datés et les
          transports attribués sur une même ligne de temps.
        </p>
      )}

      <p className="aide">
        Fusionne le programme public, les jalons datés et les transports attribués. Lecture
        ouverte à tout le monde — c'est un document du dispositif, pas un outil de pilotage.
      </p>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Jalons — déplacés de Bénévoles, où ils n'avaient rien à faire : un
 * jalon comme « Livraison chapiteau » ne concerne pas l'encadrement des
 * bénévoles. Il est défini par une échéance, comme le programme et les
 * transports que cette frise fusionne déjà — et elle les affichait
 * d'ailleurs en lecture seule pendant qu'on les éditait ailleurs.
 *
 * Ni Logistique non plus : le champ « catégorie » existe pour que les
 * jalons traversent les domaines. Un « Briefing sécurité » y serait
 * mal rangé.
 */

/**
 * Les JALONS de l'événement — pas les actions des groupes de travail.
 * Les deux vivent dans la même table ; ce qui les distingue est le
 * groupe : une ligne sans groupe est une échéance de l'événement, une
 * ligne dans un groupe est une action de ce groupe, qui se gère dans
 * Préparation. Ici, on ne liste et on ne crée que des jalons — ajouter
 * une ligne « sans groupe » depuis cet écran, c'est poser un jalon.
 */
function Jalons({ evenement, peutCreer, peutGerer, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [f, setF] = useState({ code: '', libelle: '', echeance: '', responsable: '' })

  async function charger() {
    const { data, error } = await supabase
      .from('jalons')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .is('groupe_travail_id', null)
      .order('echeance')
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!f.code.trim() || !f.libelle.trim() || !f.echeance) return
    const { error } = await supabase.from('jalons').insert({
      evenement_id: evenement.id,
      ...f,
      echeance: new Date(f.echeance).toISOString()
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ code: '', libelle: '', echeance: '', responsable: '' })
      charger()
    }
  }

  async function modifier(id, champs) {
    const refus = await modifierOuRefuser('jalons', champs, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  async function supprimer(j) {
    const { fait, refus } = await supprimerJalon(j, 'le jalon')
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else if (fait) charger()
  }

  const maintenant = Date.now()

  return (
    <>
      {peutCreer && (
        <div className="saisie-rapide">
          <input
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value })}
            placeholder="Code"
            style={{ flex: '0 1 90px' }}
          />
          <input
            value={f.libelle}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
            placeholder="Libellé"
          />
          <input
            type="datetime-local"
            value={f.echeance}
            onChange={(e) => setF({ ...f, echeance: e.target.value })}
          />
          <input
            value={f.responsable}
            onChange={(e) => setF({ ...f, responsable: e.target.value })}
            placeholder="Responsable"
            style={{ flex: '0 1 140px' }}
          />
          <button onClick={creer}>Ajouter</button>
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="vide">Aucun jalon.</p>
      ) : (
        lignes.map((j) => {
          const depasse = jalonEnRetard(j, maintenant)
          return (
            <div className={`carte ${depasse || j.statut === 'rate' ? 'urgent' : ''}`} key={j.id}>
              <div className="titre">
                <span className="mono">{j.code}</span> — {j.libelle}
                {j.critique && <span className="jeton alerte-texte"> critique</span>}
              </div>
              <div className="meta">
                <span className={depasse ? 'alerte-texte' : ''}>
                  {j.echeance ? heure(j.echeance) : 'sans échéance'}
                </span>
                {j.responsable && <span>{j.responsable}</span>}
                {j.categorie && <span>{j.categorie}</span>}
                {/* Lisible sans ouvrir le sélecteur : sur une liste de
                    quarante jalons, savoir lesquels sortent au public
                    est une relecture, pas quarante clics. */}
                {j.visibilite === 'public' && <span>public : {j.libelle_public}</span>}
                {j.visibilite === 'coordination' && <span>coordination</span>}
                {depasse && <span className="alerte-texte">échéance dépassée</span>}
              </div>
              {peutGerer ? (
                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <select
                    value={j.statut}
                    onChange={(e) => modifier(j.id, { statut: e.target.value })}
                    style={{ width: 'auto', marginBottom: 0 }}
                  >
                    {STATUTS_JALON.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {/* Un jalon public affiche ici son état sur la
                      vitrine : « Fait » y devient « c'est fait »,
                      ce qui n'est pas anodin pour une route rouverte. */}
                  <VisibiliteJalon
                    jalon={j}
                    toutPouvoir={toutPouvoir}
                    modifier={(champs) => modifier(j.id, champs)}
                  />
                  <button className="discret" onClick={() => supprimer(j)}>
                    Supprimer
                  </button>
                </div>
              ) : (
                <div className="meta" style={{ marginTop: 6 }}>
                  <span>{libelleStatutJalon(j.statut)}</span>
                </div>
              )}
            </div>
          )
        })
      )}
    </>
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
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
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
