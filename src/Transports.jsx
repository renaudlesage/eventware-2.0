import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { ecrireOuEmpiler } from './fileEcritures'
import { texteErreur } from './erreurs'
import { STATUTS_TRANSPORT, libelleStatutTransport, libelleEtapeTransport } from './libelles'

/* ================================================================== */
/* Transports                                                          */
/* ================================================================== */

/*
 * Repris de la v18, qui était nickel sur ce point précis : un point de
 * départ/arrivée se choisit d'abord dans une liste de lieux connus —
 * ça remplit les coordonnées GPS sans que personne ne les tape — et
 * seulement à défaut, on bascule sur une adresse libre avec un lien
 * Maps à côté. La saisie libre reste toujours possible : un chauffeur
 * qui va chercher quelqu'un à la gare n'a pas de "lieu" pour ça.
 */


export default function Transports({ evenement, peut, toutPouvoir, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [lieux, setLieux] = useState([])
  const [chauffeurs, setChauffeurs] = useState([])
  const [masquerClos, setMasquerClos] = useState(true)
  const [ouvrir, setOuvrir] = useState(false)
  const [attribution, setAttribution] = useState(null)

  const peutCreer = toutPouvoir || peut?.('logistique', 'creer')
  const peutModifier = toutPouvoir || peut?.('logistique', 'modifier')

  async function charger() {
    const [t, l, c] = await Promise.all([
      supabase
        .from('transports')
        .select('*, depart:depart_lieu_id(nom), arrivee:arrivee_lieu_id(nom), chauffeur:chauffeur_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        // (125) Par heure de RDV, les courses sans RDV à la fin : c'est
        // l'ordre dans lequel le dispatcheur les traite.
        .order('souhaite_pour', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id),
      supabase.rpc('chauffeurs_disponibles', { p_evenement: evenement.id })
    ])
    if (t.error) setMessage({ type: 'erreur', texte: texteErreur(t.error) })
    else setLignes(t.data ?? [])
    setLieux(l.data ?? [])
    if (!c.error) setChauffeurs(c.data ?? [])
  }

  useEffect(() => {
    charger()
    const tmr = setInterval(charger, 20000)
    return () => clearInterval(tmr)
  }, [evenement.id])

  async function changer(id, champs) {
    // Même règle qu'en Sécurité : on tente, et l'échec décide. Un
    // transport attribué depuis le parking doit tenir, même quand le
    // téléphone se croit connecté.
    const r = await ecrireOuEmpiler({
      nature: 'update',
      table: 'transports',
      id,
      champs,
      libelle: `Transport — ${Object.keys(champs).join(', ')}`
    })

    if (r.statut === 'enfile') {
      setMessage({
        type: 'info',
        texte: 'Réseau indisponible : la modification partira au retour du signal.'
      })
    } else if (r.statut === 'refus') {
      setMessage({
        type: 'erreur',
        texte: r.message === 'Écriture refusée'
          ? 'Modification refusée : droits insuffisants.'
          : r.message
      })
    } else charger()
  }

  async function attribuer(id, chauffeurId, vehicule) {
    await changer(id, {
      chauffeur_id: chauffeurId || null,
      vehicule: vehicule || null,
      statut: chauffeurId ? 'attribuee' : 'a_traiter'
    })
    setAttribution(null)
  }

  const visibles = masquerClos
    ? lignes.filter((l) => !['resolue', 'annulee'].includes(l.statut))
    : lignes

  return (
    <>
      {ouvrir ? (
        <FormTransport
          evenement={evenement}
          lieux={lieux}
          onFait={() => {
            setOuvrir(false)
            charger()
          }}
          onAnnuler={() => setOuvrir(false)}
          setMessage={setMessage}
        />
      ) : (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          {peutCreer && <button onClick={() => setOuvrir(true)}>Nouvelle demande</button>}
          <button className="discret" onClick={() => setMasquerClos(!masquerClos)}>
            {masquerClos ? 'Afficher les terminés' : 'Masquer les terminés'}
          </button>
        </div>
      )}

      {chauffeurs.length === 0 && (
        <p className="aide">
          Aucun chauffeur déclaré. Dans l'onglet Bénévoles, marque les personnes concernées
          comme chauffeurs pour pouvoir leur attribuer des courses.
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="vide">Aucune course.</p>
      ) : (
        visibles.map((l) => (
          <div className="carte" key={l.id}>
            <div className="titre">
              <span className="mono">{l.reference}</span>{' '}
              <span className={`jeton prio-${l.priorite}`}>{l.priorite}</span>{' '}
              {l.depart?.nom ?? l.depart_libre} → {l.arrivee?.nom ?? l.arrivee_libre}
            </div>
            <div className="meta">
              {/* Le statut se lit ici pour qui ne peut pas le changer :
                  sans ça, cacher le sélecteur le cachait tout court. */}
              {!peutModifier && (
                <span>{libelleStatutTransport(l.statut)}</span>
              )}
              <span>{l.nb_personnes} {l.unite_quantite ?? 'pers.'}</span>
              {l.motif && <span>{l.motif}</span>}
              {l.demandeur && <span>{l.demandeur}</span>}
              {l.chauffeur?.nom_affiche && <span>{l.chauffeur.nom_affiche}</span>}
              {l.vehicule && <span>{l.vehicule}</span>}
              {/* (125) Où en est la course, dit par le chauffeur depuis
                  Mon terrain — la pastille de BFMF. */}
              {l.etape && <span className={`jeton etape-${l.etape}`}>{libelleEtapeTransport(l.etape)}</span>}
            </div>
            {/* (125) Ce que le formulaire saisit depuis la 056 et que la
                liste ne montrait pas : le RDV, l'heure attendue, le
                contact, les adresses externes, le volume, les précisions.
                Une course se lit entière sur sa carte, sans rouvrir le
                formulaire. */}
            <div className="meta transport-details">
              {l.souhaite_pour && <span>RDV {heureCourte(l.souhaite_pour)}</span>}
              {l.attendu_le && <span>attendu {heureCourte(l.attendu_le)}</span>}
              {l.type_transport && <span>{l.type_transport}</span>}
              {l.volume_materiel && l.volume_materiel !== 'aucun' && <span>matériel : {l.volume_materiel}</span>}
              {l.contact && (
                <a className="lien-externe" href={`tel:${l.contact.replace(/\s/g, '')}`}>
                  {l.contact}
                </a>
              )}
              {l.adresse_depart && <span>départ : {l.adresse_depart}</span>}
              {l.adresse_arrivee && <span>arrivée : {l.adresse_arrivee}</span>}
            </div>
            {l.precisions && <p className="aide" style={{ margin: '4px 0' }}>{l.precisions}</p>}

            {(l.depart_libre || l.arrivee_libre) && (
              <div className="ligne-boutons" style={{ marginTop: 6 }}>
                {l.depart_libre && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.depart_libre)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Itinéraire départ
                  </a>
                )}
                {l.arrivee_libre && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.arrivee_libre)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Itinéraire arrivée
                  </a>
                )}
              </div>
            )}

            {peutModifier && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <select
                  value={l.statut}
                  onChange={(e) => changer(l.id, { statut: e.target.value })}
                  style={{ width: 'auto', marginBottom: 0 }}
                >
                  {STATUTS_TRANSPORT.map(([v, lib]) => (
                    <option key={v} value={v}>
                      {lib}
                    </option>
                  ))}
                </select>
                <button
                  className="discret"
                  onClick={() => setAttribution(attribution === l.id ? null : l.id)}
                >
                  {l.chauffeur_id ? 'Changer le chauffeur' : 'Attribuer un chauffeur'}
                </button>
              </div>
            )}

            {attribution === l.id && (
              <AttribuerChauffeur
                chauffeurs={chauffeurs}
                actuel={l.chauffeur_id}
                vehiculeActuel={l.vehicule}
                onValider={(c, v) => attribuer(l.id, c, v)}
              />
            )}
          </div>
        ))
      )}
    </>
  )
}

