import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Meteo from './Meteo'

/**
 * La colonne de veille — à partir de 1440 px (refonte du 20/09).
 *
 * C'est le gain réel du palier : le coordinateur cesse de faire
 * l'aller-retour entre son module et le journal. Dans cet ordre, parce
 * que c'est l'ordre d'urgence : les bandeaux d'alerte en cours, le
 * journal en direct (onze lignes), la veille météo en vue compacte —
 * la vue faite pour 380 px, jamais les bandes horaires qui s'écrasent
 * — et, au mur (≥ 2200 px), le moniteur radio.
 *
 * Elle ne remplace aucun écran : tout ce qu'elle montre a son écran
 * complet ailleurs, et elle n'offre aucune commande. Elle lit.
 */
const LIBELLE_MODULE = {
  securite: 'Sécurité',
  logistique: 'Logistique',
  parcours: 'Parcours',
  rh: 'Bénévoles',
  meteo: 'Météo',
  noyau: 'Système',
  sos: 'SOS',
  preparation: 'Préparation',
  analyse: 'Analyse'
}

export default function Veille({ evenement, peut, toutPouvoir, palier, onAller }) {
  const [alertes, setAlertes] = useState([])
  const [journal, setJournal] = useState(null)
  const [radio, setRadio] = useState(null)

  const auMur = palier === 'mur'

  useEffect(() => {
    let vivant = true
    async function charger() {
      const appels = [
        supabase
          .from('alertes')
          .select('id, niveau, titre, message, consigne, emise_le')
          .eq('evenement_id', evenement.id)
          .eq('active', true)
          .order('emise_le', { ascending: false }),
        supabase
          .from('journal')
          .select('id, horodatage, texte, importance, source, module')
          .eq('evenement_id', evenement.id)
          .order('horodatage', { ascending: false })
          .limit(11)
      ]
      if (auMur) {
        appels.push(
          supabase
            .from('canaux_radio')
            .select('id, numero, libelle, usage_prevu')
            .eq('evenement_id', evenement.id)
            .is('deleted_at', null)
            .order('ordre'),
          supabase
            .from('attributions')
            .select('id, code, canal_id')
            .eq('evenement_id', evenement.id)
            .eq('nature', 'radio')
            .is('deleted_at', null)
            .is('rendu_le', null)
        )
      }
      const r = await Promise.all(appels)
      if (!vivant) return
      setAlertes(r[0].data ?? [])
      setJournal(r[1].data ?? [])
      if (auMur) setRadio({ canaux: r[2].data ?? [], postes: r[3].data ?? [] })
    }
    charger()
    const t = setInterval(charger, 15000)
    return () => {
      vivant = false
      clearInterval(t)
    }
  }, [evenement.id, auMur])

  return (
    <>
      {alertes.length > 0 && (
        <div className="bandeaux">
          {alertes.map((a) => (
            <div className={`bandeau-alerte niv-${a.niveau}`} key={a.id}>
              <div className="niv">{a.niveau}</div>
              <div className="contenu">
                <strong>{a.titre}</strong>
                {a.message && <div className="msg">{a.message}</div>}
                {a.consigne && <div className="consigne">→ {a.consigne}</div>}
                <div className="meta">
                  <span>
                    {new Date(a.emise_le).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="entete-dashboard">
          <h2>Journal en direct</h2>
          <button className="lien" onClick={() => onAller?.('securite', 'journal')}>
            Main courante
          </button>
        </div>
        {journal === null ? (
          <p className="vide">…</p>
        ) : journal.length === 0 ? (
          <p className="vide">Rien au journal pour l'instant.</p>
        ) : (
          <ul className="chrono">
            {journal.map((l) => (
              <li key={l.id} className={`imp-${l.importance} src-${l.source}`}>
                <span className="heure mono">
                  {new Date(l.horodatage).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="corps">
                  {l.texte}
                  {l.module && <span className="tag">{LIBELLE_MODULE[l.module] ?? l.module}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* La vue compacte, celle de l'écran Situation : les bandes
          horaires (24 colonnes) sont illisibles dans 380 px. */}
      <Meteo evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} compact autoJournal={false} />

      {auMur && radio && (
        <div>
          <div className="entete-dashboard">
            <h2>Radio</h2>
            <button className="lien" onClick={() => onAller?.('logistique')}>
              Logistique
            </button>
          </div>
          {radio.canaux.length === 0 ? (
            <p className="vide">Aucun canal déclaré.</p>
          ) : (
            <table className="apercu">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Usage</th>
                  <th>Postes</th>
                </tr>
              </thead>
              <tbody>
                {radio.canaux.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.numero} · {c.libelle}</td>
                    <td>{c.usage_prevu ?? '—'}</td>
                    <td className="mono">{radio.postes.filter((p) => p.canal_id === c.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="aide">
            {radio.postes.length} poste(s) radio en main.
          </p>
        </div>
      )}
    </>
  )
}
