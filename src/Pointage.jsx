import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { nouvelleCle } from './fileSos'

/**
 * Pointage par QR, scanné par le participant lui-même.
 *
 * Même principe que la file des signalements : le pointage est d'abord
 * écrit dans le téléphone, puis envoyé. Jamais l'inverse. Une borne au
 * fond d'une vallée n'a pas de réseau, et un pointage perdu là est un
 * pointage qui manquera au décompte du soir.
 *
 * La clé est générée AVANT le premier envoi et ne change jamais : c'est
 * elle qui empêche qu'un renvoi compte la même personne deux fois —
 * l'index unique côté base s'appuie dessus.
 */

const CLEF = 'eventware.pointages.file'

function lireFile() {
  try {
    return JSON.parse(localStorage.getItem(CLEF) ?? '[]')
  } catch {
    return []
  }
}

function ecrireFile(f) {
  try {
    localStorage.setItem(CLEF, JSON.stringify(f))
  } catch {
    /* stockage plein ou refusé : on continue sans file */
  }
}

export default function Pointage({ jeton, codeLieu, nomLieu }) {
  const [etat, setEtat] = useState('pret') // pret | envoi | fait | file
  const [message, setMessage] = useState(null)
  const [enAttente, setEnAttente] = useState(lireFile().length)

  // À chaque ouverture, on tente de vider ce qui n'est pas parti — et
  // aussi au retour du réseau et au retour de l'écran au premier plan.
  // Sans ces deux-là, un pointage fait sous les arbres restait bloqué
  // jusqu'au scan suivant : celui qui pointe puis remet son téléphone
  // en poche n'a aucune raison de rouvrir l'écran.
  useEffect(() => {
    viderFile()
    const auPremierPlan = () => {
      if (!document.hidden) viderFile()
    }
    window.addEventListener('online', viderFile)
    document.addEventListener('visibilitychange', auPremierPlan)
    return () => {
      window.removeEventListener('online', viderFile)
      document.removeEventListener('visibilitychange', auPremierPlan)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function envoyer(p) {
    const { data, error } = await supabase.rpc('pointer_passage', {
      p_jeton: jeton,
      p_cle_client: p.cle,
      p_code_lieu: p.code,
      p_latitude: p.lat ?? null,
      p_longitude: p.lon ?? null,
      p_precision_m: p.precision ?? null,
      p_emis_le: p.emis_le
    })
    if (error) throw error
    return data?.[0]
  }

  async function viderFile() {
    const f = lireFile()
    if (f.length === 0) return
    const restants = []
    for (const p of f) {
      try {
        await envoyer(p)
      } catch {
        restants.push(p)
      }
    }
    ecrireFile(restants)
    setEnAttente(restants.length)
  }

  function position() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({})
      const fini = setTimeout(() => resolve({}), 4000) // on n'attend pas indéfiniment
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(fini)
          resolve({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            precision: Math.round(p.coords.accuracy)
          })
        },
        () => {
          clearTimeout(fini)
          resolve({})
        },
        { enableHighAccuracy: true, timeout: 4000 }
      )
    })
  }

  async function pointer() {
    setEtat('envoi')
    setMessage(null)

    const pos = await position()
    const p = {
      cle: nouvelleCle(),
      code: codeLieu,
      emis_le: new Date().toISOString(),
      ...pos
    }

    // Écrit d'abord : si l'envoi échoue, rien n'est perdu.
    const f = [...lireFile(), p]
    ecrireFile(f)
    setEnAttente(f.length)

    try {
      const r = await envoyer(p)
      ecrireFile(lireFile().filter((x) => x.cle !== p.cle))
      setEnAttente(lireFile().length)
      setEtat('fait')
      setMessage(
        r?.deja_pointe
          ? 'Ce passage était déjà enregistré.'
          : `Passage enregistré à ${r?.lieu ?? codeLieu}.`
      )
    } catch {
      setEtat('file')
      setMessage("Pas de réseau ici — ton passage est gardé et partira tout seul.")
    }
  }

  if (!codeLieu) return null

  return (
    <section className="bloc dom-mousse">
      <h2>Pointer mon passage</h2>

      {etat === 'fait' || etat === 'file' ? (
        <>
          <p className={etat === 'fait' ? '' : 'alerte-texte'}>{message}</p>
          <button className="discret" onClick={() => setEtat('pret')}>
            Pointer à nouveau
          </button>
        </>
      ) : (
        <>
          <p className="aide" style={{ marginTop: 0 }}>
            Tu es à <strong>{nomLieu || codeLieu}</strong>. Un seul geste : ça permet au poste
            de commandement de savoir combien de personnes sont encore sur le parcours.
          </p>
          <button
            className="bouton-terrain"
            disabled={etat === 'envoi'}
            onClick={pointer}
            style={{ width: '100%' }}
          >
            {etat === 'envoi' ? 'Enregistrement…' : 'Je pointe ici'}
          </button>
        </>
      )}

      {enAttente > 0 && (
        <p className="aide">
          {enAttente} pointage(s) en attente de réseau — ils partiront tout seuls.
        </p>
      )}
    </section>
  )
}
