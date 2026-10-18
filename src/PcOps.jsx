import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { CarteTactique, useTactique } from './ColonneSituation'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'
import { jouerAlarme } from './alarme'
import { situerSurTrace, libelleSurTrace } from './geometrie'
import { nouvelleCle } from './reessai'

/**
 * PC-OPS — les signalements des participants, sur carte et en liste.
 *
 * Lot 1 du comparatif BFMF 2026 (17/10) : l'écran n'affichait ni qui
 * traite, ni les délais, ni le lieu, ni la gravité — pourtant tous en
 * base depuis la 006 — et un SOS y arrivait en silence. Il montre
 * maintenant le cycle horodaté (reçu → pris en charge → clos, avec le
 * nom du traitant et les délais), le lieu nommé, la gravité, l'heure
 * du dernier relevé, et sonne sur un nouveau SOS si l'opérateur a
 * activé le son. Le bouton « → Demande » appelle enfin
 * convertir_signalement_en_mission, qui dormait depuis la 012.
 *
 * Lot 3 (123) : chaque position est dite comme à la radio — « km 3,2 ·
 * entre E2 et E3 · 40 m de la trace » ; un SOS reçu par radio se saisit
 * ici (nature, lieu du dispositif, gravité) sans passer par le lien
 * participant ; les doublons sanitaires (même lieu, même nature) sont
 * repliés sur l'original avec leur nombre, et les lieux qui reviennent
 * sont listés sous la carte.
 */

export const TYPES = {
  malaise: 'Malaise',
  blessure: 'Blessure',
  danger: 'Danger',
  materiel: 'Matériel',
  egare: 'Égaré',
  autre: 'Autre'
}

const STATUTS = [
  ['recu', 'Reçu'],
  ['pris_en_charge', 'Pris en charge'],
  ['en_cours', 'En cours'],
  ['clos', 'Clôturé'],
  ['sans_suite', 'Sans suite']
]

export const GRAVITES = [
  ['mineur', 'Mineur'],
  ['modere', 'Modéré'],
  ['grave', 'Grave'],
  ['critique', 'Critique']
]

const PRIORITES = ['P1', 'P2', 'P3']

// Au-delà, la liste a l'air vivante alors qu'elle ne l'est plus : le
// relevé passe en rouge. Trois cycles de rafraîchissement. (Retirée par
// erreur avec l'ancienne carte au lot 2 — PC-OPS plantait au rendu.)
const RELEVE_PERIME_MS = 30000

