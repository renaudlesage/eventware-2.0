import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Suivi de parcours en mode INDIVIDUS ISOLÉS — marche Adeps, rando VTT.
 *
 * On ne suit pas qui est où : personne ne peut nommer six cents
 * marcheurs. On compte des passages à chaque borne, et c'est l'écart
 * entre deux bornes qui porte l'information de sécurité — « douze
 * personnes entre E2B et E3B » dit où envoyer la voiture-balai à la
 * fermeture.
 *
 * Les comptages sont des incréments horodatés, jamais un cumul écrasé :
 * deux bénévoles peuvent compter à la même borne sans se marcher
 * dessus, et une erreur se corrige par un nombre négatif au lieu de
 * réécrire l'histoire.
 */
export default function Flux({ evenement, membre, setMessage }) {
  const [bornes, setBornes] = useState(null)
  const [compteur, setCompteur] = useState(null)

  async function charger() {
    const { data, error } = await supabase.rpc('flux_parcours', { p_evenement: evenement.id })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setBornes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 30000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  if (bornes === null) return <p className="vide">…</p>
  if (bornes.length === 0) {
    return (
      <p className="vide">
        Aucune borne avec un PK. Renseigne le PK des lieux dans Implantation — c'est lui qui
        ordonne le parcours et permet de situer les participants entre deux points.
      </p>
    )
  }

  const partis = bornes[0]?.passages ?? 0
  const arrives = bornes[bornes.length - 1]?.passages ?? 0
  const dehors = Math.max(0, partis - arrives)

  return (
    <>
      <div className="compteurs">
        <span>
          Partis <strong>{partis}</strong>
        </span>
        <span>
          Arrivés <strong>{arrives}</strong>
        </span>
        <span className={dehors ? 'alerte-texte' : ''}>
          Encore dehors <strong>{dehors}</strong>
        </span>
      </div>

      <p className="aide">
        « Encore dehors » = passages au départ moins passages à la dernière borne. C'est le
        chiffre qui décide d'une battue en fin de journée — il ne vaut que si chaque borne
        compte vraiment.
      </p>

      {bornes.map((b, i) => {
        const suivante = bornes[i + 1]
        return (
          <div className="carte" key={b.lieu_id}>
            <div className="titre">
              <span className="mono">{b.code}</span> {b.nom}
            </div>
            <div className="meta">
              <span>PK {Number(b.pk_km).toFixed(1)}</span>
              <span>
                <strong>{b.passages}</strong> passage(s)
              </span>
              {b.dernier && (
                <span>
                  dernier à{' '}
                  {new Date(b.dernier).toLocaleTimeString('fr-BE', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              )}
            </div>

            {suivante && (
              <p className={`aide ${b.encore_apres > 0 ? 'alerte-texte' : ''}`}>
                {b.encore_apres} entre {b.code} et {suivante.code}
              </p>
            )}

            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button onClick={() => setCompteur(compteur === b.lieu_id ? null : b.lieu_id)}>
                {compteur === b.lieu_id ? 'Fermer' : 'Compter ici'}
              </button>
            </div>

            {compteur === b.lieu_id && (
              <Compteur
                evenement={evenement}
                membre={membre}
                borne={b}
                setMessage={setMessage}
                onFait={charger}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Compteur de terrain. Pensé pour être utilisé debout, au bord d'un
 * chemin, en regardant passer les gens plutôt que l'écran : de gros
 * pas, et un envoi qui ne demande pas de confirmation.
 *
 * Le tampon local évite un aller-retour réseau par personne — on
 * accumule, on envoie quand le flux se calme.
 */
function Compteur({ evenement, membre, borne, setMessage, onFait }) {
  const [tampon, setTampon] = useState(0)
  const [occupe, setOccupe] = useState(false)

  async function envoyer(valeur) {
    if (!valeur) return
    setOccupe(true)
    const { error } = await supabase.from('comptages_parcours').insert({
      evenement_id: evenement.id,
      lieu_id: borne.lieu_id,
      nombre: valeur,
      membre_id: membre.id
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setTampon(0)
      onFait()
    }
    setOccupe(false)
  }

  return (
    <div className="formulaire">
      <div className="grand" style={{ textAlign: 'center' }}>
        {tampon > 0 ? `+${tampon}` : tampon}
      </div>

      <div className="ligne-boutons">
        {[1, 5, 10].map((n) => (
          <button key={n} className="bouton-terrain" onClick={() => setTampon(tampon + n)}>
            +{n}
          </button>
        ))}
        <button className="discret" onClick={() => setTampon(tampon - 1)}>
          −1
        </button>
      </div>

      <div className="ligne-boutons" style={{ marginTop: 8 }}>
        <button disabled={occupe || tampon === 0} onClick={() => envoyer(tampon)}>
          Enregistrer {tampon > 0 ? `+${tampon}` : tampon}
        </button>
        <button className="discret" disabled={tampon === 0} onClick={() => setTampon(0)}>
          Effacer
        </button>
      </div>

      <p className="aide">
        Compte à ton rythme, enregistre quand le flux se calme — rien n'est envoyé avant.
        Une erreur se corrige avec −1 puis un nouvel enregistrement : les comptages
        s'additionnent, aucun n'écrase les autres.
      </p>
    </div>
  )
}
