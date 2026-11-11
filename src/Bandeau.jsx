import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { diffuserAlerte } from './diffuserAlerte'
import { pousser } from './push'
import { texteErreur } from './erreurs'
import { NIVEAUX_ALERTE as NIVEAUX } from './referentielsProduit'
import { useAccuses, BienRecu } from './accuses.jsx'


/**
 * Le bandeau s'impose : il n'est pas refermable tant que l'alerte est
 * active. Une alerte qu'on peut masquer d'un clic est une alerte qu'on
 * masque au pire moment.
 *
 * Il ne montre que les alertes de l'événement COURANT. La version
 * précédente affichait celles de tous les événements dont on est membre,
 * au motif qu'une urgence ne doit jamais être masquée : le raisonnement
 * était faux. Un Mayday sur une rando n'a rien à faire sur l'écran de
 * quelqu'un qui travaille sur un festival — il y crée du bruit et brouille
 * le cloisonnement entre organisateurs.
 */
export default function Bandeau({ evenement, membre }) {
  const [alertes, setAlertes] = useState([])
  // (audit C3) Hors réseau, on garde les alertes qu'on connaissait, datées : les
  // effacer au premier relevé raté revenait à dire « plus d'alerte ».
  const [releve, setReleve] = useState(null) // heure du dernier relevé réussi
  const [horsReseau, setHorsReseau] = useState(false)
  const { mes, accuser } = useAccuses(evenement, membre)
  const clef = evenement?.id ? `eventware.alertes.${evenement.id}` : null

  async function charger() {
    if (!evenement?.id) return setAlertes([])
    const { data, error } = await supabase
      .from('alertes')
      .select('*')
      .eq('evenement_id', evenement.id)
      .eq('active', true)
      .order('emise_le', { ascending: false })
    if (error) {
      // Rien n'a été lu : on ne touche pas à ce qui est affiché.
      setHorsReseau(true)
      return
    }
    const quand = new Date().toISOString()
    setAlertes(data ?? [])
    setReleve(quand)
    setHorsReseau(false)
    try { localStorage.setItem(clef, JSON.stringify({ quand, alertes: data ?? [] })) } catch { /* stockage plein ou interdit */ }
  }

  useEffect(() => {
    // Au démarrage, ce que l'appareil savait, en attendant le premier relevé.
    let connues = []
    try {
      const garde = JSON.parse(localStorage.getItem(clef) ?? 'null')
      if (garde?.alertes) { connues = garde.alertes; setReleve(garde.quand) }
    } catch { /* rien de gardé */ }
    setAlertes(connues)
    charger()
    const t = setInterval(charger, 15000)
    return () => clearInterval(t)
  }, [evenement?.id])

  if (!alertes.length) return null
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="bandeaux" role="alert" aria-live="assertive">
      {horsReseau && releve && (
        <div className="bandeau-perime">Hors réseau : alertes telles qu’elles étaient à {heure(releve)}. Elles ont pu changer depuis.</div>
      )}
      {alertes.map((a) => (
        <div className={`bandeau-alerte niv-${a.niveau}`} key={a.id}>
          <div className="niv">{a.niveau}</div>
          <div className="contenu">
            <strong>{a.titre}</strong>
            {a.message && <div className="msg">{a.message}</div>}
            {a.consigne && <div className="consigne">→ {a.consigne}</div>}
            <div className="meta">
              <span>{heure(a.emise_le)}</span>
              {a.acquittee_le && <span>prise en compte par le QG à {heure(a.acquittee_le)}</span>}
              <BienRecu alerte={a} mes={mes} accuser={accuser} membre={membre} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Émission et levée — réservé aux rôles qui en ont le droit           */
/* ------------------------------------------------------------------ */

export function GestionAlertes({ evenement, setMessage, embarque = false, onCompteurs }) {
  const [alertes, setAlertes] = useState([])
  const [accuses, setAccuses] = useState({}) // alerte_id → [{nom, accuse_le}]
  const [ouvrir, setOuvrir] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [f, setF] = useState({
    niveau: 'vigilance',
    titre: '',
    message: '',
    consigne: ''
  })
  // Diffuser aux participants (vitrine) — audit 4.3 : la colonne
  // `alertes.public` existait depuis la 075, mais aucun écran ne
  // l'écrivait ; la vitrine n'a jamais montré une seule alerte. Cochée
  // d'office pour une urgence ou une évacuation (c'est le public qu'il
  // faut mettre à l'abri), décochée pour le reste (« PMR15 sature » ne
  // regarde pas les participants). Un choix explicite l'emporte.
  const [publique, setPublique] = useState(null)
  const publiqueParDefaut = (niveau) => niveau === 'urgence' || niveau === 'evacuation'
  const estPublique = publique ?? publiqueParDefaut(f.niveau)

  async function charger() {
    const [{ data, error }, ac] = await Promise.all([
      supabase
        .from('alertes')
        .select('*')
        .eq('evenement_id', evenement.id)
        // (audit C6) Les actives d'abord : coupée aux 20 plus récentes, la liste
        // perdait une alerte active plus ancienne.
        .order('active', { ascending: false })
        .order('emise_le', { ascending: false })
        .limit(50),
      // (122) Qui a lu quoi : les accusés nominatifs, groupés par alerte.
      supabase
        .from('alertes_accuses')
        .select('alerte_id, accuse_le, membre:membre_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        .order('accuse_le')
    ])
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else setAlertes(data ?? [])
    if (!ac.error) {
      const parAlerte = {}
      for (const x of ac.data ?? []) {
        ;(parAlerte[x.alerte_id] ??= []).push({ nom: x.membre?.nom_affiche ?? 'membre sans nom', accuse_le: x.accuse_le })
      }
      setAccuses(parAlerte)
    }
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 15000)
    return () => clearInterval(t)
  }, [evenement.id])

  // « Vu, pris en compte » : le PC a la main, sans lever. Qui et quand
  // sont posés par le déclencheur cycle_alerte.
  async function acquitter(id) {
    const { error, count } = await supabase
      .from('alertes')
      .update({ acquittee_le: new Date().toISOString() }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage?.({ type: 'erreur', texte: 'Acquittement refusé.' })
    else charger()
  }

  async function emettre() {
    if (!f.titre.trim() || occupe) return
    // (audit C5) Une alerte part vers tous les membres, parfois vers le public et
    // les canaux externes : on le dit avant, et un double clic n'en crée pas deux.
    const niveau = NIVEAUX.find(([v]) => v === f.niveau)?.[1] ?? f.niveau
    const portee = estPublique ? 'tous les membres ET les participants (vitrine, lien participant)' : 'tous les membres de l’événement'
    if (!window.confirm(`Diffuser cette alerte « ${niveau} » ?\n\n${f.titre.trim()}${f.consigne.trim() ? `\n→ ${f.consigne.trim()}` : ''}\n\nElle s’affichera chez ${portee}, et partira vers les canaux de diffusion externes s’il y en a.`)) return
    setOccupe(true)
    const { data, error } = await supabase
      .from('alertes')
      .insert({ evenement_id: evenement.id, ...f, public: estPublique })
      .select('id')
      .single()
    setOccupe(false)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else {
      setMessage?.({ type: 'succes', texte: `Alerte diffusée : ${f.titre.trim()}` })
      setF({ niveau: 'vigilance', titre: '', message: '', consigne: '' })
      setPublique(null)
      setOuvrir(false)
      charger()
      diffuserAlerte(data.id)
      // Les téléphones en poche : notification poussée aux appareils abonnés.
      pousser('alerte', data.id)
    }
  }

  async function lever(id) {
    const motif = prompt('Motif de la levée ?')
    if (motif === null) return
    const { error, count } = await supabase
      .from('alertes')
      .update({ active: false, motif_levee: motif }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage?.({ type: 'erreur', texte: 'Levée refusée.' })
    else charger()
  }

  async function basculerPublique(a) {
    if (!a.public && !window.confirm(`Montrer « ${a.titre} » aux participants ?\n\nL’alerte deviendra visible sans compte, sur la vitrine et le lien participant.`)) return
    const { error, count } = await supabase
      .from('alertes')
      .update({ public: !a.public }, { count: 'exact' })
      .eq('id', a.id)
    if (error) setMessage?.({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage?.({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  const actives = alertes.filter((a) => a.active)

  // Embarqué dans un bloc du tableau de bord : le compteur d'en-tête
  // est dérivé de cette même liste, jamais recalculé à côté — sinon
  // l'en-tête et le contenu pourraient se contredire.
  useEffect(() => {
    onCompteurs?.({ actives: actives.length })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actives.length])

  return (
    <div className="gestion-alertes">
      <div className="entete-dashboard">
        {!embarque && <h2>Alertes</h2>}
        <button className="lien" onClick={() => setOuvrir(!ouvrir)}>
          {ouvrir ? 'Annuler' : 'Émettre une alerte'}
        </button>
      </div>

      {ouvrir && (
        <div className="formulaire">
          <label htmlFor="niv">Niveau</label>
          <select
            id="niv"
            value={f.niveau}
            onChange={(e) => setF({ ...f, niveau: e.target.value })}
          >
            {NIVEAUX.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label htmlFor="alerte-titre">Titre : ce qui se passe *</label>
          <input
            id="alerte-titre"
            value={f.titre}
            onChange={(e) => setF({ ...f, titre: e.target.value })}
            placeholder="Orage violent annoncé"
          />
          <label htmlFor="alerte-message">Précisions (facultatif)</label>
          <input
            id="alerte-message"
            value={f.message}
            onChange={(e) => setF({ ...f, message: e.target.value })}
            placeholder="Cellule orageuse à 20 min"
          />
          <label htmlFor="alerte-consigne">Consigne : ce qu’il faut faire</label>
          <input
            id="alerte-consigne"
            value={f.consigne}
            onChange={(e) => setF({ ...f, consigne: e.target.value })}
            placeholder="Évacuer les chapiteaux"
          />
          <label className="case-a-cocher">
            <input
              type="checkbox"
              checked={estPublique}
              onChange={(e) => setPublique(e.target.checked)}
            />
            Afficher aussi aux participants (vitrine et lien participant)
          </label>
          <button disabled={!f.titre.trim() || occupe} onClick={emettre}>
            {occupe ? 'Diffusion…' : 'Diffuser l’alerte'}
          </button>
          <p className="aide">
            La consigne est le champ le plus important. Une alerte qui décrit sans prescrire
            laisse chacun improviser — et improviser à dix, c'est dix décisions différentes.
          </p>
        </div>
      )}

      {actives.length === 0 ? (
        <p className="vide">Aucune alerte active.</p>
      ) : (
        actives.map((a) => (
          <div className="carte urgent" key={a.id}>
            <div className="titre">
              <span className="jeton alerte-texte">{a.niveau}</span> {a.titre}
              {a.public && <span className="jeton"> visible des participants</span>}
            </div>
            {a.consigne && <p style={{ margin: '4px 0' }}>→ {a.consigne}</p>}
            <Accuses liste={accuses[a.id]} acquittee_le={a.acquittee_le} />
            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              {!a.acquittee_le && (
                <button className="discret" onClick={() => acquitter(a.id)} title="Le QG a vu et prend en compte, sans lever">
                  Vu, pris en compte
                </button>
              )}
              <button onClick={() => lever(a.id)}>Lever l'alerte</button>
              <button className="discret" onClick={() => basculerPublique(a)}>
                {a.public ? 'Retirer de la vitrine' : 'Montrer aux participants'}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

/**
 * La liste nominative des accusés d'une alerte (122), et l'acquittement
 * du PC. Partagée par la gestion des alertes et la Situation : les
 * deux doivent dire la même chose avec les mêmes mots.
 */
export function Accuses({ liste = [], acquittee_le, acquittee_par, membresActifs }) {
  const hm = (iso) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="accuses">
      <span className={liste.length ? '' : 'sourdine'}>
        {liste.length === 0
          ? 'personne n’a encore accusé réception'
          : `lue par ${liste.length}${membresActifs ? ` / ${membresActifs}` : ''} : ${liste.map((x) => `${x.nom} (${hm(x.accuse_le)})`).join(' · ')}`}
      </span>
      {acquittee_le && (
        <span className="acquittee">
          · prise en compte{acquittee_par ? ` par ${acquittee_par}` : ' par le QG'} à {hm(acquittee_le)}
        </span>
      )}
    </div>
  )
}
