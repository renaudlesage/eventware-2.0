import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { appliquerIconeEvenement } from './logoPwa'

const REFUS = {
  P0002: "Ce lien ne correspond à aucun accès.",
  P0005: "Cet accès a été révoqué par l'organisateur.",
  P0006: 'Cet accès a expiré.'
}

const CATEGORIES = {
  foodtruck: 'Foodtruck',
  groupe_electrogene: 'Groupe électrogène',
  stockage_gaz: 'Stockage gaz',
  bar_installation: 'Bar',
  feu: 'Feu'
}

/**
 * Page autorité.
 *
 * Consultée sans compte, sur jeton. Volontairement plus étroite que la
 * vue interne : agrégats, alertes et installations à risque — jamais de
 * personnes, de descriptions ni de main courante. Un lien qui circule
 * hors de l'équipe ne peut pas exposer un signalement de malaise ou la
 * description d'un enfant recherché.
 */
export default function Autorite({ jeton }) {
  const [s, setS] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [maj, setMaj] = useState(null)

  async function charger() {
    const { data, error } = await supabase.rpc('situation_autorite', { p_jeton: jeton })
    if (error) setErreur(REFUS[error.code] ?? error.message)
    else {
      setS(data)
      setMaj(new Date())
      setErreur(null)
    }
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 30000)
    return () => clearInterval(t)
  }, [jeton])

  useEffect(() => {
    if (s) appliquerIconeEvenement(s.evenement?.nom, s.evenement?.logo_url)
  }, [s?.evenement?.logo_url])

  if (erreur)
    return (
      <div className="autorite">
        <div className="message erreur">{erreur}</div>
        <p className="aide">Rapproche-toi de l'organisateur pour obtenir un lien valable.</p>
      </div>
    )

  if (!s) return <div className="autorite"><p className="vide">Chargement…</p></div>

  const a = s.activite ?? {}
  const p = s.public ?? {}
  const risques = s.installations_risque ?? []

  return (
    <div className="autorite">
      <header className="bandeau">
        <div className="bandeau-titre">
          {s.evenement?.logo_url && (
            <img src={s.evenement.logo_url} alt="" className="logo-participant" />
          )}
          <div>
            <h1>{s.evenement?.nom}</h1>
            <p className="acces-role">
              {s.destinataire?.libelle}
              {s.destinataire?.organisation ? ` · ${s.destinataire.organisation}` : ''}
            </p>
          </div>
        </div>
        <div className="etat-droite">
          <span className={`plaque phase-${s.evenement?.phase}`}>{s.evenement?.phase}</span>
          <span className="compte">
            {maj &&
              `relevé ${maj.toLocaleTimeString('fr-BE', {
                hour: '2-digit',
                minute: '2-digit'
              })}`}
          </span>
        </div>
      </header>

      {(s.alertes ?? []).length > 0 &&
        s.alertes.map((al, i) => (
          <div className={`bandeau-alerte niv-${al.niveau}`} key={i}>
            <div className="niv">{al.niveau}</div>
            <div className="contenu">
              <strong>{al.titre}</strong>
              {al.message && <div className="msg">{al.message}</div>}
              {al.consigne && <div className="consigne">→ {al.consigne}</div>}
              <div className="meta">
                <span>
                  {new Date(al.emise_le).toLocaleString('fr-BE', {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            </div>
          </div>
        ))}

      {(s.alertes ?? []).length === 0 && (
        <div className="message">Aucune alerte en cours.</div>
      )}

      <section className="bloc">
        <h2>Public</h2>
        <div className="grille-paves">
          <div className="pave">
            <div className="pave-titre">Présents estimés</div>
            <div className="grand">{p.jauge ?? '—'}</div>
          </div>
          {p.sur_parcours > 0 && (
            <div className="pave">
              <div className="pave-titre">Sur le parcours</div>
              <div className="grand">{p.sur_parcours}</div>
              <div className="detail-metrique">
                <span>groupes sans nouvelles</span>
                <strong className={p.groupes_sans_nouvelles > 0 ? 'alerte-texte' : ''}>
                  {p.groupes_sans_nouvelles}
                </strong>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bloc">
        <h2>Activité du dispositif</h2>
        <div className="grille-paves">
          <div className="pave">
            <div className="pave-titre">Signalements</div>
            <div className={`grand ${a.signalements_ouverts > 0 ? 'alerte-texte' : ''}`}>
              {a.signalements_ouverts}
            </div>
            <div className="detail-metrique">
              <span>depuis le début</span>
              <strong>{a.signalements_total}</strong>
            </div>
          </div>
          <div className="pave">
            <div className="pave-titre">Interventions</div>
            <div className={`grand ${a.missions_p1 > 0 ? 'alerte-texte' : ''}`}>
              {a.missions_ouvertes}
            </div>
            <div className="detail-metrique">
              <span>priorité maximale</span>
              <strong className={a.missions_p1 > 0 ? 'alerte-texte' : ''}>
                {a.missions_p1}
              </strong>
            </div>
          </div>
          {a.recherches_en_cours > 0 && (
            <div className="pave">
              <div className="pave-titre">Recherche de personne</div>
              <div className="grand alerte-texte">{a.recherches_en_cours}</div>
              <div className="detail-metrique">
                <span>en cours</span>
              </div>
            </div>
          )}
        </div>
        <p className="aide">
          Volumes uniquement. Le détail des signalements et l'identité des personnes
          concernées restent au poste de commandement.
        </p>
      </section>

      {risques.length > 0 && (
        <section className="bloc">
          <h2>Installations à risque</h2>
          {risques.map((r, i) => (
            <div className="carte" key={i}>
              <div className="titre">
                {r.nom}
                {!r.confirme && (
                  <span className="jeton alerte-texte"> non confirmé sur site</span>
                )}
              </div>
              <div className="meta">
                <span>{CATEGORIES[r.categorie] ?? r.categorie}</span>
                {r.latitude && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Localiser
                  </a>
                )}
              </div>
              <dl className="fiche">
                {r.organe_coupure && (
                  <>
                    <dt>Où couper</dt>
                    <dd>
                      <strong>{r.organe_coupure}</strong>
                    </dd>
                  </>
                )}
                {r.moyens_proximite && (
                  <>
                    <dt>Moyens à proximité</dt>
                    <dd>{r.moyens_proximite}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}
        </section>
      )}

      <p className="aide">
        Consultation en lecture seule, mise à jour toutes les 30 secondes. Ce lien est
        personnel et révocable. Pour toute décision, le contact reste le poste de
        commandement.
      </p>
    </div>
  )
}
