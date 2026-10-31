import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { libelleStatut, ETAPES_TRANSPORT, libelleEtapeTransport } from './libelles'
import { texteErreur } from './erreurs'
import { situerSurTrace, libelleSurTrace } from './geometrie'

/**
 * Mes missions.
 *
 * Remplace quatre écrans de la v18 — équipe volante, chauffeur,
 * balade accompagnateur, tâches sanitaires — qui posaient tous la même
 * question : qu'est-ce qui m'attend, maintenant ?
 *
 * Contraintes de conception : on est debout, en mouvement, souvent
 * d'une seule main. Deux gestes maximum par action.
 */
export default function Terrain({ evenement, membre, embarque = false, onCompteurs }) {
  const [lignes, setLignes] = useState([])
  const [message, setMessage] = useState(null)
  const [filtre, setFiltre] = useState('tout')
  // (123) La trace et les repères, pour dire « km 3,2 · entre E2 et
  // E3 » sous une mission : à pied sur le parcours, c'est ce qui
  // permet d'y aller, pas des coordonnées ni « Y aller » sans réseau.
  const [fond, setFond] = useState(null)

  useEffect(() => {
    let vivant = true
    Promise.all([
      supabase.from('traces').select('nom, points').eq('evenement_id', evenement.id).is('deleted_at', null).eq('actif', true),
      supabase.from('lieux').select('code, nom, pk_km').eq('evenement_id', evenement.id).is('deleted_at', null).eq('actif', true).not('pk_km', 'is', null)
    ]).then(([tr, l]) => {
      if (vivant) setFond({ traces: tr.data ?? [], lieux: l.data ?? [] })
    })
    return () => {
      vivant = false
    }
  }, [evenement.id])

  const surTrace = (l) =>
    fond && l.latitude ? libelleSurTrace(situerSurTrace(fond.traces, fond.lieux, l.latitude, l.longitude)) : ''

  // (125) Le détail des courses : mon_terrain rend une ligne générique
  // (titre, détail, statut) ; le chauffeur a besoin du RDV, du contact à
  // appeler, des adresses, et de dire où il en est. Une seconde requête
  // sur les seules courses de la liste — redéfinir mon_terrain changerait
  // son type de retour, donc exigerait un DROP (règle des migrations).
  const [courses, setCourses] = useState({})

  async function charger() {
    const { data, error } = await supabase.rpc('mon_terrain', {
      p_evenement: evenement.id
    })
    if (error) {
      setMessage({ type: 'erreur', texte: texteErreur(error) })
      return
    }
    setLignes(data ?? [])
    const ids = (data ?? []).filter((l) => l.genre === 'transport').map((l) => l.id)
    if (ids.length) {
      const { data: c } = await supabase
        .from('transports')
        .select('id, etape, contact, souhaite_pour, attendu_le, adresse_depart, adresse_arrivee, volume_materiel, precisions')
        .in('id', ids)
      setCourses(Object.fromEntries((c ?? []).map((x) => [x.id, x])))
    } else setCourses({})
  }

  // (125) L'étape d'une course : en route, chargé, retour, déposé. Un
  // mot à la radio devient un fait horodaté au PC. Partir met aussi la
  // course « en cours » si elle était seulement attribuée — on ne
  // demande pas deux gestes pour dire qu'on démarre.
  async function etape(l, valeur) {
    const champs = { etape: valeur }
    if (l.statut === 'attribuee' || l.statut === 'a_traiter') champs.statut = 'en_cours'
    if (!l.pour_moi) champs.chauffeur_id = membre.id
    const { error, count } = await supabase.from('transports').update(champs, { count: 'exact' }).eq('id', l.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function avancer(l, statut) {
    // Un jalon ne partage pas les statuts d'une mission : il va de
    // « à venir » à « fait », sans passer par « attribuée » ni
    // « résolue ». On traduit plutôt que d'écrire un statut qui
    // n'existe pas dans son énumération.
    if (l.genre === 'jalon') {
      const cible = statut === 'resolue' ? 'fait' : 'en_cours'
      const { error, count } = await supabase
        .from('jalons')
        .update({ statut: cible }, { count: 'exact' })
        .eq('id', l.id)
      if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
      else if (count === 0)
        setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
      else charger()
      return
    }

    const table = l.genre === 'transport' ? 'transports' : 'missions'
    const champs = { statut }
    // Avancer une ligne que personne ne tient, c'est la prendre — quel
    // que soit le bouton. Une mission attribuée à MON ÉQUIPE sans
    // titulaire arrive ici avec « Je démarre » : si l'on ne posait que
    // le statut, la ligne resterait sans titulaire et la policy 105
    // (« la mienne, ou j'encadre ») la refuserait — c'est exactement
    // ce qui s'est passé à la campagne du 20/09. Le PC voit ainsi qui
    // s'en occupe dès le premier geste, ce qui est le but de l'écran.
    if (!l.pour_moi) {
      champs[l.genre === 'transport' ? 'chauffeur_id' : 'membre_id'] = membre.id
    }
    const { error, count } = await supabase
      .from(table)
      .update(champs, { count: 'exact' })
      .eq('id', l.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  const visibles = filtre === 'moi' ? lignes.filter((l) => l.pour_moi) : lignes
  const mesLignes = lignes.filter((l) => l.pour_moi).length
  const p1 = lignes.filter((l) => l.priorite === 'P1').length

  // Embarqué dans un bloc du tableau de bord : les compteurs remontent
  // dans l'en-tête du bloc, calculés ici à partir de la même source —
  // jamais recalculés à côté, pour que l'en-tête et le contenu ne
  // puissent pas se contredire.
  useEffect(() => {
    onCompteurs?.({ aFaire: lignes.length, pourMoi: mesLignes, p1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes.length, mesLignes, p1])

  return (
    <div className={embarque ? '' : 'bloc securite dom-violet'}>
      {!embarque && <h2>Mes missions</h2>}

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {!embarque && (
        <div className="compteurs">
          <span>
            À faire <strong>{lignes.length}</strong>
          </span>
          <span>
            Pour moi <strong>{mesLignes}</strong>
          </span>
          <span className={p1 ? 'alerte-texte' : ''}>
            P1 <strong>{p1}</strong>
          </span>
        </div>
      )}

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['tout', 'Tout'],
          ['moi', 'Pour moi']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
        <button className="discret" onClick={charger}>
          Rafraîchir
        </button>
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Rien ne t'attend pour le moment.</p>
      ) : (
        visibles.map((l) => (
          <div
            className={`carte ${l.priorite === 'P1' ? 'urgent' : ''} ${
              l.pour_moi ? 'a-moi' : ''
            }`}
            key={l.id}
          >
            <div className="titre">
              <span className={`jeton prio-${l.priorite}`}>{l.priorite}</span> {l.titre}
              {/* (31/10) La référence sert à la radio : elle reste, mais après le titre. */}
              <span className="code-discret">{l.reference}</span>
            </div>
            {l.detail && <p style={{ margin: '4px 0' }}>{l.detail}</p>}
            <div className="meta">
              <span>{l.genre}</span>
              <span>{libelleStatut(l.statut)}</span>
              {l.pour_moi && <span className="jeton">à moi</span>}
              {/* Tenue par un collègue de l'équipe : on le dit, et
                  aucun bouton ne s'affiche plus bas — la policy
                  refuserait de toute façon, autant ne pas proposer. */}
              {!l.pour_moi && l.titulaire && <span>pris par {l.titulaire}</span>}
              {surTrace(l) && <span className="sur-trace">{surTrace(l)}</span>}
              {l.genre === 'transport' && courses[l.id]?.etape && (
                <span className={`jeton etape-${courses[l.id].etape}`}>{libelleEtapeTransport(courses[l.id].etape)}</span>
              )}
              {l.latitude && (
                <a
                  className="lien-externe"
                  href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Y aller
                </a>
              )}
            </div>

            {l.genre === 'transport' && courses[l.id] && (
              <DetailCourse c={courses[l.id]} />
            )}

            {/* (125) Les quatre temps d'une course, pour le chauffeur.
                Le dernier, « Déposé », n'est pas « Terminé » : il reste
                à rentrer, et c'est le PC qui clôt. */}
            {l.genre === 'transport' && (l.pour_moi || !l.titulaire) && l.statut !== 'resolue' && (
              <div className="ligne-boutons etapes-course" style={{ marginTop: 8 }}>
                {ETAPES_TRANSPORT.map(([v, lib]) => (
                  <button
                    key={v}
                    className={courses[l.id]?.etape === v ? '' : 'discret'}
                    disabled={courses[l.id]?.etape === v}
                    onClick={() => etape(l, v)}
                  >
                    {lib}
                  </button>
                ))}
              </div>
            )}

            {(l.pour_moi || !l.titulaire) && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                {l.statut === 'a_traiter' && (
                  <button onClick={() => avancer(l, 'attribuee')}>Je prends</button>
                )}
                {/* Un jalon arrive déjà attribué : on ne « le prend » pas,
                    on le démarre. Sans cette branche il n'aurait aucun
                    bouton, son statut « a_venir » n'étant prévu nulle part. */}
                {l.statut === 'a_venir' && (
                  <button onClick={() => avancer(l, 'en_cours')}>Je démarre</button>
                )}
                {l.statut === 'attribuee' && (
                  <button onClick={() => avancer(l, 'en_cours')}>
                    {l.pour_moi ? 'Je démarre' : 'Je prends et je démarre'}
                  </button>
                )}
                {l.statut === 'en_cours' && (
                  <button onClick={() => avancer(l, 'resolue')}>Terminé</button>
                )}
              </div>
            )}
          </div>
        ))
      )}

      <p className="aide">
        « Je prends » t'attribue la tâche : le PC voit aussitôt qui s'en occupe, et personne
        n'y va à deux. C'est ce qui manquait au circuit jetons de 2026.
      </p>
    </div>
  )
}


/* (125) Ce qu'un chauffeur doit avoir sous les yeux : le RDV, qui
   appeler, où aller — en un clic chacun. */
function DetailCourse({ c }) {
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
  const maps = (adresse) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresse)}`
  if (!c.souhaite_pour && !c.attendu_le && !c.contact && !c.adresse_depart && !c.adresse_arrivee && !c.precisions) return null
  return (
    <div className="meta detail-course">
      {c.souhaite_pour && <span>RDV {heure(c.souhaite_pour)}</span>}
      {c.attendu_le && <span>attendu {heure(c.attendu_le)}</span>}
      {c.contact && (
        <a className="lien-externe" href={`tel:${c.contact.replace(/\s/g, '')}`}>
          appeler {c.contact}
        </a>
      )}
      {c.adresse_depart && (
        <a className="lien-externe" href={maps(c.adresse_depart)} target="_blank" rel="noreferrer">
          départ : {c.adresse_depart}
        </a>
      )}
      {c.adresse_arrivee && (
        <a className="lien-externe" href={maps(c.adresse_arrivee)} target="_blank" rel="noreferrer">
          arrivée : {c.adresse_arrivee}
        </a>
      )}
      {c.volume_materiel && c.volume_materiel !== 'aucun' && <span>matériel : {c.volume_materiel}</span>}
      {c.precisions && <span>{c.precisions}</span>}
    </div>
  )
}
