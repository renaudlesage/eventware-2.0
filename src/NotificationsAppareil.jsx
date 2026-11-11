import { useEffect, useState } from 'react'
import { etatPush, activerPush, desactiverPush, reglerPreferencesPush, PREFERENCES_PUSH } from './push'

/**
 * « Notifications sur cet appareil » (Mon compte).
 *
 * Un abonnement vaut pour UN appareil et UN navigateur : le téléphone
 * et l'ordinateur s'activent chacun de leur côté. La section dit
 * toujours où l'on en est — activées, bloquées par le navigateur,
 * impossibles ici et pourquoi — plutôt que de montrer un bouton qui
 * ne ferait rien.
 */
export default function NotificationsAppareil() {
  const [etat, setEtat] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [retour, setRetour] = useState(null)

  async function lire() {
    setEtat(await etatPush())
  }
  useEffect(() => {
    lire()
  }, [])

  async function activer() {
    setOccupe(true)
    setRetour(null)
    const r = await activerPush()
    setRetour(r.erreur ? { type: 'erreur', texte: r.erreur } : { type: 'ok', texte: 'Notifications activées sur cet appareil.' })
    await lire()
    setOccupe(false)
  }

  async function desactiver() {
    setOccupe(true)
    setRetour(null)
    await desactiverPush()
    setRetour({ type: 'ok', texte: 'Notifications désactivées sur cet appareil.' })
    await lire()
    setOccupe(false)
  }

  async function regler(clef, coche) {
    const preferences = { ...(etat?.preferences ?? {}), [clef]: coche }
    setEtat({ ...etat, preferences })
    const r = await reglerPreferencesPush(preferences)
    if (r.erreur) {
      setRetour({ type: 'erreur', texte: r.erreur })
      lire()
    }
  }

  return (
    <div className="notifs-appareil">
      <h3>Notifications sur cet appareil</h3>
      {!etat ? (
        <p className="aide" role="status">Vérification…</p>
      ) : !etat.possible ? (
        <p className="aide">{etat.raison}</p>
      ) : etat.abonne ? (
        <>
          <p className="aide">
            <strong>Activées.</strong> Cet appareil est prévenu même quand l'application est fermée.
            Les autres appareils se règlent chacun de leur côté.
          </p>
          <fieldset className="notifs-choix">
            <legend>Me prévenir pour</legend>
            {PREFERENCES_PUSH.map(([clef, libelle]) => (
              <label key={clef} className="case-a-cocher">
                <input
                  type="checkbox"
                  checked={etat.preferences?.[clef] !== false}
                  onChange={(e) => regler(clef, e.target.checked)}
                />
                {libelle}
              </label>
            ))}
          </fieldset>
          <button className="discret" disabled={occupe} onClick={desactiver}>
            {occupe ? 'Un instant…' : 'Désactiver sur cet appareil'}
          </button>
        </>
      ) : etat.permission === 'denied' ? (
        <p className="aide">
          Les notifications sont <strong>bloquées</strong> pour ce site dans ce navigateur. Autorise-les
          dans ses réglages (icône à gauche de l'adresse, ou Réglages › Notifications), puis reviens ici.
        </p>
      ) : (
        <>
          <p className="aide">
            Une alerte, une mission qui t'est attribuée, la réponse du QG ou un rappel de prise de poste
            peuvent arriver sur cet appareil même quand l'application est fermée.
          </p>
          <button disabled={occupe} onClick={activer}>
            {occupe ? 'Activation…' : 'Activer les notifications'}
          </button>
        </>
      )}
      {retour && (
        <p className={`message ${retour.type === 'erreur' ? 'erreur' : ''}`} role={retour.type === 'erreur' ? 'alert' : 'status'}>
          {retour.texte}
        </p>
      )}
    </div>
  )
}
