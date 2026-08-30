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

      {/* --- 2/3. Domaines opérationnels ------------------------------
           Repris du dashboard v18 : un bandeau de couleur par domaine,
           des compteurs minuscules colorés par ÉTAT (pas par domaine —
           rouge = nouveau/urgent, ambre = en attente, bleu = en cours,
           vert = traité), et un panneau qui défile en dessous avec un
           lien direct vers l'écran complet. C'est ce qui tient sur un
           seul écran de QG sans jamais faire défiler la page entière. */}

      <div className="grille-domaines">
        <ColonneDomaine
          teinte="grenat"
          icone="⚠"
          titre="Sécurité"
          lien="securite"
          onAller={onAller}
          compteurs={[
            { libelle: 'P1', valeur: s.missions?.p1, etat: 'urgent' },
            {
              libelle: 'Ouvertes',
              valeur: Math.max(0, (s.missions?.ouvertes ?? 0) - (s.missions?.p1 ?? 0)),
              etat: 'attente'
            }
          ]}
        >
          {(s.signalements?.derniers ?? []).length === 0 &&
          (s.recherches ?? []).length === 0 ? (
            <p className="moniteur-vide">Aucun signalement actif.</p>
          ) : (
            <>
              {(s.recherches ?? []).map((r, i) => (
                <div className="moniteur-ligne urgent" key={'r' + i}>
                  <strong>Recherche — {r.nom || 'personne'}</strong>
                  <span>{r.description}</span>
                </div>
              ))}
              {(s.signalements?.derniers ?? []).slice(0, 5).map((x, i) => (
                <div
                  className={`moniteur-ligne ${x.statut === 'recu' ? 'urgent' : ''}`}
                  key={'s' + i}
                >
                  <strong>
                    {x.reference} — {x.type}
                  </strong>
                  <span>{x.statut}</span>
                </div>
              ))}
            </>
          )}
        </ColonneDomaine>

        {m.logistique && (
          <ColonneDomaine
            teinte="bronze"
            icone="▤"
            titre="Logistique"
            lien="logistique"
            onAller={onAller}
            compteurs={[
              {
                libelle: 'Sous seuil',
                valeur: (s.logistique?.sous_seuil ?? []).length,
                etat: 'urgent'
              },
              { libelle: 'Transports', valeur: s.logistique?.transports_ouverts, etat: 'cours' },
              { libelle: 'Non rendus', valeur: s.logistique?.biens_non_rendus, etat: 'attente' }
            ]}
          >
            {(s.logistique?.sous_seuil ?? []).length === 0 ? (
              <p className="moniteur-vide">Aucune anomalie matérielle.</p>
            ) : (
              s.logistique.sous_seuil.map((a, i) => (
                <div className="moniteur-ligne urgent" key={i}>
                  <strong>{a.nom}</strong>
                  <span>
                    {Number(a.quantite)} {a.unite ?? ''} (seuil {Number(a.seuil)})
                  </span>
                </div>
              ))
            )}
          </ColonneDomaine>
        )}

        {m.parcours && (
          <ColonneDomaine
            teinte="mousse"
            icone="➜"
            titre="Parcours"
            lien="parcours"
            onAller={onAller}
            compteurs={[
              { libelle: 'Sans nouvelles', valeur: s.parcours?.sans_nouvelles, etat: 'urgent' },
              { libelle: 'En route', valeur: s.parcours?.en_route, etat: 'cours' },
              { libelle: 'Arrivés', valeur: s.parcours?.arrives, etat: 'ok' }
            ]}
          >
            {s.parcours?.sans_nouvelles > 0 ? (
              <p className="moniteur-vide alerte">
                {s.parcours.sans_nouvelles} groupe(s) sans nouvelles — voir Parcours.
              </p>
            ) : (
              <p className="moniteur-vide">Tous les groupes donnent de leurs nouvelles.</p>
            )}
          </ColonneDomaine>
        )}

        {m.rh && (
          <ColonneDomaine
            teinte="azur"
            icone="☺"
            titre="Bénévoles"
            lien="rh"
            onAller={onAller}
            compteurs={[
              { libelle: 'À couvrir', valeur: s.rh?.postes_a_couvrir, etat: 'urgent' },
              { libelle: 'Créneaux', valeur: s.rh?.creneaux_decouverts, etat: 'attente' }
            ]}
          >
            {s.rh?.postes_a_couvrir > 0 ? (
              <p className="moniteur-vide alerte">
                {s.rh.creneaux_decouverts} créneau(x) découvert(s) — voir Bénévoles.
              </p>
            ) : (
              <p className="moniteur-vide">Couverture complète.</p>
            )}
          </ColonneDomaine>
        )}
      </div>

      {/* --- 4. Le fil --- */}

      <section className="panneau large">
        <h2>Derniers événements</h2>
        <div className="panneau-corps">
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
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Colonne de domaine — bandeau coloré, compteurs minuscules colorés
 * par ÉTAT, panneau défilant, lien direct vers l'écran complet.
 */
function ColonneDomaine({ teinte, icone, titre, lien, onAller, compteurs, children }) {
  return (
    <div className={`colonne-domaine dom-${teinte}`}>
      <div className="colonne-tete">
        <span className="colonne-icone">{icone}</span>
        <span className="colonne-titre">{titre}</span>
      </div>

      <div className="colonne-compteurs">
        {compteurs
          .filter((c) => c.valeur !== null && c.valeur !== undefined)
          .map((c, i) => (
            <div className={`compteur-mini etat-${c.etat}`} key={i}>
              <span className="compteur-mini-valeur">{c.valeur}</span>
              <span className="compteur-mini-libelle">{c.libelle}</span>
            </div>
          ))}
      </div>

      <div className="moniteur">
        <div className="moniteur-entete">
          <span>Moniteur</span>
          {onAller && (
            <button className="moniteur-lien" onClick={() => onAller(lien)}>
              Ouvrir l'app →
            </button>
          )}
        </div>
        <div className="moniteur-corps">{children}</div>
      </div>
    </div>
  )
}

function ecoule(date) {
  const min = Math.round((Date.now() - new Date(date)) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.round(h / 24)} j`

}
