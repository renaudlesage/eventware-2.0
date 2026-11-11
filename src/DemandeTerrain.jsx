import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { empiler, estErreurReseau } from './fileEcritures'
import { nouvelleCle } from './reessai'
import { ChoixLieu } from './Missions'

/**
 * LA DEMANDE DU BÉNÉVOLE (169) — « il me faut quelque chose », depuis
 * le téléphone, en trois gestes : une famille, une phrase, envoyer.
 *
 * L'audit du 11/11 l'a montré sur BFMF 2026 : 85 demandes, toutes
 * saisies par une seule personne au QG. Le bénévole n'avait pas le
 * droit d'en créer (ce droit ouvre la Situation), donc tout remontait
 * par la radio. Ici, n'importe quel membre actif pose sa demande ; le
 * serveur lui donne sa priorité, reprend le lieu de son créneau s'il
 * n'en choisit pas, et limite le débit.
 *
 * Hors réseau, la demande est gardée sur l'appareil avec sa clé : elle
 * part au retour du signal, une seule fois.
 */
const URGENCES = ['soins', 'securite']

export function FormDemandeTerrain({ evenement, onFini }) {
  const [familles, setFamilles] = useState([])
  const [lieux, setLieux] = useState([])
  const [famille, setFamille] = useState(null)
  const [texte, setTexte] = useState('')
  const [lieuId, setLieuId] = useState('')
  const [bloquant, setBloquant] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [fait, setFait] = useState(null) // { reference, lieu, attente }

  useEffect(() => {
    supabase.from('familles_demande').select('code, libelle, ordre').order('ordre').then(({ data }) => setFamilles((data ?? []).filter((f) => !URGENCES.includes(f.code))))
    supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom').then(({ data }) => setLieux(data ?? []))
  }, [evenement.id])

  const pret = !!famille || texte.trim().length >= 3

  async function envoyer() {
    if (!pret || occupe) return
    setOccupe(true)
    setErreur(null)
    const libelle = familles.find((f) => f.code === famille)?.libelle
    const operation = {
      nature: 'rpc',
      fonction: 'demande_terrain',
      // La clé rend l'envoi rejouable : le serveur rend la même demande au lieu d'en créer une seconde.
      arguments: { p_evenement: evenement.id, p_texte: texte.trim(), p_famille: famille, p_lieu: lieuId || null, p_bloquant: bloquant, p_cle: nouvelleCle() },
      libelle: `Demande : ${[libelle, texte.trim()].filter(Boolean).join(' — ').slice(0, 50)}`
    }
    let resultat = null
    let echec = null
    if (navigator.onLine) {
      const { data, error } = await supabase.rpc(operation.fonction, operation.arguments)
      if (error) echec = error
      else resultat = Array.isArray(data) ? data[0] : data
    } else echec = new TypeError('hors réseau')
    setOccupe(false)

    if (!echec) {
      window.dispatchEvent(new Event('eventware:demandes'))
      return setFait({ reference: resultat?.reference, lieu: resultat?.lieu, priorite: resultat?.priorite })
    }
    if (estErreurReseau(echec)) {
      empiler(operation)
      return setFait({ attente: true })
    }
    setErreur(
      echec.code === 'PGRST202' || /could not find the function/i.test(echec.message ?? '')
        ? 'Les demandes depuis le téléphone ne sont pas encore ouvertes sur ce serveur. Passe par la radio ou « Parler au QG ».'
        : texteErreur(echec)
    )
  }

  if (fait) {
    return (
      <div className="demande-terrain dom-bronze">
        <div className="message" role="status">
          {fait.attente
            ? 'Hors réseau : ta demande est gardée sur cet appareil. Elle partira toute seule au retour du signal.'
            : <>Demande <strong>{fait.reference}</strong> envoyée au QG{fait.lieu ? ` pour ${fait.lieu}` : ''}. Tu la suis dans « Mes demandes ».</>}
        </div>
        <div className="ligne-boutons">
          <button className="bouton-terrain" onClick={onFini}>Fermer</button>
          <button className="discret" onClick={() => { setFait(null); setFamille(null); setTexte(''); setBloquant(false) }}>Une autre demande</button>
        </div>
      </div>
    )
  }

  return (
    <div className="demande-terrain dom-bronze">
      {erreur && <div className="message erreur" role="alert">{erreur}</div>}

      <span className="etiquette" id="demande-famille">Il te faut</span>
      <div className="demande-familles" role="group" aria-labelledby="demande-famille">
        {familles.map((f) => (
          <button key={f.code} type="button" className={`module ${famille === f.code ? 'actif' : ''}`} aria-pressed={famille === f.code} onClick={() => setFamille(famille === f.code ? null : f.code)}>
            {f.libelle}
          </button>
        ))}
      </div>

      <label htmlFor="demande-texte">En une phrase {famille ? '(facultatif)' : ''}</label>
      <input id="demande-texte" value={texte} maxLength={500} onChange={(e) => setTexte(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && envoyer()} placeholder="Deux fûts de blonde, la pompe est vide" autoFocus />

      <label htmlFor="demande-lieu">Où</label>
      <ChoixLieu id="demande-lieu" lieux={lieux} valeur={lieuId} onChoisir={setLieuId} />
      <p className="aide">Sans lieu choisi, c’est celui de ton créneau en cours.</p>

      <label className="case-a-cocher">
        <input type="checkbox" checked={bloquant} onChange={(e) => setBloquant(e.target.checked)} />
        Ça bloque mon poste
      </label>

      <button className="bouton-terrain" disabled={!pret || occupe} onClick={envoyer}>
        {occupe ? 'Envoi…' : 'Envoyer au QG'}
      </button>
      <p className="aide">
        Un blessé, un danger : pas ici. Utilise <strong>SOS</strong>, et pour une urgence vitale appelle le <strong>112</strong>.
      </p>
    </div>
  )
}
