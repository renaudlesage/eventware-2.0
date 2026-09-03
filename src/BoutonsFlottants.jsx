import { useEffect, useState } from 'react'
import { Siren, MessageSquareWarning, X, TriangleAlert } from 'lucide-react'
import { supabase } from './supabaseClient'
import { diffuserAlerte } from './diffusion'

/**
 * Boutons SOS et REX, présents sur toutes les pages.
 *
 * Repris de la v18, et pour la même raison : au moment où l'on constate
 * quelque chose, on est sur l'écran où l'on travaillait, pas sur celui
 * où il faudrait le déclarer. Un signalement qui demande trois
 * navigations n'est pas fait.
 *
 * SOS écrit un signalement interne — distinct du SOS participant, qui
 * passe par le lien public. REX écrit un constat à chaud.
 */

const TYPES_SOS = [
  ['malaise', 'Malaise'],
  ['blessure', 'Blessure'],
  ['danger', 'Danger'],
  ['materiel', 'Matériel'],
  ['egare', 'Personne égarée'],
  ['autre', 'Autre']
]

const NATURES_REX = [
  ['dysfonctionnement', 'Ça coince'],
  ['reussite', 'Ça marche bien'],
  ['suggestion', 'Suggestion'],
  ['risque', 'Risque repéré']
]

const IMPACTS = [
  ['mineur', 'Mineur'],
  ['gene', 'Gêne'],
  ['bloquant', 'Bloquant'],
  ['dangereux', 'Dangereux']
]

