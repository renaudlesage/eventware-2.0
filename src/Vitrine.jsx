import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Vitrine publique — ce que voit un participant qui scanne le QR.
 *
 * Elle ne montre QUE ce que l'organisateur a explicitement coché comme
 * public. La base contient soixante-seize lieux : le PC Ops, les PRV,
 * les voies de secours, les zones techniques. Rien de tout cela ne
 * sort par défaut, et la fonction serveur filtre elle-même — ce n'est
 * pas cet écran qui décide quoi cacher, ce qui serait fragile.
 *
 * Les alertes publiques sont le cœur : c'est la discipline 5 de l'AR du
 * 22 mai 2019, l'alerte et l'information de la population. Un
 * organisateur qui peut pousser « mise à l'abri » sur le téléphone de
 * chaque participant a une vraie capacité, pas un gadget.
 */
export default function Vitrine({ jeton }) {
  const [contenu, setContenu] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [vue, setVue] = useState('infos')

  async function charger() {
    const { data, error } = await supabase.rpc('contenu_public', { p_jeton: jeton })
    if (error) setErreur(error.message)
    else {
      setContenu(data)
      setErreur(null)
    }
  }

  useEffect(() => {
    charger()
    // Les alertes doivent arriver sans que le participant rafraîchisse.
    const t = setInterval(charger, 60000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeton])

  if (erreur) return <div className="message erreur">{erreur}</div>
  if (!contenu) return <p className="vide">…</p>

  const { alertes = [], lieux = [], programme = [], communications = [] } = contenu
  const heure = (d) =>
    new Date(d).toLocaleString('fr-BE', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })

  return (
    <>
      {/* Les alertes passent avant tout le reste et ne sont pas dans un
          onglet : une consigne de mise à l'abri ne se cherche pas. */}
      {alertes.map((a, i) => (
        <div className={`bandeau-alerte niv-${a.niveau}`} key={i}>
          <strong>{a.titre}</strong>
          {a.consigne && <p style={{ margin: '4px 0 0' }}>{a.consigne}</p>}
        </div>
      ))}

      <div className="onglets">
        {[
          ['infos', 'Infos'],
          ['programme', `Horaire${programme.length ? ` (${programme.length})` : ''}`],
          ['plan', `Plan${lieux.length ? ` (${lieux.length})` : ''}`]
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${vue === k ? 'actif' : ''}`}
            onClick={() => setVue(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {vue === 'infos' && (
        <>
          {communications.length === 0 ? (
            <p className="vide">Aucune information pour le moment.</p>
          ) : (
            communications.map((c, i) => (
              <div className="carte" key={i}>
                <div className="titre">{c.titre}</div>
                {c.corps && <p style={{ margin: '6px 0 0' }}>{c.corps}</p>}
                {c.lien_url && (
                  <p style={{ margin: '8px 0 0' }}>
                    <a href={c.lien_url} target="_blank" rel="noreferrer">
                      {c.lien_libelle || 'En savoir plus'} →
                    </a>
                  </p>
                )}
              </div>
            ))
          )}
        </>
      )}

      {vue === 'programme' && (
        <>
          {programme.length === 0 ? (
            <p className="vide">L'horaire n'est pas encore publié.</p>
          ) : (
            programme.map((p, i) => (
              <div className="carte" key={i}>
                <div className="titre">
                  <span className="mono">{heure(p.debut)}</span> {p.titre}
                </div>
                <div className="meta">
                  {p.lieu && <span>{p.lieu}</span>}
                  {p.intervenant && <span>{p.intervenant}</span>}
                  {p.duree_min && <span>{p.duree_min} min</span>}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {vue === 'plan' && (
        <>
          {lieux.length === 0 ? (
            <p className="vide">Le plan n'est pas encore publié.</p>
          ) : (
            lieux.map((l, i) => (
              <div className="carte" key={i}>
                <div className="titre">{l.nom}</div>
                <div className="meta">
                  {l.pk_km != null && <span>PK {Number(l.pk_km).toFixed(1)}</span>}
                  {l.latitude && (
                    <a
                      href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      M'y conduire →
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </>
  )
}
