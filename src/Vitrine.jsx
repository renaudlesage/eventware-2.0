import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Pointage from './Pointage'

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
export default function Vitrine({ jeton, codeLieu }) {
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

  const { alertes = [], lieux = [], programme = [], communications = [], jalons = [] } = contenu
  const heure = (d) =>
    new Date(d).toLocaleString('fr-BE', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })

  /*
   * Les jalons publics rejoignent l'horaire au lieu d'avoir leur propre
   * onglet. Un participant ne fait pas la différence entre « le concert
   * commence » et « la rue ferme » : les deux sont des choses qui
   * arrivent à une heure, et il les veut dans le même ordre. Un onglet
   * séparé l'obligerait à lire deux listes et à les recouper lui-même.
   *
   * Ils restent reconnaissables — une mention, et l'état « c'est fait »
   * que le programme n'a pas : une route rouverte est une information
   * plus utile qu'une route qui devait rouvrir.
   */
  const horaire = [
    ...programme.map((p) => ({ type: 'programme', quand: p.debut, ...p })),
    ...jalons.map((j) => ({ type: 'jalon', quand: j.echeance, ...j }))
  ].sort((a, b) => {
    if (!a.quand) return 1
    if (!b.quand) return -1
    return new Date(a.quand) - new Date(b.quand)
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

      {contenu.evenement?.mode_parcours === 'individuels' && codeLieu && (
        <Pointage
          jeton={jeton}
          codeLieu={codeLieu}
          nomLieu={lieux.find((l) => l.code === codeLieu)?.nom}
        />
      )}

      <div className="onglets">
        {[
          ['infos', 'Infos'],
          ['programme', `Horaire${horaire.length ? ` (${horaire.length})` : ''}`],
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
          {horaire.length === 0 ? (
            <p className="vide">L'horaire n'est pas encore publié.</p>
          ) : (
            horaire.map((x, i) =>
              x.type === 'jalon' ? (
                <div className="carte" key={i}>
                  <div className="titre" style={x.fait ? { opacity: 0.6 } : undefined}>
                    <span className="mono">{x.quand ? heure(x.quand) : '—'}</span> {x.libelle}
                  </div>
                  <div className="meta">
                    <span>info pratique</span>
                    {x.fait && <span>c'est fait</span>}
                  </div>
                </div>
              ) : (
                <div className="carte" key={i}>
                  <div className="titre">
                    <span className="mono">{heure(x.debut)}</span> {x.titre}
                  </div>
                  <div className="meta">
                    {x.lieu && <span>{x.lieu}</span>}
                    {x.intervenant && <span>{x.intervenant}</span>}
                    {x.duree_min && <span>{x.duree_min} min</span>}
                  </div>
                </div>
              )
            )
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
