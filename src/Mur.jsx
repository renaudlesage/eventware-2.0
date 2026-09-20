import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Le tableau de bord du mur — deuxième colonne de travail à partir de
 * 2200 px (refonte du 20/09), pour l'encadrement seulement.
 *
 * Le principe du palier : la résolution supplémentaire achète de
 * l'INFORMATION, jamais du blanc. Cette colonne condense ce que la
 * Situation et Bénévoles détaillent : quatre compteurs, quatre pavés,
 * la couverture des postes en cours, la charge par domaine. Tout vient
 * de `situation()` et de `couverture_creneaux()` — aucun chiffre n'est
 * inventé, et ce qui n'a pas de source n'est pas affiché.
 */
const DOMAINES = [
  ['securite', 'Sécurité'],
  ['logistique', 'Logistique'],
  ['parcours', 'Parcours'],
  ['rh', 'Bénévoles'],
  ['sanitaire', 'Sanitaire']
]

export default function Mur({ evenement, onAller }) {
  const [s, setS] = useState(null)
  const [postes, setPostes] = useState([])

  useEffect(() => {
    let vivant = true
    async function charger() {
      const maintenant = new Date().toISOString()
      const [sit, couv] = await Promise.all([
        supabase.rpc('situation', { p_evenement: evenement.id }),
        supabase.rpc('couverture_creneaux', { p_evenement: evenement.id, p_depuis: maintenant })
      ])
      if (!vivant) return
      if (!sit.error) setS(sit.data)
      const now = Date.now()
      setPostes(
        (couv.data ?? []).filter(
          (c) => new Date(c.debut).getTime() <= now && new Date(c.fin).getTime() >= now
        )
      )
    }
    charger()
    const t = setInterval(charger, 30000)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [evenement.id])

  if (!s) return <p className="vide">…</p>

  const m = s.missions ?? {}
  const sig = s.signalements ?? {}
  const parStatut = m.par_statut ?? {}
  const parModule = m.par_module ?? {}
  const maxModule = Math.max(1, ...Object.values(parModule).map((x) => x.ouvertes ?? 0))
  const tenus = postes.filter((c) => c.manque === 0).length
  const couverture = postes.length ? Math.round((100 * tenus) / postes.length) : null
  const retards = (s.jalons ?? []).filter((j) => j.echeance && new Date(j.echeance) < new Date()).length

  return (
    <>
      <div className="bloc-mur">
        <div className="entete-dashboard">
          <h2>Tableau de bord</h2>
          <button className="lien" onClick={() => onAller?.('situation')}>
            Situation
          </button>
        </div>
        <div className="compteurs-carres">
          <Compteur libelle="Postes tenus" v={couverture == null ? '—' : `${couverture} %`} etat={couverture != null && couverture < 100 ? 'attente' : 'ok'} />
          <Compteur libelle="Missions ouvertes" v={m.ouvertes ?? 0} etat={m.p1 ? 'urgent' : 'cours'} />
          <Compteur libelle="Signalements ouverts" v={sig.ouverts ?? 0} etat={sig.non_pris_en_charge ? 'urgent' : 'ok'} />
          <Compteur libelle="Jalons en retard" v={retards} etat={retards ? 'urgent' : 'ok'} />
        </div>

        <div className="grille-paves">
          <div className="pave">
            <div className="pave-titre">Missions</div>
            <span className="grand">{m.ouvertes ?? 0}</span>
            <Detail l="À traiter" v={parStatut.a_traiter ?? 0} />
            <Detail l="Attribuées" v={parStatut.attribuee ?? 0} />
            <Detail l="En cours" v={parStatut.en_cours ?? 0} />
            <Detail l="Non attribuées" v={m.non_attribuees ?? 0} alerte={(m.non_attribuees ?? 0) > 0} />
          </div>
          <div className="pave">
            <div className="pave-titre">Signalements</div>
            <span className="grand">{sig.ouverts ?? 0}</span>
            <Detail l="À prendre en charge" v={sig.non_pris_en_charge ?? 0} alerte={(sig.non_pris_en_charge ?? 0) > 0} />
            <Detail l="Reçus au total" v={sig.total ?? 0} />
          </div>
          <div className="pave">
            <div className="pave-titre">Présence</div>
            <span className="grand">{s.logistique?.jauge ?? 0}</span>
            <Detail l="Attendus" v={evenement.frequentation_max ?? '—'} />
            <Detail l="Transports en cours" v={s.logistique?.transports_ouverts ?? 0} />
            <Detail l="Matériel sous seuil" v={(s.logistique?.sous_seuil ?? []).length} alerte={(s.logistique?.sous_seuil ?? []).length > 0} />
          </div>
          {evenement.modules?.parcours ? (
            <div className="pave">
              <div className="pave-titre">Parcours</div>
              <span className="grand">{s.parcours?.personnes_sur_parcours ?? 0}</span>
              <Detail l="Groupes en route" v={s.parcours?.en_route ?? 0} />
              <Detail l="Arrivés" v={s.parcours?.arrives ?? 0} />
              <Detail l="Sans nouvelles" v={s.parcours?.sans_nouvelles ?? 0} alerte={(s.parcours?.sans_nouvelles ?? 0) > 0} />
            </div>
          ) : (
            <div className="pave">
              <div className="pave-titre">Bénévoles</div>
              <span className="grand">{s.rh?.postes_a_couvrir ?? 0}</span>
              <Detail l="Postes à couvrir" v={s.rh?.postes_a_couvrir ?? 0} alerte={(s.rh?.postes_a_couvrir ?? 0) > 0} />
              <Detail l="Créneaux découverts" v={s.rh?.creneaux_decouverts ?? 0} />
            </div>
          )}
        </div>
      </div>

      <div className="bloc-mur">
        <div className="entete-dashboard">
          <h2>Couverture des postes en cours</h2>
          <button className="lien" onClick={() => onAller?.('rh')}>
            Bénévoles
          </button>
        </div>
        {postes.length === 0 ? (
          <p className="vide">Aucun créneau en cours.</p>
        ) : (
          <table className="apercu">
            <thead>
              <tr>
                <th>Poste</th>
                <th>Effectif</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {postes.map((c) => (
                <tr key={c.creneau_id} className={c.manque > 0 ? 'rejete' : ''}>
                  <td>{c.poste}{c.lieu ? ` · ${c.lieu}` : ''}</td>
                  <td className="mono">{c.confirmes} / {c.besoin}</td>
                  <td>{c.manque > 0 ? `Sous-doté (${c.manque})` : 'Complet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bloc-mur">
        <h2>Charge par domaine</h2>
        <div className="pave">
          <div className="pave-titre">Demandes ouvertes par domaine</div>
          <div className="repartition">
            {DOMAINES.filter(([k]) => parModule[k]).map(([k, l]) => (
              <div className="barre-ligne" key={k}>
                <span className="barre-lib">{l}</span>
                <span className="barre">
                  <span style={{ width: `${(100 * (parModule[k].ouvertes ?? 0)) / maxModule}%` }} />
                </span>
                <span className="mono">{parModule[k].ouvertes ?? 0}</span>
              </div>
            ))}
            {Object.keys(parModule).length === 0 && <p className="vide">Aucune demande ouverte.</p>}
          </div>
        </div>
      </div>
    </>
  )
}

function Compteur({ libelle, v, etat }) {
  return (
    <div className={`compteur-carre etat-${etat}`}>
      <div className="compteur-carre-libelle">{libelle}</div>
      <div className="compteur-carre-valeur">{v}</div>
    </div>
  )
}

function Detail({ l, v, alerte = false }) {
  return (
    <div className={`detail-metrique ${alerte ? 'alerte-texte' : ''}`}>
      <span>{l}</span>
      <strong>{v}</strong>
    </div>
  )
}
