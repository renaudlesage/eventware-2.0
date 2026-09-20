import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Participant from './Participant'
import Autorite from './Autorite'
import Connexion from './Connexion'
import Poste from './Poste'

/**
 * L'aiguillage d'entrée — et rien d'autre.
 *
 * Trois portes, décidées par l'adresse avant toute session :
 *   ?sos=<jeton>        la page participant (vitrine, signalement) ;
 *   ?autorite=<jeton>   la page autorité, sans compte ;
 *   sinon               la connexion, puis le poste de travail.
 *
 * Le fichier a longtemps porté tout le poste (1 350 lignes) ; le lot 12
 * l'a découpé — Connexion.jsx, Evenements.jsx, Reglages.jsx, Poste.jsx —
 * pour que la refonte du poste de travail se pose sur une coquille
 * isolée, pas au milieu des réglages.
 */
export default function App() {
  const [session, setSession] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [theme, setTheme] = useState(
    () => localStorage.getItem('eventware.theme') ?? 'auto'
  )

  const parametres = new URLSearchParams(window.location.search)
  const jetonSos = parametres.get('sos')
  const codeLieu = parametres.get('lieu')
  const jetonAutorite = parametres.get('autorite')

  useEffect(() => {
    const racine = document.documentElement
    if (theme === 'auto') racine.removeAttribute('data-theme')
    else racine.setAttribute('data-theme', theme)
    localStorage.setItem('eventware.theme', theme)
  }, [theme])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChargement(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (jetonSos) return <Participant jeton={jetonSos} codeLieu={codeLieu} />
  if (jetonAutorite) return <Autorite jeton={jetonAutorite} />
  if (chargement) return <div className="attente">Chargement…</div>
  if (!session) return <Connexion theme={theme} setTheme={setTheme} />

  return <Poste session={session} theme={theme} setTheme={setTheme} />
}
