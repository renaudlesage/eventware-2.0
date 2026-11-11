import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { enAttente, surChangement } from './fileEcritures'
import { phaseDeJalon, phasesDatees, LIBELLE_PHASE } from './phases'

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
  const [perime, setPerime] = useState(false)
  const [releve, setReleve] = useState(null)
  const [terrain, setTerrain] = useState([])
  const [creneau, setCreneau] = useState(null)
  const [retards, setRetards] = useState(null)
  const [mur, setMur] = useState({ postes: null, tenus: null, radios: null })
  const [attente, setAttente] = useState(enAttente().length)
  // (1/11, retour de Ren) Ce qui compte dépend de la phase : « 0 présents »
  // en montage n'est pas une information. Les compteurs propres à la
  // phase (jalons sous 7 jours, demandes de prix, objets à confirmer sur
  // site, postes découverts, radios non rendues, constats) vivent ici.
  const [phase, setPhase] = useState({})
  const phaseEv = evenement.phase ?? 'exploitation'
  const precurseur = !!evenement.modules?.precurseur

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
          // (125) Même définition que situation().jalons_en_retard :
          // à venir OU en cours, échéance passée. La requête ne sert
          // plus que de repli si la fonction serveur n'a pas la clé.
          .in('statut', ['a_venir', 'en_cours'])
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
      // Les compteurs de la phase, à part : sans jonglage d'index.
      const extras = []
      const dans7j = new Date(Date.now() + 7 * 86400000).toISOString()
      if (encadre && phaseEv === 'preparation') {
        // (152) Avec les dates de l'événement, on compte les jalons restants
        // de la phase ; sans elles, ceux des sept prochains jours.
        if (phasesDatees(evenement)) {
          extras.push(['jalonsPhase', supabase.from('jalons').select('id, echeance, phase_cible')
            .eq('evenement_id', evenement.id).is('deleted_at', null).in('statut', ['a_venir', 'en_cours'])])
        } else {
          extras.push(['jalons7', supabase.from('jalons').select('id', { count: 'exact', head: true })
            .eq('evenement_id', evenement.id).is('deleted_at', null).in('statut', ['a_venir', 'en_cours']).gte('echeance', maintenant).lte('echeance', dans7j)])
        }
        extras.push(['demandesPrix', supabase.rpc('demandes_prix_vue', { p_evenement: evenement.id })])
      }
      if (encadre && (phaseEv === 'preparation' || phaseEv === 'montage')) {
        extras.push(['couverture', supabase.rpc('couverture_creneaux', { p_evenement: evenement.id, p_depuis: maintenant })])
      }
      if (encadre && phaseEv === 'montage') {
        extras.push(['aConfirmer', supabase.from('elements_plan').select('id', { count: 'exact', head: true })
          .eq('evenement_id', evenement.id).is('deleted_at', null).eq('confirme', false)])
      }
      if (encadre && (phaseEv === 'demontage' || phaseEv === 'cloture')) {
        extras.push(['radios', supabase.from('attributions').select('id', { count: 'exact', head: true })
          .eq('evenement_id', evenement.id).eq('nature', 'radio').is('deleted_at', null).is('rendu_le', null)])
      }
      // (1/11, retour de Ren) La charge des lieux (Précurseur) : combien de
      // lieux sont au niveau 3, prêts à s'ébouler. Dès que le module est
      // ouvert et qu'il y a des demandes : montage, exploitation, démontage.
      if (encadre && precurseur && ['montage', 'exploitation', 'demontage'].includes(phaseEv)) {
        extras.push(['charge', supabase.rpc('prc_synthese', { p_evenement: evenement.id })])
      }
      if (encadre && phaseEv === 'cloture') {
        extras.push(['rex', supabase.from('rex_entrees').select('id', { count: 'exact', head: true }).eq('evenement_id', evenement.id)])
      }
      if (!encadre && (phaseEv === 'preparation' || phaseEv === 'cloture')) {
        extras.push(['prochainJalon', supabase.from('jalons').select('libelle, echeance').eq('evenement_id', evenement.id)
          .is('deleted_at', null).in('statut', ['a_venir', 'en_cours']).gte('echeance', maintenant).order('echeance').limit(1)])
      }
      const [r, ex] = await Promise.all([Promise.all(appels), Promise.all(extras.map(([, q]) => q))])
      if (!vivant) return
      {
        const info = {}
        extras.forEach(([cle], i) => {
          const res = ex[i] ?? {}
          if (cle === 'demandesPrix') {
            const lignes = res.data ?? []
            const ouvertes = lignes.filter((d) => !['decidee', 'close', 'annulee'].includes(d.statut))
            info.dpOuvertes = ouvertes.length
            info.dpRetard = ouvertes.filter((d) => d.en_retard).length
          } else if (cle === 'couverture') {
            const now = Date.now()
            info.postesDecouverts = (res.data ?? []).filter((c) => new Date(c.fin).getTime() >= now && c.manque > 0).length
          } else if (cle === 'jalonsPhase') {
            info.jalonsPhase = (res.data ?? []).filter((j) => phaseDeJalon(evenement, j) === phaseEv).length
          } else if (cle === 'charge') {
            const syn = Array.isArray(res.data) ? res.data[0] : res.data
            info.charge = syn ? { lieux3: syn.lieux_niveau_3 ?? 0, grappes: syn.grappes ?? 0 } : null
          } else if (cle === 'prochainJalon') {
            info.prochainJalon = res.data?.[0] ?? null
          } else {
            info[cle] = res.count ?? (Array.isArray(res.data) ? res.data.length : null)
          }
        })
        setPhase(info)
      }
      const [sit, jal] = r
      // (11/11, audit C3) Un relevé raté ne remet pas les cadrans à zéro : « 0 mission »
      // se lisait « rien à faire ». On garde les chiffres connus et on dit leur heure.
      if (!sit.error) {
        setS(sit.data)
        setRetards(sit.data?.jalons_en_retard ?? jal.count ?? 0)
        setReleve(new Date())
        setPerime(false)
      } else setPerime(true)
      let i = 2
      if (!encadre) {
        const [ter, aff] = [r[i], r[i + 1]]
        i += 2
        if (!ter.error) setTerrain(ter.data ?? [])
        // Le créneau en cours, sinon le prochain : c'est sa fin qu'on
        // veut, « je tiens jusqu'à 16 h ».
        const now = Date.now()
        const cren = (aff.data ?? [])
          .map((a) => a.creneaux)
          .filter((c) => c && new Date(c.fin).getTime() > now)
          .sort((a, b) => new Date(a.debut) - new Date(b.debut))
        if (!aff.error) setCreneau(cren[0] ?? null)
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
  }, [evenement.id, membre.id, encadre, auMur, phaseEv, precurseur])

  const heureReleve = releve ? releve.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : null
  const sosOuverts = s?.signalements?.ouverts ?? null
  const sosATraiter = s?.signalements?.non_pris_en_charge ?? 0
  const enCours = (s?.missions?.par_statut?.en_cours ?? 0) + (s?.missions?.par_statut?.attribuee ?? 0)

  // Les cadrans, un par question ; la phase choisit les quatre qui comptent.
  const cSignalements = {
    valeur: sosOuverts,
    libelle: sosATraiter ? `Signalements ouverts · ${sosATraiter} à traiter` : 'Signalements ouverts',
    chaud: sosATraiter > 0,
    aller: ['securite', evenement.modules?.sos_participants ? 'signalements' : 'journal']
  }
  const cMissions = { valeur: s ? enCours : null, libelle: 'Missions en cours', aller: ['securite', 'missions'] }
  const cRetards = {
    valeur: retards,
    libelle: retards ? 'Retards jalon · en retard' : 'Retards jalon',
    chaud: retards > 0,
    aller: ['planning']
  }
  // Contre la capacité attendue quand elle est connue : « 412 »
  // seul ne dit pas si la plaine est pleine (comparatif BFMF 2026).
  const cPresents = {
    valeur:
      s?.logistique?.jauge == null
        ? null
        : evenement.frequentation_max > 0
          ? `${s.logistique.jauge} / ${evenement.frequentation_max}`
          : s.logistique.jauge,
    libelle:
      evenement.frequentation_max > 0 && s?.logistique?.jauge >= 0.9 * evenement.frequentation_max
        ? 'Présents · ≥ 90 % de la capacité'
        : 'Présents',
    chaud: evenement.frequentation_max > 0 && s?.logistique?.jauge >= 0.9 * evenement.frequentation_max,
    aller: ['logistique']
  }
  const cJalons7 = phasesDatees(evenement)
    ? { valeur: phase.jalonsPhase ?? null, libelle: `Jalons de la phase · ${LIBELLE_PHASE[phaseEv] ?? phaseEv}`, aller: ['planning'] }
    : { valeur: phase.jalons7 ?? null, libelle: 'Jalons sous 7 jours', aller: ['planning'] }
  const cDemandesPrix = {
    valeur: phase.dpOuvertes ?? null,
    libelle: phase.dpRetard ? `Demandes de prix ouvertes · ${phase.dpRetard} en retard` : 'Demandes de prix ouvertes',
    chaud: (phase.dpRetard ?? 0) > 0,
    aller: ['logistique', 'demandes_prix']
  }
  const cPostes = {
    valeur: phase.postesDecouverts ?? null,
    libelle: phase.postesDecouverts ? 'Postes découverts · à pourvoir' : 'Postes découverts',
    chaud: (phase.postesDecouverts ?? 0) > 0,
    aller: ['rh']
  }
  const cAConfirmer = {
    valeur: phase.aConfirmer ?? null,
    libelle: phase.aConfirmer ? 'À confirmer sur site · tournée' : 'À confirmer sur site',
    chaud: (phase.aConfirmer ?? 0) > 0,
    aller: ['plan']
  }
  const cRadios = {
    valeur: phase.radios ?? null,
    libelle: phase.radios ? 'Radios non rendues · à récupérer' : 'Radios non rendues',
    chaud: (phase.radios ?? 0) > 0,
    aller: ['logistique', 'attributions']
  }
  const cRex = { valeur: phase.rex ?? null, libelle: 'Constats REX', aller: ['analyse'] }
  const cCharge = {
    valeur: phase.charge ? phase.charge.lieux3 : null,
    libelle: phase.charge?.lieux3
      ? `Charge des lieux · ${phase.charge.lieux3 > 1 ? 'lieux' : 'lieu'} en surcharge`
      : phase.charge?.grappes ? `Charge des lieux · ${phase.charge.grappes} grappe${phase.charge.grappes > 1 ? 's' : ''}` : 'Charge des lieux · précurseur',
    chaud: (phase.charge?.lieux3 ?? 0) > 0,
    aller: ['precurseur']
  }

  let cadrans
  if (encadre) {
    cadrans = {
      // Préparer : les échéances, ce qu'on attend des fournisseurs, qui manque.
      preparation: [cRetards, cJalons7, cDemandesPrix, cPostes],
      // Monter : le site se construit, les postes se pourvoient, il y a déjà des incidents.
      // Avec le Précurseur ouvert, la charge des lieux prend une place.
      montage: precurseur ? [cRetards, cAConfirmer, cCharge, cPostes] : [cRetards, cAConfirmer, cPostes, cSignalements],
      exploitation: precurseur ? [cSignalements, cMissions, cCharge, cPresents] : [cSignalements, cMissions, cRetards, cPresents],
      // Démonter : ce qui reste ouvert, ce qui doit revenir.
      demontage: precurseur ? [cSignalements, cMissions, cCharge, cRadios] : [cSignalements, cMissions, cRadios, cRetards],
      // Clôturer : solder, et tirer les leçons.
      cloture: [cRex, cMissions, cRadios, cRetards]
    }[phaseEv] ?? [cSignalements, cMissions, cRetards, cPresents]
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
    const horsTerrain = phaseEv === 'preparation' || phaseEv === 'cloture'
    cadrans = [
      { valeur: miennes, libelle: phaseEv === 'preparation' ? 'Mes actions' : 'Mes missions', aller: ['accueil'] },
      {
        valeur: aPrendre,
        libelle: aPrendre ? 'À prendre · sans titulaire' : 'À prendre',
        chaud: aPrendre > 0,
        aller: ['accueil']
      },
      // Hors terrain, « fin de mon créneau » ne dit rien : le prochain jalon, lui, oui.
      horsTerrain
        ? {
            valeur: phase.prochainJalon ? new Date(phase.prochainJalon.echeance).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' }) : '—',
            libelle: phase.prochainJalon ? `Prochain jalon · ${phase.prochainJalon.libelle}` : 'Aucun jalon à venir',
            aller: ['planning']
          }
        : {
            valeur: creneau
              ? new Date(creneau.fin).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
              : '—',
            libelle: creneau ? `Fin de mon créneau · ${creneau.poste}` : 'Aucun créneau à venir',
            aller: ['rh']
          },
      horsTerrain
        ? { valeur: retards, libelle: retards ? 'Retards jalon · en retard' : 'Retards jalon', chaud: retards > 0, aller: ['planning'] }
        : {
            valeur: sosOuverts,
            libelle: sosATraiter ? 'Signalements ouverts · à traiter' : 'Signalements ouverts',
            chaud: sosATraiter > 0,
            aller: ['securite']
          }
    ]
  }

  return (
    <div className={`etat bandeau-etat ${cadrans.length > 4 ? 'etat-mur' : ''} ${perime ? 'perime' : ''}`} role="group" aria-label="État de l'événement">
      {perime && <span className="etat-perime" role="status">Hors réseau{heureReleve ? ` · chiffres de ${heureReleve}` : ''}</span>}
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
