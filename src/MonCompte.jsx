import { useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * Mon compte — ce que l'utilisateur peut changer lui-même.
 *
 * Deux noms cohabitent, et les confondre créerait des surprises :
 *   - le NOM DU COMPTE suit la personne d'un événement à l'autre ;
 *   - le NOM AFFICHÉ est propre à un événement, parce qu'on peut
 *     vouloir y apparaître « Renaud (PC Ops) » plutôt que sous son
 *     état civil.
 * L'écran les montre séparément plutôt que d'en cacher un et de faire
 * deviner lequel a changé.
 *
 * L'e-mail ne change pas sur simple clic : Supabase envoie un lien de
 * confirmation à la nouvelle adresse. Tant qu'il n'est pas suivi, la
 * connexion se fait toujours avec l'ancienne. C'est dit explicitement —
 * quelqu'un qui croit avoir changé d'adresse et ne peut plus se
 * connecter perd l'accès à son événement.
 */
export default function MonCompte({ session, membre, evenement, setMessage, onRecharger, sansTitre }) {
  const [nomCompte, setNomCompte] = useState(session.user.user_metadata?.nom ?? '')
  const [nomAffiche, setNomAffiche] = useState(membre?.nom_affiche ?? '')
  const [email, setEmail] = useState(session.user.email ?? '')
  const [mdp, setMdp] = useState('')
  const [occupe, setOccupe] = useState(null)
  const [info, setInfo] = useState(null)

  async function enregistrerNoms() {
    setOccupe('noms')
    setInfo(null)
    const { error: e1 } = await supabase.auth.updateUser({ data: { nom: nomCompte.trim() } })
    let e2 = null
    if (membre) {
      const r = await supabase
        .from('membres_evenement')
        .update({ nom_affiche: nomAffiche.trim() || null })
        .eq('id', membre.id)
      e2 = r.error
    }
    if (e1 || e2) setMessage({ type: 'erreur', texte: texteErreur(e1 ?? e2) })
    else {
      setInfo('Noms enregistrés.')
      onRecharger?.()
    }
    setOccupe(null)
  }

  async function changerEmail() {
    if (!email.trim() || email.trim() === session.user.email) return
    setOccupe('email')
    setInfo(null)
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else
      setInfo(
        `Un lien de confirmation vient d'être envoyé à ${email.trim()}. Tant que tu ne l'as pas suivi, connecte-toi avec ton ancienne adresse.`
      )
    setOccupe(null)
  }

  async function changerMdp() {
    if (mdp.length < 6) return
    setOccupe('mdp')
    setInfo(null)
    const { error } = await supabase.auth.updateUser({ password: mdp })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setMdp('')
      setInfo('Mot de passe modifié.')
    }
    setOccupe(null)
  }

  return (
    <section className={sansTitre ? '' : 'bloc'}>
      {!sansTitre && <h2>Mon compte</h2>}
      {info && <div className="message">{info}</div>}

      <label htmlFor="c-nom">Nom du compte</label>
      <input
        id="c-nom"
        value={nomCompte}
        onChange={(e) => setNomCompte(e.target.value)}
        autoComplete="name"
        placeholder="Nom et prénom"
      />
      <p className="aide" style={{ marginTop: -4 }}>
        Te suit d'un événement à l'autre, et pré-remplit les suivants.
      </p>

      {membre && (
        <>
          <label htmlFor="c-affiche">Nom affiché sur « {evenement?.nom} »</label>
          <input
            id="c-affiche"
            value={nomAffiche}
            onChange={(e) => setNomAffiche(e.target.value)}
            placeholder="Ce que voit le poste de commandement"
          />
          <p className="aide" style={{ marginTop: -4 }}>
            Propre à cet événement — on peut vouloir y apparaître autrement.
          </p>
        </>
      )}

      <button disabled={occupe === 'noms'} onClick={enregistrerNoms}>
        Enregistrer les noms
      </button>

      <label htmlFor="c-email" style={{ marginTop: 16 }}>
        Adresse e-mail
      </label>
      <input
        id="c-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <p className="aide" style={{ marginTop: -4 }}>
        Le changement n'est pas immédiat : un lien de confirmation part vers la nouvelle
        adresse, et l'ancienne reste valable tant qu'il n'est pas suivi.
      </p>
      <button
        className="discret"
        disabled={occupe === 'email' || !email.trim() || email.trim() === session.user.email}
        onClick={changerEmail}
      >
        Changer d'adresse
      </button>

      <label htmlFor="c-mdp" style={{ marginTop: 16 }}>
        Nouveau mot de passe
      </label>
      <input
        id="c-mdp"
        type="password"
        value={mdp}
        onChange={(e) => setMdp(e.target.value)}
        autoComplete="new-password"
        placeholder="Six caractères au minimum"
      />
      <button className="discret" disabled={occupe === 'mdp' || mdp.length < 6} onClick={changerMdp}>
        Changer le mot de passe
      </button>

      <div className="identite" style={{ marginTop: 16 }}>
        <span className="etiquette">Mon identifiant</span>
        <code>{session.user.id}</code>
        <p className="aide">
          Utile au support. Pour rejoindre un autre événement, un code d'invitation suffit
          désormais — plus besoin de transmettre ceci.
        </p>
      </div>

      <button className="discret" onClick={() => supabase.auth.signOut()}>
        Se déconnecter
      </button>
    </section>
  )
}
