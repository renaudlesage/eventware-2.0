import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { appliquerIconeEvenement } from './logoPwa'
import { lireFile, ajouter, majSignalement, retirer, nouvelleCle, ETATS } from './fileSos'

const TYPES = [
  ['malaise', 'Malaise'],
  ['blessure', 'Blessure'],
  ['danger', 'Danger'],
  ['materiel', 'Problème matériel'],
  ['egare', 'Personne égarée'],
  ['autre', 'Autre']
]

/**
 * Un refus définitif ne sera jamais accepté : inutile de réessayer.
 * Un refus temporaire peut devenir valable — module qu'on active, phase
 * qui bascule. Le signalement reste alors en file et repart tout seul.
 *
 * Confondre les deux fige un signalement en échec pour toujours.
 */
const REFUS_DEFINITIF = {
  P0002: "Ce lien ne correspond à aucun événement. Vérifie le QR code."
}

const REFUS_TEMPORAIRE = {
  P0003: "Les signalements ne sont pas encore ouverts sur cet événement.",
  P0004: "L'événement n'a pas encore commencé."
}

export default function Participant({ jeton, codeLieu }) {
  const [file, setFile] = useState(lireFile())
  const [evt, setEvt] = useState(null)
  const [type, setType] = useState('malaise')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [position, setPosition] = useState(null)
  const [etatGeo, setEtatGeo] = useState('inactif')
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const minuteur = useRef(null)

  useEffect(() => {
    supabase
      .rpc('evenement_public', { p_jeton: jeton })
      .then(({ data }) => {
        const e = Array.isArray(data) ? data[0] : data
        if (e) {
          setEvt(e)
          appliquerIconeEvenement(e.nom, e.logo_url)
        }
      })
  }, [jeton])

  /* --- Position --- */
  useEffect(() => {
    if (!navigator.geolocation) {
      setEtatGeo('indisponible')
      return
    }
    setEtatGeo('recherche')
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPosition({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precision_m: p.coords.accuracy
        })
        setEtatGeo('ok')
      },
      () => setEtatGeo('refusee'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  /* --- Réseau et renvoi automatique --- */
  useEffect(() => {
    const online = () => {
      setEnLigne(true)
      viderFile()
    }
    const offline = () => setEnLigne(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    minuteur.current = setInterval(viderFile, 15000)
    viderFile()
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      clearInterval(minuteur.current)
    }
  }, [])

  /* --- Envoi --- */

  async function envoyer(s) {
    const { data, error } = await supabase.rpc('creer_signalement', {
      p_jeton: jeton,
      p_cle_client: s.cle_client,
      p_type: s.type,
      p_description: s.description || null,
      p_contact: s.contact || null,
      p_latitude: s.latitude ?? null,
      p_longitude: s.longitude ?? null,
      p_precision_m: s.precision_m ?? null,
      p_emis_le: s.emis_le,
      p_code_lieu: codeLieu ?? null
    })

    if (error) {
      const code = error.code

      if (REFUS_DEFINITIF[code]) {
        setFile(majSignalement(s.cle_client, { etat: 'echec', motif: REFUS_DEFINITIF[code] }))
        return false
      }

      if (REFUS_TEMPORAIRE[code]) {
        // Reste en file : la condition peut changer d'une minute à l'autre
        setFile(majSignalement(s.cle_client, { etat: 'en_attente', motif: REFUS_TEMPORAIRE[code] }))
        return false
      }

      // Panne réseau probable : on laisse en file, sans motif
      setFile(majSignalement(s.cle_client, { etat: 'en_attente', motif: null }))
      return false
    }

    const ligne = Array.isArray(data) ? data[0] : data
    setFile(
      majSignalement(s.cle_client, {
        etat: 'recu',
        reference: ligne?.reference,
        statut: ligne?.statut
      })
    )
    return true
  }

  async function viderFile() {
    const attente = lireFile().filter((s) => s.etat === 'en_attente' || s.etat === 'envoi')
    for (const s of attente) await envoyer(s)
    await rafraichirStatuts()
  }

  async function rafraichirStatuts() {
    const envoyes = lireFile().filter((s) => s.etat === 'recu')
    for (const s of envoyes) {
      const { data } = await supabase.rpc('suivre_signalement', {
        p_jeton: jeton,
        p_cle_client: s.cle_client
      })
      const ligne = Array.isArray(data) ? data[0] : data
      if (ligne?.statut && ligne.statut !== s.statut) {
        setFile(majSignalement(s.cle_client, { statut: ligne.statut }))
      }
    }
  }

  async function soumettre() {
    setEnvoiEnCours(true)
    const s = {
      cle_client: nouvelleCle(),
      type,
      description,
      contact,
      ...(position ?? {}),
      emis_le: new Date().toISOString(),
      etat: 'en_attente'
    }
    setFile(ajouter(s))
    setDescription('')
    await envoyer(s)
    setEnvoiEnCours(false)
  }

  /* --- Rendu --- */

  return (
    <div className="enveloppe participant">
      <div className="bandeau">
        <div className="bandeau-titre">
          {evt?.logo_url && <img src={evt.logo_url} alt="" className="logo-participant" />}
          <div>
            <h1>Signaler un problème{codeLieu ? ` — ${codeLieu}` : ''}</h1>
            {evt?.nom && <p className="acces-role" style={{ margin: '2px 0 0' }}>{evt.nom}</p>}
          </div>
        </div>
        <span className={`session ${enLigne ? '' : 'hors-ligne'}`}>
          {enLigne ? 'en ligne' : 'hors réseau'}
        </span>
      </div>

      {file.length > 0 && (
        <section>
          <h2>Mes signalements</h2>
          {file.map((s) => (
            <div className={`carte sos-${s.etat}`} key={s.cle_client}>
              <div className="titre">
                {TYPES.find((t) => t[0] === s.type)?.[1] ?? s.type}
                {s.reference && <span className="mono"> · {s.reference}</span>}
              </div>
              <div className="etat-sos">
                {s.etat === 'recu' ? etiquetteStatut(s.statut) : ETATS[s.etat]}
              </div>
              {s.etat === 'en_attente' && (
                <p className="aide">
                  {s.motif
                    ? `${s.motif} Le signalement partira automatiquement dès que ce sera possible.`
                    : "Ton téléphone n'a pas de réseau. Le signalement partira tout seul dès que la connexion revient — garde cette page ouverte."}
                </p>
              )}
              {s.etat === 'echec' && <p className="aide alerte">{s.motif}</p>}
              {s.description && <p className="aide">{s.description}</p>}
              {s.etat !== 'recu' && (
                <button className="lien" onClick={() => setFile(retirer(s.cle_client))}>
                  Retirer de la liste
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <section>
        <h2>Nouveau signalement</h2>

        <label htmlFor="type">De quoi s'agit-il ?</label>
        <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>

        <label htmlFor="desc">Ce que tu vois</label>
        <input
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Personne au sol près de la passerelle"
        />

        <label htmlFor="tel">Ton numéro (facultatif)</label>
        <input
          id="tel"
          type="tel"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="pour être rappelé si besoin"
        />

        <div className="geo">
          {etatGeo === 'ok' && position && (
            <>
              Position transmise, précision {Math.round(position.precision_m)} m
              <br />
              <span className="mono">
                {position.latitude.toFixed(5)} · {position.longitude.toFixed(5)}
              </span>
            </>
          )}
          {etatGeo === 'recherche' && 'Recherche de ta position…'}
          {etatGeo === 'refusee' &&
            "Position non partagée. Décris précisément où tu te trouves dans le message."}
          {etatGeo === 'indisponible' &&
            "Ce téléphone ne donne pas de position. Décris précisément où tu te trouves."}
        </div>

        <button disabled={envoiEnCours} onClick={soumettre}>
          Envoyer le signalement
        </button>

        <p className="aide">
          En cas d'urgence vitale, appelle le 112 en premier.
        </p>
      </section>
    </div>
  )
}

function etiquetteStatut(statut) {
  switch (statut) {
    case 'recu':
      return 'Reçu au poste de commandement'
    case 'pris_en_charge':
      return 'Pris en charge — quelqu\'un arrive'
    case 'en_cours':
      return 'Intervention en cours'
    case 'clos':
      return 'Clôturé'
    case 'sans_suite':
      return 'Classé sans suite'
    default:
      return 'Reçu'
  }
}
