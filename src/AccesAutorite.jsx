import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'

export default function AccesAutorite({ evenement, setMessage }) {
  const [acces, setAcces] = useState([])
  const [f, setF] = useState({ libelle: '', organisation: '', contact: '' })
  const [ouvert, setOuvert] = useState(null)
  const [occupe, setOccupe] = useState(false)

  const base = `${window.location.origin}${window.location.pathname}?autorite=`

  async function charger() {
    const { data, error } = await supabase
      .from('acces_autorite')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setAcces(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!f.libelle.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('acces_autorite').insert({
      evenement_id: evenement.id,
      libelle: f.libelle.trim(),
      organisation: f.organisation.trim() || null,
      contact: f.contact.trim() || null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ libelle: '', organisation: '', contact: '' })
      charger()
    }
    setOccupe(false)
  }

  async function revoquer(id) {
    const { error, count } = await supabase
      .from('acces_autorite')
      .update({ actif: false }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Révocation refusée.' })
    else charger()
  }

  return (
    <section className="bloc">
      <h2>Accès autorité</h2>
      <p className="aide">
        Un lien de consultation, sans compte ni mot de passe, pour le bourgmestre, le
        Dir-PC-Ops ou la zone de secours. La vue est volontairement plus étroite que la
        vôtre : agrégats, alertes et installations à risque — jamais de personnes ni de
        main courante.
      </p>

      <div className="saisie-rapide">
        <input
          value={f.libelle}
          onChange={(e) => setF({ ...f, libelle: e.target.value })}
          placeholder="Destinataire — ex. Bourgmestre, Dir-PC-Ops"
        />
        <input
          value={f.organisation}
          onChange={(e) => setF({ ...f, organisation: e.target.value })}
          placeholder="Organisation"
          style={{ flex: '0 1 190px' }}
        />
        <button disabled={occupe || !f.libelle.trim()} onClick={creer}>
          Ouvrir un accès
        </button>
      </div>

      {acces.length === 0 ? (
        <p className="vide">Aucun accès ouvert.</p>
      ) : (
        acces.map((a) => (
          <div className={`carte ${a.actif ? '' : 'revoque'}`} key={a.id}>
            <div className="titre">
              {a.libelle}
              {!a.actif && <span className="jeton"> révoqué</span>}
            </div>
            <div className="meta">
              {a.organisation && <span>{a.organisation}</span>}
              <span>
                {a.nb_acces === 0
                  ? 'jamais consulté'
                  : `${a.nb_acces} consultation(s)`}
              </span>
              {a.dernier_acces && (
                <span>
                  dernier :{' '}
                  {new Date(a.dernier_acces).toLocaleString('fr-BE', {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              )}
            </div>

            {a.actif && (
              <>
                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <button
                    className="discret"
                    onClick={() => setOuvert(ouvert === a.id ? null : a.id)}
                  >
                    {ouvert === a.id ? 'Masquer' : 'Lien et QR'}
                  </button>
                  <button
                    className="discret"
                    onClick={() => navigator.clipboard?.writeText(base + a.jeton)}
                  >
                    Copier le lien
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Révoquer l'accès de ${a.libelle} ?`)) revoquer(a.id)
                    }}
                  >
                    Révoquer
                  </button>
                </div>

                {ouvert === a.id && (
                  <div className="formulaire" style={{ textAlign: 'center' }}>
                    <QRCodeSVG value={base + a.jeton} size={150} level="M" includeMargin />
                    <div className="identifiant" style={{ marginTop: 8 }}>
                      {base + a.jeton}
                    </div>
                    <p className="aide">
                      Chaque consultation est horodatée et journalisée : on saura qui a
                      regardé et quand.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ))
      )}
    </section>
  )
}