export default function BoutonsFlottants({ evenement, membre, peut, toutPouvoir }) {
  const [ouvert, setOuvert] = useState(null)

  const peutSos = toutPouvoir || peut('sos', 'creer')
  // Le Mayday est ouvert à tout membre : on ne subordonne pas un appel
  // au secours à une capacité.
  const peutRex =
    evenement.modules?.analyse && (toutPouvoir || peut('analyse', 'creer'))

  if (!peutSos && !peutRex) return null

  return (
    <>
      <div className="flottants">
        {peutRex && (
          <button
            className="flottant rex"
            onClick={() => setOuvert('rex')}
            aria-label="Signaler un constat"
          >
            <MessageSquareWarning size={19} strokeWidth={1.9} aria-hidden="true" />
            <span>REX</span>
          </button>
        )}
        {peutSos && (
          <button
            className="flottant sos"
            onClick={() => setOuvert('sos')}
            aria-label="Signaler un incident"
          >
            <Siren size={20} strokeWidth={2} aria-hidden="true" />
            <span>SOS</span>
          </button>
        )}
        <button
          className="flottant mayday"
          onClick={() => setOuvert('mayday')}
          aria-label="Mayday — je suis en difficulté"
        >
          <TriangleAlert size={20} strokeWidth={2.2} aria-hidden="true" />
          <span>MAYDAY</span>
        </button>
      </div>

      {ouvert && (
        <div className="voile" onClick={() => setOuvert(null)}>
          <div className="tiroir" onClick={(e) => e.stopPropagation()}>
            <div className="tiroir-tete">
              <strong>
                {ouvert === 'sos'
                  ? 'Signaler un incident'
                  : ouvert === 'mayday'
                    ? 'Mayday — appel de détresse'
                    : 'Signaler un constat'}
              </strong>
              <button className="lien" onClick={() => setOuvert(null)} aria-label="Fermer">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {ouvert === 'sos' && (
              <FormSos evenement={evenement} membre={membre} onFini={() => setOuvert(null)} />
            )}
            {ouvert === 'mayday' && (
              <FormMayday evenement={evenement} onFini={() => setOuvert(null)} />
            )}
            {ouvert === 'rex' && (
              <FormRex evenement={evenement} membre={membre} onFini={() => setOuvert(null)} />
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function FormSos({ evenement, membre, onFini }) {
  const [type, setType] = useState('danger')
  const [description, setDescription] = useState('')
  const [position, setPosition] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  function localiser() {
    navigator.geolocation?.getCurrentPosition(
      (p) =>
        setPosition({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precision_m: p.coords.accuracy
        }),
      () => setErreur('Position indisponible. Décris précisément le lieu.'),
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }

  async function envoyer() {
    if (!description.trim()) return
    setOccupe(true)
    setErreur(null)
    const reference =
      'INT-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const { error } = await supabase.from('signalements').insert({
      evenement_id: evenement.id,
      reference,
      cle_client: crypto.randomUUID(),
      type,
      description: description.trim(),
      emis_le: new Date().toISOString(),
      ...(position ?? {})
    })
    if (error) setErreur(error.message)
    else onFini()
    setOccupe(false)
  }

  return (
    <div className="dom-orange">
      {erreur && <div className="message erreur">{erreur}</div>}

      <label htmlFor="sos-type">Nature</label>
      <select id="sos-type" value={type} onChange={(e) => setType(e.target.value)}>
        {TYPES_SOS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>

      <label htmlFor="sos-desc">Ce que tu constates</label>
      <input
        id="sos-desc"
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Où, quoi, qui — en une phrase"
      />

      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        <button className="discret" onClick={localiser}>
          {position
            ? `Position jointe ±${Math.round(position.precision_m)} m`
            : 'Joindre ma position'}
        </button>
      </div>

      <button
        className="bouton-terrain"
        disabled={occupe || !description.trim()}
        onClick={envoyer}
      >
        Envoyer au poste de commandement
      </button>
      <p className="aide">
        En cas d'urgence vitale, appelle le 112 d'abord. Ce signalement prévient le PC, il
        ne remplace pas les secours.
      </p>
    </div>
  )
}

/**
 * Mayday.
 *
 * Deux différences avec le SOS, et elles sont volontaires :
 *   la position est prise AUTOMATIQUEMENT, sans attendre un geste — on
 *   ne demande pas à quelqu'un en difficulté de penser à la joindre ;
 *   l'envoi demande une confirmation, parce qu'un Mayday déclenche une
 *   alerte d'urgence sur tous les écrans.
 */
function FormMayday({ evenement, onFini }) {
  const [motif, setMotif] = useState('')
  const [position, setPosition] = useState(null)
  const [etatGeo, setEtatGeo] = useState('recherche')
  const [confirme, setConfirme] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [envoye, setEnvoye] = useState(null)

  useEffect(() => {
    if (!navigator.geolocation) return setEtatGeo('indisponible')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precision_m: p.coords.accuracy
        })
        setEtatGeo('ok')
      },
      () => setEtatGeo('refusee'),
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }, [])

  async function envoyer() {
    setOccupe(true)
    setErreur(null)
    const { data, error } = await supabase.rpc('emettre_mayday', {
      p_evenement: evenement.id,
      p_motif: motif.trim() || null,
      p_latitude: position?.latitude ?? null,
      p_longitude: position?.longitude ?? null,
      p_precision_m: position?.precision_m ?? null
    })
    if (error) setErreur(error.message)
    else {
      const ligne = Array.isArray(data) ? data[0] : data
      setEnvoye(ligne)
      diffuserAlerte(ligne.alerte_id)
    }
    setOccupe(false)
  }

  if (envoye) {
    return (
      <div className="dom-grenat">
        <div className="message">
          <strong>{envoye.reference} transmis.</strong> Le poste de commandement est
          prévenu et une alerte est affichée sur tous les écrans. Reste où tu es si tu le
          peux, et garde la radio libre.
        </div>
        <button className="bouton-terrain" onClick={onFini}>
          Fermer
        </button>
      </div>
    )
  }

  return (
    <div className="dom-grenat">
      {erreur && <div className="message erreur">{erreur}</div>}

      <p className="aide" style={{ marginTop: 0 }}>
        À utiliser quand <strong>tu</strong> es en difficulté : blessure, blocage, menace,
        isolement. Pour un incident que tu constates sur quelqu'un d'autre, utilise SOS.
      </p>

      <label htmlFor="mayday-motif">Ce qui t'arrive</label>
      <input
        id="mayday-motif"
        autoFocus
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        placeholder="En quelques mots — facultatif"
      />

      <div className="geo">
        {etatGeo === 'ok' && position && (
          <>
            Position prise automatiquement, précision ±{Math.round(position.precision_m)} m
            <br />
            <span className="mono">
              {position.latitude.toFixed(5)} · {position.longitude.toFixed(5)}
            </span>
          </>
        )}
        {etatGeo === 'recherche' && 'Recherche de ta position…'}
        {(etatGeo === 'refusee' || etatGeo === 'indisponible') && (
          <span className="alerte-texte">
            Position indisponible. Décris où tu es dans le message — un repère visible vaut
            mieux qu'une adresse.
          </span>
        )}
      </div>

      <label className="case-confirme">
        <input
          type="checkbox"
          checked={confirme}
          onChange={(e) => setConfirme(e.target.checked)}
        />
        <span>
          Je confirme être en difficulté et demander de l'aide. Une alerte d'urgence sera
          diffusée à tout le dispositif.
        </span>
      </label>

      <button
        className="bouton-terrain bouton-mayday"
        disabled={occupe || !confirme}
        onClick={envoyer}
      >
        {occupe ? 'Transmission…' : 'Transmettre le Mayday'}
      </button>

      <p className="aide">
        En cas d'urgence vitale, appelle le 112 en premier. Ce Mayday prévient le poste de
        commandement, il ne remplace pas les secours.
      </p>
    </div>
  )
}

function FormRex({ evenement, membre, onFini }) {
  const [nature, setNature] = useState('dysfonctionnement')
  const [impact, setImpact] = useState('gene')
  const [constat, setConstat] = useState('')
  const [proposition, setProposition] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  async function envoyer() {
    if (!constat.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('rex_entrees').insert({
      evenement_id: evenement.id,
      nature,
      impact,
      constat: constat.trim(),
      proposition: proposition.trim() || null,
      phase: evenement.phase,
      membre_id: membre.id
    })
    if (error) setErreur(error.message)
    else onFini()
    setOccupe(false)
  }

  return (
    <div className="dom-ardoise">
      {erreur && <div className="message erreur">{erreur}</div>}

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {NATURES_REX.map(([v, l]) => (
          <button
            key={v}
            className={`module ${nature === v ? 'actif' : ''}`}
            onClick={() => setNature(v)}
          >
            {l}
          </button>
        ))}
      </div>

      <label htmlFor="rex-constat">Ce que tu constates</label>
      <input
        id="rex-constat"
        autoFocus
        value={constat}
        onChange={(e) => setConstat(e.target.value)}
        placeholder="Sur le moment, avec tes mots"
      />

      <label htmlFor="rex-prop">Ce qu'il faudrait changer</label>
      <input
        id="rex-prop"
        value={proposition}
        onChange={(e) => setProposition(e.target.value)}
        placeholder="Facultatif"
      />

      <label htmlFor="rex-impact">Impact</label>
      <select id="rex-impact" value={impact} onChange={(e) => setImpact(e.target.value)}>
        {IMPACTS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>

      <button
        className="bouton-terrain"
        disabled={occupe || !constat.trim()}
        onClick={envoyer}
      >
        Consigner
      </button>
      <p className="aide">
        Un constat bloquant ou dangereux remonte aussitôt dans la main courante. Les autres
        alimentent le retour d'expérience.
      </p>
    </div>
  )
}