export default function PcOps({ evenement, peut, toutPouvoir }) {
  const [signalements, setSignalements] = useState([])
  const [demandes, setDemandes] = useState({}) // signalement_id → demande créée
  const [membres, setMembres] = useState({}) // user_id → nom affiché
  const [lieux, setLieux] = useState({}) // lieu_id → nom
  const [equipes, setEquipes] = useState([])
  const [erreur, setErreur] = useState(null)
  const [retour, setRetour] = useState(null)
  const [masquerClos, setMasquerClos] = useState(true)
  const [maj, setMaj] = useState(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [sonActif, setSonActif] = useState(false)
  // Conversion en demande : le signalement en cours de conversion et
  // ce qu'on a choisi pour lui (priorité, équipe).
  const [conversion, setConversion] = useState(null)
  const minuteur = useRef(null)
  const recusAvantRef = useRef(null)

  // Sans ces droits, le select de statut et le bouton de conversion
  // n'ont aucune chance d'aboutir : autant ne pas les montrer.
  // (lot 2) La carte tactique de la colonne Situation, ici aussi : la
  // trace, le dispositif de secours, les étapes, les missions urgentes et
  // les Mayday sous les signalements — et une carte même sans
  // signalement, au lieu d'un écran vide. Les signalements affichés
  // sont ceux de la liste (clôturés masqués ou non).
  const tactique = useTactique(evenement)

  const peutSos = toutPouvoir || peut?.('sos', 'modifier')
  const peutCreer = toutPouvoir || peut?.('sos', 'creer')
  const [saisieRadio, setSaisieRadio] = useState(false)
  // La conversion crée une demande ET passe le signalement en pris en
  // charge : il faut les deux droits, sinon la RPC échoue à mi-chemin.
  const peutDemande = toutPouvoir || (peut?.('missions', 'creer') && peut?.('sos', 'modifier'))

  async function charger() {
    const [sig, dem] = await Promise.all([
      supabase
        .from('signalements')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('recu_le', { ascending: false }),
      // Les demandes nées d'un signalement : pour dire « → demande
      // SEC-012 · en cours » plutôt que de proposer une deuxième
      // conversion.
      supabase
        .from('missions')
        .select('id, reference, statut, signalement_id')
        .eq('evenement_id', evenement.id)
        .not('signalement_id', 'is', null)
        .is('deleted_at', null)
    ])
    if (sig.error) {
      setErreur(texteErreur(sig.error))
      return
    }
    const lignes = sig.data ?? []
    // Alarme : seulement si le nombre de signalements encore « reçus »
    // (pas pris en charge) vient de MONTER. Une prise en charge le fait
    // baisser et ne sonne pas.
    const recus = lignes.filter((s) => s.statut === 'recu').length
    if (sonActif && recusAvantRef.current != null && recus > recusAvantRef.current) jouerAlarme()
    recusAvantRef.current = recus

    setSignalements(lignes)
    if (!dem.error) {
      setDemandes(Object.fromEntries((dem.data ?? []).map((d) => [d.signalement_id, d])))
    }
    setMaj(Date.now())
    setErreur(null)
  }

  // Référentiels : chargés une fois — un nom de lieu ou de traitant ne
  // change pas toutes les dix secondes.
  async function chargerReferentiels() {
    const [m, l, e] = await Promise.all([
      supabase.from('membres_evenement').select('user_id, nom_affiche').eq('evenement_id', evenement.id),
      supabase.from('lieux').select('id, nom').eq('evenement_id', evenement.id).is('deleted_at', null),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null).order('code')
    ])
    setMembres(Object.fromEntries((m.data ?? []).map((x) => [x.user_id, x.nom_affiche])))
    setLieux(Object.fromEntries((l.data ?? []).map((x) => [x.id, x.nom])))
    setEquipes(e.data ?? [])
  }

  useEffect(() => {
    chargerReferentiels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  useEffect(() => {
    charger()
    minuteur.current = setInterval(charger, 10000)
    return () => clearInterval(minuteur.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id, sonActif])

  // L'horloge qui juge la fraîcheur du relevé.
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  async function modifier(id, champs, libelle) {
    const refus = await modifierOuRefuser('signalements', champs, { id })
    if (refus) setErreur(refus)
    else {
      if (libelle) setRetour({ type: 'ok', texte: libelle })
      charger()
    }
  }

  async function convertir() {
    const { signalement: s, priorite, equipe } = conversion
    const { data, error } = await supabase.rpc('convertir_signalement_en_mission', {
      p_signalement: s.id,
      p_module: 'securite',
      p_priorite: priorite,
      p_equipe: equipe || null
    })
    if (error) {
      setRetour({ type: 'erreur', texte: `${s.reference} : ${texteErreur(error)}` })
      return
    }
    setConversion(null)
    setRetour({
      type: 'ok',
      texte: `${s.reference} → demande ${data?.reference ?? ''} créée${equipe ? ', attribuée' : ''} ; signalement pris en charge.`
    })
    charger()
  }

  // (123) Un doublon n'est pas une ligne de plus : il est compté sur
  // son original, et ne sonne pas — il n'est jamais « reçu » à traiter.
  const doublons = {}
  for (const s of signalements) if (s.doublon_de) doublons[s.doublon_de] = (doublons[s.doublon_de] ?? 0) + 1
  const originaux = signalements.filter((s) => !s.doublon_de)

  const visibles = masquerClos
    ? originaux.filter((s) => !['clos', 'sans_suite'].includes(s.statut))
    : originaux

  const ouverts = originaux.filter((s) =>
    ['recu', 'pris_en_charge', 'en_cours'].includes(s.statut)
  ).length

  // (123) Où, sur le parcours : la position du signalement, ou celle
  // de son lieu, projetée sur la trace. Vide sans trace.
  function surTrace(s) {
    if (!tactique.fond) return ''
    const l = s.lieu_id ? tactique.lieux[s.lieu_id] : null
    return libelleSurTrace(
      situerSurTrace(tactique.fond.traces, tactique.fond.lieux, s.latitude ?? l?.latitude, s.longitude ?? l?.longitude)
    )
  }

  // (123) Les lieux qui reviennent : signalements ouverts (doublons
  // compris) des deux dernières heures, par lieu. Trois « matériel »
  // au même bloc sanitaire, c'est un bloc à aller voir, pas trois SOS.
  const depuis = maintenant - 2 * 3600000
  const parLieu = {}
  for (const s of signalements) {
    if (!s.lieu_id || !['recu', 'pris_en_charge', 'en_cours'].includes(s.statut)) continue
    if (new Date(s.emis_le ?? s.recu_le) < depuis) continue
    parLieu[s.lieu_id] = (parLieu[s.lieu_id] ?? 0) + 1
  }
  const pointsChauds = Object.entries(parLieu)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const lienParticipant = `${window.location.origin}${window.location.pathname}?sos=${evenement.jeton_public}`
  const relevePerime = maj != null && maintenant - maj > RELEVE_PERIME_MS

  return (
    <div className="pcops dom-orange">
      <div className="entete-dashboard">
        <h2>
          Signalements participants
          {ouverts > 0 && <span className="jeton alerte-jeton">{ouverts} ouvert(s)</span>}
        </h2>
        <div className="ligne-boutons" style={{ marginBottom: 0 }}>
          {peutCreer && (
            <button className={saisieRadio ? '' : 'discret'} onClick={() => setSaisieRadio(!saisieRadio)}
              title="Saisir un SOS reçu par radio ou par téléphone, sans passer par le lien participant">
              + SOS radio
            </button>
          )}
          <button
            className={sonActif ? '' : 'discret'}
            onClick={() => setSonActif(!sonActif)}
            title="Alarme sonore à chaque nouveau signalement reçu"
          >
            {sonActif ? '🔔 Son ON' : '🔕 Son OFF'}
          </button>
          <span className={`compte releve ${relevePerime ? 'perime' : ''}`} title="heure du dernier relevé">
            {maj
              ? `relevé ${new Date(maj).toLocaleTimeString('fr-BE')}${relevePerime ? ' · périmé' : ''}`
              : 'relevé en attente'}
          </span>
        </div>
      </div>

      {erreur && <div className="message erreur">{erreur}</div>}
      {retour && (
        <div className={`message ${retour.type === 'erreur' ? 'erreur' : ''}`} role="status">
          {retour.texte}
          <button className="lien" style={{ marginLeft: 10 }} onClick={() => setRetour(null)}>
            OK
          </button>
        </div>
      )}

      <p className="aide">
        Lien à diffuser aux participants (QR code, affichage, dossard) :<br />
        <span className="identifiant">{lienParticipant}</span>
      </p>

      {saisieRadio && (
        <FormSosRadio
          evenement={evenement}
          lieux={tactique.fond?.lieux ?? []}
          onFait={(texte) => {
            setSaisieRadio(false)
            setRetour({ type: 'ok', texte })
            charger()
          }}
          onAnnuler={() => setSaisieRadio(false)}
        />
      )}

      {!tactique.fond ? (
        <p className="vide">Chargement de la carte…</p>
      ) : (
        <CarteTactique
          evenement={evenement}
          fond={tactique.fond}
          vif={{ ...(tactique.vif ?? { missions: [], maydays: [], groupes: [] }), signalements: visibles }}
          lieux={tactique.lieux}
          hauteur={380}
        />
      )}

      {pointsChauds.length > 0 && (
        <p className="aide points-chauds">
          <strong>Lieux qui reviennent (2 h)</strong> :{' '}
          {pointsChauds.map(([id, n], i) => (
            <span key={id}>
              {i > 0 && ' · '}
              {lieux[id] ?? 'lieu'} <span className="mono">×{n}</span>
            </span>
          ))}
        </p>
      )}

      <div className="ligne-boutons" style={{ margin: '12px 0' }}>
        <button className="discret" onClick={() => setMasquerClos(!masquerClos)}>
          {masquerClos ? 'Afficher les clôturés' : 'Masquer les clôturés'}
        </button>
        <button className="discret" onClick={charger}>
          Rafraîchir
        </button>
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucun signalement en cours.</p>
      ) : (
        visibles.map((s) => {
          const demande = demandes[s.id]
          const enConversion = conversion?.signalement.id === s.id
          return (
            <div className={`carte ${s.statut === 'recu' ? 'urgent' : ''}`} key={s.id}>
              <div className="titre">
                <span className="mono">{s.reference}</span> — {TYPES[s.type] ?? s.type}
                {s.gravite && <span className={`jeton grav-${s.gravite}`}>{libelleGravite(s.gravite)}</span>}
                {doublons[s.id] > 0 && (
                  <span className="jeton" title="signalements de même nature au même lieu, repliés sur celui-ci">
                    ×{doublons[s.id] + 1} signalés
                  </span>
                )}
              </div>
              {s.description && <p style={{ margin: '4px 0' }}>{s.description}</p>}
              <div className="meta">
                {s.emis_le && ecartFile(s) > 1 && (
                  <span title="temps passé en file d'attente hors réseau">
                    émis {ecartFile(s)} min plus tôt
                  </span>
                )}
                {s.contact && (
                  <a href={`tel:${s.contact.replace(/\s/g, '')}`} className="lien-externe">
                    {s.contact}
                  </a>
                )}
                {s.lieu_id && lieux[s.lieu_id] && <span>{lieux[s.lieu_id]}</span>}
                {s.latitude ? (
                  <span>
                    {s.latitude.toFixed(5)} · {s.longitude.toFixed(5)} (±
                    {Math.round(s.precision_m ?? 0)} m)
                  </span>
                ) : (
                  !s.lieu_id && <span>sans position</span>
                )}
                {surTrace(s) && <span className="sur-trace">{surTrace(s)}</span>}
              </div>
              {/* Le cycle, tel qu'il s'est réellement passé : les
                  horodatages sont posés par le déclencheur
                  statut_signalement, le traitant est auth.uid() au
                  dernier changement de statut. */}
              <div className="cycle mono">
                <span>reçu {hms(s.recu_le)}</span>
                {s.pris_en_charge_le && (
                  <span>
                    · pris en charge {hm(s.pris_en_charge_le)} (+{delai(s.recu_le, s.pris_en_charge_le)})
                    {s.traite_par && membres[s.traite_par] ? ` par ${membres[s.traite_par]}` : ''}
                  </span>
                )}
                {s.en_route_le && <span>· moyen en route {hm(s.en_route_le)}</span>}
                {s.arrive_le && <span>· sur place {hm(s.arrive_le)} (+{delai(s.recu_le, s.arrive_le)})</span>}
                {s.clos_le && (
                  <span>· {s.statut === 'sans_suite' ? 'sans suite' : 'clos'} {hm(s.clos_le)} (+{delai(s.recu_le, s.clos_le)})</span>
                )}
                {!s.pris_en_charge_le && !s.clos_le && s.statut === 'recu' && (
                  <span className="attente">· en attente depuis {delai(s.recu_le, maintenant)}</span>
                )}
                {demande && (
                  <span>
                    · demande <strong>{demande.reference}</strong>
                  </span>
                )}
              </div>
              {s.commentaire && <p className="aide" style={{ margin: '4px 0' }}>{s.commentaire}</p>}
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                {peutSos ? (
                  <>
                    {/* (122) Le cycle en boutons successifs, comme la
                        volante de BFMF : chaque geste est un fait
                        horodaté, pas un choix dans une liste. */}
                    {s.statut === 'recu' && (
                      <button onClick={() => modifier(s.id, { statut: 'pris_en_charge' }, `${s.reference} pris en charge`)}>
                        Prendre en charge
                      </button>
                    )}
                    {s.statut === 'pris_en_charge' && !s.en_route_le && (
                      <button onClick={() => modifier(s.id, { en_route_le: new Date().toISOString() }, `${s.reference} : moyen en route`)}>
                        Moyen en route
                      </button>
                    )}
                    {s.statut === 'pris_en_charge' && s.en_route_le && (
                      <button onClick={() => modifier(s.id, { statut: 'en_cours' }, `${s.reference} : sur place`)}>
                        Sur place
                      </button>
                    )}
                    {!['clos', 'sans_suite'].includes(s.statut) && (
                      <>
                        <button className="discret cloturer" onClick={() => modifier(s.id, { statut: 'clos' }, `${s.reference} clôturé`)}>
                          Clôturer
                        </button>
                        <button className="discret" onClick={() => modifier(s.id, { statut: 'sans_suite' }, `${s.reference} classé sans suite`)}>
                          Sans suite
                        </button>
                      </>
                    )}
                    {['clos', 'sans_suite'].includes(s.statut) && (
                      <button className="discret" onClick={() => modifier(s.id, { statut: 'pris_en_charge' }, `${s.reference} rouvert`)}>
                        Rouvrir
                      </button>
                    )}
                    <select
                      value={s.gravite ?? ''}
                      onChange={(e) => modifier(s.id, { gravite: e.target.value || null })}
                      style={{ width: 'auto', marginBottom: 0 }}
                      aria-label="Gravité"
                    >
                      <option value="">— gravité —</option>
                      {GRAVITES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="jeton">{STATUTS.find(([v]) => v === s.statut)?.[1] ?? s.statut}</span>
                )}
                {peutDemande && !demande && !enConversion && !['clos', 'sans_suite'].includes(s.statut) && (
                  <button
                    className="discret"
                    onClick={() => setConversion({ signalement: s, priorite: 'P2', equipe: '' })}
                    title="Créer une demande sécurité à partir de ce signalement et le passer en pris en charge"
                  >
                    → Demande
                  </button>
                )}
                {s.latitude && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Itinéraire
                  </a>
                )}
              </div>
              {enConversion && (
                <div className="ligne-boutons conversion" style={{ marginTop: 8 }}>
                  <select
                    value={conversion.priorite}
                    onChange={(e) => setConversion({ ...conversion, priorite: e.target.value })}
                    style={{ width: 'auto', marginBottom: 0 }}
                    aria-label="Priorité de la demande"
                  >
                    {PRIORITES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={conversion.equipe}
                    onChange={(e) => setConversion({ ...conversion, equipe: e.target.value })}
                    style={{ width: 'auto', marginBottom: 0 }}
                    aria-label="Équipe"
                  >
                    <option value="">— équipe (plus tard) —</option>
                    {equipes.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.code} · {eq.nom}
                      </option>
                    ))}
                  </select>
                  <button onClick={convertir}>Créer la demande</button>
                  <button className="discret" onClick={() => setConversion(null)}>
                    Annuler
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

/**
 * (123) Un SOS reçu par radio ou par téléphone, saisi au PC : BFMF
 * avait son « SOS radio » avec la liste des postes ; ici il fallait
 * ouvrir le lien participant sur son propre téléphone. Le lieu du
 * dispositif donne la position ; la référence RAD- dit d'où ça vient.
 */
function FormSosRadio({ evenement, lieux, onFait, onAnnuler }) {
  const [type, setType] = useState('malaise')
  const [lieuId, setLieuId] = useState('')
  const [gravite, setGravite] = useState('')
  const [description, setDescription] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [cle] = useState(nouvelleCle)

  const tries = [...lieux].sort((a, b) => (a.pk_km ?? 1e9) - (b.pk_km ?? 1e9) || (a.nom ?? '').localeCompare(b.nom ?? ''))

  async function envoyer() {
    if (!description.trim() && !lieuId) return
    setOccupe(true)
    setErreur(null)
    const lieu = lieux.find((l) => l.id === lieuId)
    const reference = 'RAD-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const { error } = await supabase.from('signalements').insert({
      evenement_id: evenement.id,
      reference,
      cle_client: cle,
      type,
      gravite: gravite || null,
      description: description.trim() || null,
      lieu_id: lieuId || null,
      latitude: lieu?.latitude ?? null,
      longitude: lieu?.longitude ?? null,
      emis_le: new Date().toISOString()
    })
    const dejaRecu = error?.code === '23505' && /cle_client/.test(error.message ?? '')
    if (error && !dejaRecu) setErreur(texteErreur(error))
    else onFait(`${reference} enregistré${lieu ? ` à ${lieu.nom}` : ''}.`)
    setOccupe(false)
  }

  return (
    <div className="carte saisie-radio">
      <div className="titre">SOS reçu par radio / téléphone</div>
      {erreur && <div className="message erreur">{erreur}</div>}
      <div className="ligne-boutons" style={{ marginTop: 8 }}>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto', marginBottom: 0 }} aria-label="Nature">
          {Object.entries(TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={lieuId} onChange={(e) => setLieuId(e.target.value)} style={{ width: 'auto', marginBottom: 0 }} aria-label="Lieu">
          <option value="">— lieu du dispositif —</option>
          {tries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.pk_km != null ? `km ${Number(l.pk_km).toFixed(1)} · ` : ''}
              {l.code ? `${l.code} · ` : ''}
              {l.nom}
            </option>
          ))}
        </select>
        <select value={gravite} onChange={(e) => setGravite(e.target.value)} style={{ width: 'auto', marginBottom: 0 }} aria-label="Gravité">
          <option value="">— gravité —</option>
          {GRAVITES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <input
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Ce qui a été annoncé — qui, quoi, où si pas de lieu"
        style={{ marginTop: 8 }}
      />
      <div className="ligne-boutons">
        <button disabled={occupe || (!description.trim() && !lieuId)} onClick={envoyer}>
          Enregistrer le SOS
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}

export function libelleGravite(g) {
  return GRAVITES.find(([v]) => v === g)?.[1] ?? g
}

function ecartFile(s) {
  return Math.round((new Date(s.recu_le) - new Date(s.emis_le)) / 60000)
}

function hms(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE')
}

function hm(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

/** Délai lisible entre deux instants : « 4 min », « 1 h 12 ». */
function delai(depuis, jusqua) {
  const min = Math.max(0, Math.round((new Date(jusqua) - new Date(depuis)) / 60000))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}
