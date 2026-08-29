import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Meteo from './Meteo'
import Maydays from './Maydays'

/**
 * Tableau de bord général — la vue QG.
 *
 * Distinct du tableau de bord individuel : celui-ci ne montre pas ce
 * qui me concerne, il montre la situation. C'est ce qu'on projette sur
 * l'écran du PC-Ops et ce qu'on regarde quand quelqu'un demande
 * « où on en est ? ».
 *
 * Ordre de lecture délibéré : ce qui exige une décision d'abord,
 * ce qui informe ensuite, ce qui rassure en dernier.
 */
export default function Situation({ evenement, peut, toutPouvoir, onAller }) {
  const [s, setS] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [maj, setMaj] = useState(null)

  async function charger() {
    const { data, error } = await supabase.rpc('situation', { p_evenement: evenement.id })
    if (error) setErreur(error.message)
    else {
      setS(data)
      setMaj(new Date())
      setErreur(null)
    }
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  if (erreur) return <div className="message erreur">{erreur}</div>
  if (!s) return <p className="vide">Chargement de la situation…</p>

  const m = s.evenement?.modules ?? {}

  return (
    <div className="situation dom-indigo">
      <div className="entete-dashboard">
        <h2>Situation</h2>
        <span className="compte">
          {maj && `relevé ${maj.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`}
        </span>
      </div>

      {/* --- 1. Ce qui exige une décision --- */}

      <Maydays evenement={evenement} compact />

      {(s.alertes ?? []).map((a, i) => (
        <div className={`bandeau-alerte niv-${a.niveau}`} key={i}>
          <div className="niv">{a.niveau}</div>
          <div className="contenu">
            <strong>{a.titre}</strong>
            {a.consigne && <div className="consigne">→ {a.consigne}</div>}
          </div>
        </div>
      ))}

      {(s.recherches ?? []).length > 0 && (
        <div className="bloc-alerte">
          <div className="pave-titre">Recherche en cours</div>
          {s.recherches.map((r, i) => (
            <div className="ligne-retard" key={i}>
              <strong>
                {r.nom || 'Personne non identifiée'}{' '}
                <span className="mono">{r.reference}</span>
              </strong>
              <div className="meta">
                <span>{r.description}</span>
                {r.dernier_lieu && <span>vu·e : {r.dernier_lieu}</span>}
                <span>depuis {ecoule(r.depuis)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Meteo
        evenement={evenement}
        peut={peut}
        toutPouvoir={toutPouvoir}
        onAlerte={async (a) => {
          const { error } = await supabase
            .from('alertes')
            .insert({ evenement_id: evenement.id, ...a })
          if (error) setErreur(error.message)
          else charger()
        }}
      />

      {/* --- 2. Les compteurs de charge --- */}

      <div className="grille-paves">
        {m.sos_participants && (
          <Pave titre="Signalements">
            <Grand
              v={s.signalements?.ouverts}
              alerte={s.signalements?.non_pris_en_charge > 0}
              onClick={() => onAller?.('sos')}
            />
            <Ligne l="jamais pris en charge" v={s.signalements?.non_pris_en_charge}
                   alerte={s.signalements?.non_pris_en_charge > 0} />
            <Ligne l="reçus depuis le début" v={s.signalements?.total} />
          </Pave>
        )}

        <Pave titre="Missions">
          <Grand v={s.missions?.ouvertes} alerte={s.missions?.p1 > 0}
                 onClick={() => onAller?.('securite')} />
          <Ligne l="en P1" v={s.missions?.p1} alerte={s.missions?.p1 > 0} />
          <Ligne l="sans affectation" v={s.missions?.non_attribuees}
                 alerte={s.missions?.non_attribuees > 0} />
          <Ligne l="résolues" v={s.missions?.resolues} />
        </Pave>

        {m.parcours && (
          <Pave titre="Sur le parcours">
            <Grand v={s.parcours?.personnes_sur_parcours}
                   alerte={s.parcours?.sans_nouvelles > 0}
                   onClick={() => onAller?.('parcours')} />
            <Ligne l="groupes en route" v={s.parcours?.en_route} />
            <Ligne l="sans nouvelles" v={s.parcours?.sans_nouvelles}
                   alerte={s.parcours?.sans_nouvelles > 0} />
            <Ligne l="abandons" v={s.parcours?.abandons} />
          </Pave>
        )}

        {m.logistique && (
          <Pave titre="Logistique">
            <Grand v={s.logistique?.jauge} />
            <Ligne l="présents estimés" v={null} />
            <Ligne l="transports ouverts" v={s.logistique?.transports_ouverts} />
            <Ligne l="biens non rendus" v={s.logistique?.biens_non_rendus}
                   alerte={s.logistique?.biens_non_rendus > 0} />
            <Ligne l="articles sous seuil" v={(s.logistique?.sous_seuil ?? []).length}
                   alerte={(s.logistique?.sous_seuil ?? []).length > 0} />
          </Pave>
        )}

        {m.rh && (
          <Pave titre="Couverture">
            <Grand v={s.rh?.postes_a_couvrir} alerte={s.rh?.postes_a_couvrir > 0}
                   onClick={() => onAller?.('rh')} />
            <Ligne l="postes à couvrir" v={null} />
            <Ligne l="créneaux découverts" v={s.rh?.creneaux_decouverts}
                   alerte={s.rh?.creneaux_decouverts > 0} />
          </Pave>
        )}
      </div>

      {/* --- 3. Les détails actionnables --- */}

      {(s.logistique?.sous_seuil ?? []).length > 0 && (
        <section className="bloc">
          <h2>Sous le seuil</h2>
          {s.logistique.sous_seuil.map((a, i) => (
            <div className="carte urgent" key={i}>
              <div className="titre">{a.nom}</div>
              <div className="meta">
                <span className="alerte-texte">
                  <strong>{Number(a.quantite)}</strong> {a.unite ?? ''}
                </span>
                <span>seuil {Number(a.seuil)}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {(s.signalements?.derniers ?? []).length > 0 && (
        <section className="bloc">
          <h2>Signalements en cours</h2>
          {s.signalements.derniers.map((x, i) => (
            <div className={`carte ${x.statut === 'recu' ? 'urgent' : ''}`} key={i}>
              <div className="titre">
                <span className="mono">{x.reference}</span> — {x.type}
              </div>
              {x.description && <p style={{ margin: '3px 0' }}>{x.description}</p>}
              <div className="meta">
                <span>{x.statut}</span>
                <span>{ecoule(x.recu_le)}</span>
                {x.latitude && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps?q=${x.latitude},${x.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Y aller
                  </a>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {(s.jalons ?? []).length > 0 && (
        <section className="bloc">
          <h2>Prochaines échéances</h2>
          {s.jalons.map((j, i) => {
            const depasse = new Date(j.echeance) < new Date()
            return (
              <div className={`carte ${depasse || j.critique ? 'urgent' : ''}`} key={i}>
                <div className="titre">
                  {j.libelle}
                  {j.critique && <span className="jeton alerte-texte"> critique</span>}
                </div>
                <div className="meta">
                  <span className={depasse ? 'alerte-texte' : ''}>
                    {new Date(j.echeance).toLocaleString('fr-BE', {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {depasse && ' — dépassée'}
                  </span>
                  {j.responsable && <span>{j.responsable}</span>}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* --- 4. Le fil --- */}

      <section className="bloc">
        <h2>Derniers événements</h2>
        <ul className="chrono">
          {(s.journal ?? []).map((l, i) => (
            <li key={i} className={`imp-${l.importance} src-${l.source}`}>
              <span className="heure mono">
                {new Date(l.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {l.texte}
                {l.module && <span className="tag">{l.module}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Pave({ titre, children }) {
  return (
    <div className="pave">
      <div className="pave-titre">{titre}</div>
      {children}
    </div>
  )
}

function Grand({ v, alerte, onClick }) {
  const contenu = <span className={`grand ${alerte ? 'alerte-texte' : ''}`}>{v ?? '—'}</span>
  if (!onClick) return <div>{contenu}</div>
  return (
    <button className="grand-lien" onClick={onClick}>
      {contenu}
    </button>
  )
}

function Ligne({ l, v, alerte }) {
  return (
    <div className={`detail-metrique ${alerte ? 'alerte-texte' : ''}`}>
      <span>{l}</span>
      {v !== null && v !== undefined && <strong>{v}</strong>}
    </div>
  )
}

function ecoule(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.round(h / 24)} j`
}
