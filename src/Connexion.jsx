import { useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/* ================================================================== */
/* Connexion                                                           */
/* ================================================================== */

export default function Connexion({ theme, setTheme }) {
  const [email, setEmail] = useState('')
    const [nom, setNom] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [message, setMessage] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function agir(mode) {
    setOccupe(true)
    setMessage(null)
    const { data, error } =
      mode === 'creer'
          ? await supabase.auth.signUp({
              email,
              password: motDePasse,
              // Porté par le COMPTE : une personne qui rejoint trois
              // événements ne doit pas se renommer trois fois.
              options: { data: { nom: nom.trim() } }
            })
        : await supabase.auth.signInWithPassword({ email, password: motDePasse })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (mode === 'creer' && !data.session)
      setMessage({
        type: 'info',
        texte:
          'Compte créé. La confirmation par e-mail est active : désactive-la dans Supabase pour tester sans boîte mail.'
      })
    setOccupe(false)
  }

  const pret = email.trim() && motDePasse.trim()

  return (
    <div className="acces">
      <div className="acces-carte">
        <div className="marque">
          <span className="marque-nom">Eventware</span>
          <span className="marque-suite">2.0</span>
        </div>
        <p className="acces-role">Coordination d'événement</p>

        {message && (
          <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
            {message.texte}
          </div>
        )}

        <label htmlFor="email">Adresse e-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="mdp">Mot de passe</label>
        <input
          id="mdp"
          type="password"
          autoComplete="current-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />

          <label htmlFor="nom">Nom et prénom</label>
          <input
            id="nom"
            autoComplete="name"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Uniquement pour créer un compte"
          />
          <p className="aide" style={{ marginTop: -4 }}>
            C'est ce nom que verra le poste de commandement. Sans lui, tu apparais « sans
            nom » dans les listes, et personne ne sait qui répond à la radio.
          </p>

        <button className="principal" disabled={occupe || !pret} onClick={() => agir('entrer')}>
          Se connecter
        </button>
        <button className="discret" disabled={occupe || !pret || !nom.trim()} onClick={() => agir('creer')}>
          Créer un compte
        </button>

        {!pret && (
          <p className="aide">Saisis une adresse et un mot de passe pour continuer.</p>
        )}

        <BasculeTheme theme={theme} setTheme={setTheme} />
      </div>
    </div>
  )
}

export function BasculeTheme({ theme, setTheme, compact }) {
  const suivant = { auto: 'clair', clair: 'sombre', sombre: 'auto' }
  const libelle = { auto: 'Auto', clair: 'Jour', sombre: 'Nuit' }
  return (
    <button
      className={compact ? 'discret sortie' : 'discret'}
      onClick={() => setTheme(suivant[theme])}
      title="Le QG tourne la nuit, le terrain en plein soleil"
    >
      {libelle[theme]}
    </button>
  )
}
