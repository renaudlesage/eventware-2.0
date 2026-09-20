import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { enAttente, surChangement } from './fileEcritures'

/**
 * Le bandeau d'état — ce qu'on regarde toutes les trente secondes.
 *
 * Quatre cadrans sous la tête, sur tous les écrans (refonte du 20/09) :
 * ils ne remplacent pas la Situation, ils disent en un regard si elle
 * mérite d'être ouverte. Deux jeux, selon qu'on encadre ou non :
 *
 *   ENCADREMENT (missions:creer) — signalements ouverts, missions en
 *   cours, retards de jalon, présents. Au mur (≥ 2200 px), quatre de
 *   plus : postes tenus, radios en main, transports en cours, écritures
 *   en attente. Pas de « batteries basses » : rien ne les mesure.
 *
 *   TERRAIN — mes missions, à prendre, fin de mon créneau, signalements
 *   ouverts. Ce sont les quatre questions qu'une personne se pose en
 *   sortant de son poste.
 *
 * Chaque cadran ouvre l'écran qui le détaille. Un cadran « chaud » se
 * signale par sa valeur et une barre, jamais par un aplat (design
 * system, Cadran) — et toujours par un mot, la couleur ne suffit pas.
 */
export default function BandeauEtat({ evenement, membre, peut, toutPouvoir, onAller, palier }) {
  const [s, setS] = useState(null)
  const [terrain, setTerrain] = useState([])
  const [creneau, setCreneau] = useState(null)
  const [retards, setRetards] = useState(null)
  const [mur, setMur] = useState({ postes: null, tenus: null, radios: null })
  const [attente, setAttente] = useState(enAttente().length)

  const encadre = toutPouvoir || peut?.('missions', 'creer')
  const auMur = palier === 'mur' && encadre

  useEffect(() => {
    let vivant = true

    async function charger() {
      const maintenant = new Date().toISOString()
      const appels = [
        supabase.rpc('situation', { p_evenement: evenement.id }),
        supabase
          .from('jalons')
          .select('id', { count: 'exact', head: true })
          .eq('evenement_id', evenement.id)
          .is('deleted_at', null)
          .eq('statut', 'a_venir')
          .lt('echeance', maintenant)
      ]
      if (!encadre) {
        appels.push(
          supabase.rpc('mon_terrain', { p_evenement: evenement.id }),
          supabase
            .from('affectations')
            .select('statut, creneaux(poste, debut, fin)')
            .eq('evenement_id', evenement.id)
            .eq('membre_id', membre.id)
            .in('statut', ['confirme', 'present'])
        )
      }
      if (auMur) {
        appels.push(
          supabase.rpc('couverture_creneaux', { p_evenement: evenement.id, p_depuis: maintenant }),
          supabase
            .from('attributions')
            .select('id', { count: 'exact', head: true })
            .eq('evenement_id', evenement.id)
            .eq('nature', 'radio')
            .is('deleted_at', null)
            .is('rendu_le', null)
        )
      }
      const r = await Promise.all(appels)
      if (!vivant) return
      const [sit, jal] = r
      if (!sit.error) setS(sit.data)
      setRetards(jal.count ?? 0)
      let i = 2
      if (!encadre) {
        const [ter, aff] = [r[i], r[i + 1]]
        i += 2
        setTerrain(ter.data ?? [])
        // Le créneau en cours, sinon le prochain : c'est sa fin qu'on
        // veut, « je tiens jusqu'à 16 h ».
        const now = Date.now()
        const cren = (aff.data ?? [])
          .map((a) => a.creneaux)
          .filter((c) => c && new Date(c.fin).getTime() > now)
          .sort((a, b) => new Date(a.debut) - new Date(b.debut))
        setCreneau(cren[0] ?? null)
      }
      if (auMur) {
        const [couv, rad] = [r[i], r[i + 1]]
        const now = Date.now()
        const enCours = (couv.data ?? []).filter(
          (c) => new Date(c.debut).getTime() <= now && new Date(c.fin).getTime() >= now
        )
        setMur({
          postes: enCours.length,
          tenus: enCours.filter((c) => c.manque === 0).length,
          radios: rad.count ?? 0
        })
      }
    }

    charger()
    const t = setInterval(charger, 30000)
    const desabonner = surChangement(() => setAttente(enAttente().length))
    return () => {
      vivant = false
      clearInterval(t)
      desabonner()
    }
  }, [evenement.id, membre.id, encadre, auMur])

  const sosOuverts = s?.signalements?.ouverts ?? null
  const sosATraiter = s?.signalements?.non_pris_en_charge ?? 0
  const enCours = (s?.missions?.par_statut?.en_cours ?? 0) + (s?.missions?.par_statut?.attribuee ?? 0)

  let cadrans
  if (encadre) {
    cadrans = [
      {
        valeur: sosOuverts,
        libelle: sosATraiter ? `Signalements ouverts · ${sosATraiter} à traiter` : 'Signalements ouverts',
        chaud: sosATraiter > 0,
        aller: ['securite', evenement.modules?.sos_participants ? 'signalements' : 'journal']
      },
      { valeur: s ? enCours : null, libelle: 'Missions en cours', aller: ['securite', 'missions'] },
      {
        valeur: retards,
        libelle: retards ? 'Retards jalon · en retard' : 'Retards jalon',
        chaud: retards > 0,
        aller: ['planning']
      },
      { valeur: s?.logistique?.jauge ?? null, libelle: 'Présents', aller: ['logistique'] }
    ]
    if (auMur) {
      cadrans.push(
        {
          valeur: mur.postes == null ? null : `${mur.tenus} / ${mur.postes}`,
          libelle: mur.postes != null && mur.tenus < mur.postes ? 'Postes tenus · découverts' : 'Postes tenus',
          chaud: mur.postes != null && mur.tenus < mur.postes,
          aller: ['rh']
        },
        { valeur: mur.radios, libelle: 'Radios en main', aller: ['logistique'] },
        { valeur: s?.logistique?.transports_ouverts ?? null, libelle: 'Transports en cours', aller: ['logistique'] },
        {
          valeur: attente,
          libelle: attente ? 'Écritures en attente · hors réseau' : 'Écritures en attente',
          chaud: attente > 0,
          aller: null
        }
      )
    }
  } else {
    const miennes = terrain.filter((l) => l.pour_moi && l.genre !== 'jalon').length
    const aPrendre = terrain.filter((l) => !l.pour_moi && !l.titulaire && l.statut === 'a_traiter').length
    cadrans = [
      { valeur: miennes, libelle: 'Mes missions', aller: ['accueil'] },
      {
        valeur: aPrendre,
        libelle: aPrendre ? 'À prendre · sans titulaire' : 'À prendre',
        chaud: aPrendre > 0,
        aller: ['accueil']
      },
      {
        valeur: creneau
          ? new Date(creneau.fin).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
          : '—',
        libelle: creneau ? `Fin de mon créneau · ${creneau.poste}` : 'Aucun créneau à venir',
        aller: ['rh']
      },
      {
        valeur: sosOuverts,
        libelle: sosATraiter ? 'Signalements ouverts · à traiter' : 'Signalements ouverts',
        chaud: sosATraiter > 0,
        aller: ['securite']
      }
    ]
  }

  return (
    <div className={`etat ${cadrans.length > 4 ? 'etat-mur' : ''}`} role="group" aria-label="État de l'événement">
      {cadrans.map((c) => (
        <button
          key={c.libelle}
          className={`cadran ${c.chaud ? 'chaud' : ''}`}
          onClick={() => c.aller && onAller?.(...c.aller)}
          disabled={!c.aller}
        >
          <span className="cadran-valeur">{c.valeur ?? '…'}</span>
          <span className="cadran-libelle">{c.libelle}</span>
        </button>
      ))}
    </div>
  )
}