function AttribuerChauffeur({ chauffeurs, actuel, vehiculeActuel, onValider }) {
  const [chauffeurId, setChauffeurId] = useState(actuel ?? '')
  const [vehicule, setVehicule] = useState(vehiculeActuel ?? '')

  return (
    <div className="formulaire">
      <label htmlFor="att-chauffeur">Chauffeur</label>
      <select
        id="att-chauffeur"
        value={chauffeurId}
        onChange={(e) => setChauffeurId(e.target.value)}
      >
        <option value="">— aucun —</option>
        {chauffeurs.map((c) => (
          <option key={c.membre_id} value={c.membre_id}>
            {c.nom ?? '(sans nom)'}
            {c.en_course ? ' — déjà en course' : ''}
            {c.type_vehicule ? ` · ${c.type_vehicule}` : ''}
          </option>
        ))}
      </select>
      <label htmlFor="att-vehicule">Véhicule</label>
      <input
        id="att-vehicule"
        value={vehicule}
        onChange={(e) => setVehicule(e.target.value)}
        placeholder="Plaque, modèle ou repère"
      />
      <button onClick={() => onValider(chauffeurId, vehicule)}>Valider</button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Nouvelle demande — point préétabli ou adresse libre                 */
/* ------------------------------------------------------------------ */

const TYPES_TRANSPORT = [
  ['artiste_groupe', 'Artiste / groupe'],
  ['staff_benevole', 'Staff / bénévole'],
  ['technique_prestataire', 'Technique / prestataire'],
  ['materiel', 'Matériel / ravitaillement']
]

// L'unité du champ quantité dépend de ce qu'on transporte — un
// mazout ne se compte pas en « personnes ». Sans ça, le champ se
// détourne en silence, comme observé dans le REX BFMF 2026.
const UNITES_PAR_TYPE = {
  artiste_groupe: 'personnes',
  staff_benevole: 'personnes',
  technique_prestataire: 'personnes',
  materiel: 'unites'
}

const UNITES_QUANTITE = [
  ['personnes', 'personnes'],
  ['litres', 'litres'],
  ['kg', 'kg'],
  ['unites', 'unités']
]

const VOLUMES_MATERIEL = [
  ['aucun', 'Aucun / bagages à main — voiture OK'],
  ['leger', 'Léger — coffre suffisant'],
  ['moyen', 'Moyen — utilitaire conseillé'],
  ['important', 'Important — camion nécessaire']
]

function FormTransport({ evenement, lieux, onFait, onAnnuler, setMessage }) {
  const [type, setType] = useState('artiste_groupe')
  const [depart, setDepart] = useState({ lieuId: '', libre: '' })
  const [arrivee, setArrivee] = useState({ lieuId: '', libre: '' })
  const [nbPersonnes, setNbPersonnes] = useState(1)
  const [unite, setUnite] = useState('personnes')
  const [adresseDepart, setAdresseDepart] = useState('')
  const [adresseArrivee, setAdresseArrivee] = useState('')
  const [jour, setJour] = useState('')
  const [heureRdv, setHeureRdv] = useState('')
  const [heureAttendue, setHeureAttendue] = useState('')
  const [volumeMateriel, setVolumeMateriel] = useState('aucun')
  const [contact, setContact] = useState('')
  const [demandeur, setDemandeur] = useState('')
  const [motif, setMotif] = useState('')
  const [precisions, setPrecisions] = useState('')
  const [priorite, setPriorite] = useState('P3')
  const [occupe, setOccupe] = useState(false)

  const pret = (depart.lieuId || depart.libre.trim()) && (arrivee.lieuId || arrivee.libre.trim())

  function combinerDateHeure(heure) {
    if (!jour || !heure) return null
    return new Date(`${jour}T${heure}:00`).toISOString()
  }

  function localiser(champ) {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const texte = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`
        if (champ === 'depart') setAdresseDepart(texte)
        else setAdresseArrivee(texte)
      },
      () => setMessage({ type: 'erreur', texte: 'Position indisponible sur cet appareil.' })
    )
  }

  async function creer() {
    setOccupe(true)
    const { error } = await supabase.from('transports').insert({
      evenement_id: evenement.id,
      type_transport: type,
      depart_lieu_id: depart.lieuId || null,
      depart_libre: depart.lieuId ? null : depart.libre.trim() || null,
      arrivee_lieu_id: arrivee.lieuId || null,
      arrivee_libre: arrivee.lieuId ? null : arrivee.libre.trim() || null,
      adresse_depart: adresseDepart.trim() || null,
      adresse_arrivee: adresseArrivee.trim() || null,
      nb_personnes: Number(nbPersonnes) || 1,
      unite_quantite: unite,
      souhaite_pour: combinerDateHeure(heureRdv),
      attendu_le: combinerDateHeure(heureAttendue),
      volume_materiel: volumeMateriel,
      motif: motif.trim() || null,
      precisions: precisions.trim() || null,
      demandeur: demandeur.trim() || null,
      contact: contact.trim() || null,
      priorite
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="formulaire">
      <label htmlFor="type-transport">Type</label>
      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        {TYPES_TRANSPORT.map(([v, l]) => (
          <button
            key={v}
            className={`module ${type === v ? 'actif' : ''}`}
            onClick={() => {
              setType(v)
              setUnite(UNITES_PAR_TYPE[v])
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="saisie-rapide">
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={type === 'materiel' ? 'Quoi — nature du matériel' : 'Qui — nom du groupe ou de la personne'}
        />
        <input
          type="number"
          min="0"
          step={unite === 'personnes' ? 1 : 0.1}
          value={nbPersonnes}
          onChange={(e) => setNbPersonnes(e.target.value)}
          placeholder="Quantité"
          style={{ flex: '0 1 90px' }}
        />
        <select value={unite} onChange={(e) => setUnite(e.target.value)} style={{ flex: '0 1 110px' }}>
          {UNITES_QUANTITE.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <PointDepartArrivee titre="Depuis" lieux={lieux} valeur={depart} onChange={setDepart} />
      <PointDepartArrivee titre="Vers" lieux={lieux} valeur={arrivee} onChange={setArrivee} />

      <label htmlFor="adr-depart">Point de prise en charge (adresse GPS)</label>
      <div className="saisie-rapide">
        <input
          id="adr-depart"
          value={adresseDepart}
          onChange={(e) => setAdresseDepart(e.target.value)}
          placeholder="Rue, n°, code postal, ville"
        />
        <button className="discret" onClick={() => localiser('depart')} style={{ flex: '0 1 auto' }}>
          📍
        </button>
      </div>

      <label htmlFor="adr-arrivee">Destination finale (adresse GPS)</label>
      <div className="saisie-rapide">
        <input
          id="adr-arrivee"
          value={adresseArrivee}
          onChange={(e) => setAdresseArrivee(e.target.value)}
          placeholder="Rue, n°, code postal, ville"
        />
        <button className="discret" onClick={() => localiser('arrivee')} style={{ flex: '0 1 auto' }}>
          📍
        </button>
      </div>

      <label htmlFor="jour-transport">Jour</label>
      <input
        id="jour-transport"
        type="date"
        value={jour}
        onChange={(e) => setJour(e.target.value)}
      />

      <label htmlFor="heure-rdv">Heure de rendez-vous — avec les personnes à transporter</label>
      <input
        id="heure-rdv"
        type="time"
        value={heureRdv}
        onChange={(e) => setHeureRdv(e.target.value)}
      />

      <label htmlFor="heure-attendue">Heure attendue à destination</label>
      <input
        id="heure-attendue"
        type="time"
        value={heureAttendue}
        onChange={(e) => setHeureAttendue(e.target.value)}
      />

      <label htmlFor="volume">Volume de matériel à embarquer</label>
      <select id="volume" value={volumeMateriel} onChange={(e) => setVolumeMateriel(e.target.value)}>
        {VOLUMES_MATERIEL.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>

      <div className="saisie-rapide">
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Contact sur place (téléphone, facultatif)"
        />
        <select
          value={priorite}
          onChange={(e) => setPriorite(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {['P1', 'P2', 'P3', 'P4'].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <input
        value={demandeur}
        onChange={(e) => setDemandeur(e.target.value)}
        placeholder="Demandé par (facultatif)"
      />
      <textarea
        rows={2}
        value={precisions}
        onChange={(e) => setPrecisions(e.target.value)}
        placeholder="Précisions — contraintes horaires, matériel particulier, accès…"
      />

      <div className="ligne-boutons" style={{ marginTop: 10 }}>
        <button disabled={occupe || !pret} onClick={creer}>
          Créer la demande
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}

/**
 * Choix d'un point de départ ou d'arrivée.
 *
 * Les deux moyens coexistent visiblement, comme dans la v18 : un
 * sélecteur de lieu connu, ET un champ d'adresse libre juste en dessous,
 * toujours affiché. Choisir un lieu vide le champ libre ; taper dans le
 * champ libre annule la sélection de lieu. Aucun des deux n'est masqué
 * derrière une option de menu qu'il faut deviner.
 */
function PointDepartArrivee({ titre, lieux, valeur, onChange }) {
  const lieuChoisi = lieux.find((l) => l.id === valeur.lieuId)

  return (
    <div style={{ marginBottom: 12 }}>
      <label>{titre}</label>

      <select
        value={valeur.lieuId}
        onChange={(e) => onChange({ lieuId: e.target.value, libre: '' })}
      >
        <option value="">— choisir un lieu du dispositif —</option>
        {lieux.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nom}
          </option>
        ))}
      </select>

      <div className="saisie-rapide" style={{ marginTop: 6 }}>
        <input
          value={lieuChoisi ? '' : valeur.libre}
          disabled={!!lieuChoisi}
          onChange={(e) => onChange({ lieuId: '', libre: e.target.value })}
          placeholder={
            lieuChoisi
              ? `${lieuChoisi.nom} (lieu du dispositif — vide le champ pour saisir une adresse)`
              : 'Ou une adresse — rue, n°, code postal, ville'
          }
        />
        <a
          className={`bouton-maps ${valeur.libre.trim() && !lieuChoisi ? '' : 'inactif'}`}
          href={
            valeur.libre.trim() && !lieuChoisi
              ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(valeur.libre.trim())}`
              : undefined
          }
          target="_blank"
          rel="noreferrer"
        >
          Carte
        </a>
      </div>
      {lieuChoisi && (
        <button
          className="lien"
          style={{ marginTop: 4 }}
          onClick={() => onChange({ lieuId: '', libre: '' })}
        >
          Saisir une adresse à la place
        </button>
      )}
    </div>
  )
}

function heureCourte(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}
