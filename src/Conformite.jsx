import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/*
 * Conformité et contrôles préalables.
 *
 * Deux couches distinctes, qui ne doivent jamais se mélanger :
 *
 *   LE QUESTIONNAIRE répond aux critères qui rendent une exigence
 *   applicable — quelles structures, quelles activités sont présentes
 *   sur CET événement. Le bilan qui en sort ne se stocke jamais : il se
 *   recalcule à chaque lecture, pour ne jamais afficher une conformité
 *   périmée après une modification du référentiel ou des réponses.
 *
 *   LA CHECK-LIST est un contrôle daté, sur le terrain, avant une
 *   ouverture précise. Elle se fige au moment où elle démarre — copie
 *   des points fixes, plus les exigences légales déclenchées par le
 *   questionnaire À CET INSTANT. Modifier le questionnaire après coup
 *   ne change jamais une session déjà en cours ou terminée.
 */

// Libellés connus pour les critères déjà rencontrés — un critère ajouté
// par une organisation via un référentiel local qui n'a pas encore son
// libellé ici s'affiche avec un nom dérivé de sa clé, pas absent.
const LIBELLES_CONNUS = {
  'structure.chapiteau': 'Chapiteau(x)',
  'structure.chapiteau_cuisine': 'Chapiteau cuisine distinct du public',
  'structure.podium': 'Podium / structure portante',
  'structure.tribune': 'Tribune ou gradins',
  'structure.gonflable': 'Structure gonflable',
  'activite.balade': 'Balade / marche / randonnée',
  'activite.camping': 'Camping provisoire',
  'activite.pyrotechnie': 'Effets pyrotechniques / feu',
  'activite.effets_speciaux': 'Brouillard, mousse ou stroboscope'
}

function libelleCritere(cle) {
  if (LIBELLES_CONNUS[cle]) return LIBELLES_CONNUS[cle]
  const [, critere] = cle.split('.')
  return (critere ?? cle).replaceAll('_', ' ')
}

export default function Conformite({ evenement, exploitant, setMessage }) {
  const [vue, setVue] = useState('questionnaire')

  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['questionnaire', 'Questionnaire'],
          ['bilan', 'Bilan'],
          ['referentiels', 'Référentiels'],
          ['controles', 'Contrôles']
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

      {vue === 'questionnaire' && (
        <Questionnaire evenement={evenement} setMessage={setMessage} />
      )}
      {vue === 'bilan' && <Bilan evenement={evenement} setMessage={setMessage} />}
      {vue === 'referentiels' && (
        <Referentiels evenement={evenement} exploitant={exploitant} setMessage={setMessage} />
      )}
      {vue === 'controles' && <Controles evenement={evenement} setMessage={setMessage} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Questionnaire                                                       */
/* ------------------------------------------------------------------ */

function Questionnaire({ evenement, setMessage }) {
  const [reponses, setReponses] = useState({})
  const [criteres, setCriteres] = useState([])
  const [enregistre, setEnregistre] = useState(false)

  async function charger() {
    const [r, i] = await Promise.all([
      supabase
        .from('conformite_reponses')
        .select('reponses')
        .eq('evenement_id', evenement.id)
        .maybeSingle(),
      // condition_cle réellement utilisées par les référentiels visibles
      // d'ici — partagés ou propres à l'organisation. Un référentiel
      // local ajoute donc sa propre case au questionnaire tout seul,
      // sans toucher au code.
      supabase.from('referentiel_items').select('condition_cle').not('condition_cle', 'is', null)
    ])
    setReponses(r.data?.reponses ?? {})
    const cles = [...new Set((i.data ?? []).map((x) => x.condition_cle))].sort()
    setCriteres(cles.map((cle) => ({ cle, libelle: libelleCritere(cle) })))
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  function basculer(cle) {
    const [groupe, critere] = cle.split('.')
    setReponses((r) => {
      const g = { ...(r[groupe] ?? {}) }
      g[critere] = !g[critere]
      return { ...r, [groupe]: g }
    })
  }

  function coche(cle) {
    const [groupe, critere] = cle.split('.')
    return !!reponses[groupe]?.[critere]
  }

  async function enregistrer() {
    const { error } = await supabase
      .from('conformite_reponses')
      .upsert({ evenement_id: evenement.id, reponses })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setEnregistre(true)
      setTimeout(() => setEnregistre(false), 2500)
    }
  }

  return (
    <div className="formulaire">
      <p className="aide" style={{ marginTop: 0 }}>
        Ce que compte cet événement — pas comment c'est fait, juste ce qui est présent.
        Chaque case cochée peut faire apparaître une exigence légale dans le bilan et sur
        les check-lists d'ouverture. La liste s'allonge automatiquement si un référentiel
        local ajoute une disposition conditionnée à un nouveau critère.
      </p>
      {criteres.map((c) => (
        <label key={c.cle} className="case-confirme" style={{ margin: '6px 0' }}>
          <input type="checkbox" checked={coche(c.cle)} onChange={() => basculer(c.cle)} />
          <span>{c.libelle}</span>
        </label>
      ))}
      <button onClick={enregistrer} style={{ marginTop: 10 }}>
        {enregistre ? 'Enregistré ✓' : 'Enregistrer le questionnaire'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bilan — jamais stocké, recalculé à chaque lecture                    */
/* ------------------------------------------------------------------ */

function Bilan({ evenement, setMessage }) {
  const [items, setItems] = useState(null)
  const [zone, setZone] = useState(undefined) // undefined = pas encore chargé, null = commune inconnue de la bibliothèque

  async function charger() {
    const [r, i, c] = await Promise.all([
      supabase
        .from('conformite_reponses')
        .select('reponses')
        .eq('evenement_id', evenement.id)
        .maybeSingle(),
      supabase
        .from('referentiel_items')
        .select('*, referentiels(nom, portee, organisation_id, zone_nom)')
        .order('code'),
      evenement.commune
        ? supabase.from('communes').select('*').eq('nom', evenement.commune).maybeSingle()
        : Promise.resolve({ data: null })
    ])
    if (i.error) {
      setMessage({ type: 'erreur', texte: i.error.message })
      return
    }
    setZone(c.data ?? null)

    const reponses = r.data?.reponses ?? {}
    const zonesEvenement = [c.data?.zone_police, c.data?.zone_secours].filter(Boolean)

    const visibles = (i.data ?? []).filter((it) => {
      const ref = it.referentiels
      // Propre à cette organisation : déjà correctement filtré par RLS,
      // toujours retenu.
      if (ref.organisation_id) return true
      // Partagé, universel (sans zone précise, ex. RezonWal) : retenu
      // partout.
      if (!ref.zone_nom) return true
      // Partagé, zone-spécifique : retenu seulement si la zone résolue
      // de l'événement correspond.
      return zonesEvenement.includes(ref.zone_nom)
    })

    const applicables = visibles.filter((it) => {
      if (it.toujours_applicable) return true
      if (!it.condition_cle) return false
      const [groupe, critere] = it.condition_cle.split('.')
      return !!reponses[groupe]?.[critere]
    })
    setItems(applicables)
  }

  useEffect(() => {
    charger()
  }, [evenement.id, evenement.commune])

  if (items === null) return <p className="vide">…</p>

  const obligatoires = items.filter((it) => it.caractere === 'obligatoire')
  const recommandes = items.filter((it) => it.caractere === 'recommande')

  const carte = (it) => (
    <div className="carte" key={it.id}>
      <div className="titre">
        <span className="mono">{it.code}</span> — {it.titre}
      </div>
      <div className="meta">
        <span>{it.referentiels?.nom}</span>
        {it.toujours_applicable && <span className="jeton">toujours applicable</span>}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13 }}>{it.dispositions}</p>
      {it.seuils && (
        <p className="aide" style={{ marginTop: 6 }}>
          Seuil chiffré : <span className="mono">{JSON.stringify(it.seuils)}</span>
        </p>
      )}
    </div>
  )

  return (
    <>
      <p className="aide" style={{ marginTop: 0 }}>
        Recalculé à chaque ouverture de cet écran — jamais figé. Une modification du
        questionnaire ou du référentiel se reflète immédiatement ici.
      </p>

      {!evenement.commune && (
        <div className="message erreur">
          Commune non renseignée — encode-la dans Réglages → Dispositif pour que la
          bibliothèque partagée puisse te proposer automatiquement les référentiels connus
          pour ta zone de police et ta zone de secours.
        </div>
      )}

      {evenement.commune && zone === null && (
        <div className="message erreur">
          « {evenement.commune} » n'est pas encore dans la bibliothèque partagée. Ça ne veut
          pas dire qu'aucune règle ne s'applique — seulement qu'aucune n'a encore été
          vérifiée pour cette commune ici. Ajoute ton propre référentiel local dans l'onglet
          Référentiels.
        </div>
      )}

      <div className="pave-titre">Exigé aujourd'hui</div>
      <p className="aide" style={{ marginTop: -2 }}>
        Contraignant sur ce territoire, tel quel — commune, zone de police, zone de secours.
      </p>
      {obligatoires.length === 0 ? (
        <p className="vide">Aucune exigence applicable pour l'instant.</p>
      ) : (
        obligatoires.map(carte)
      )}

      {recommandes.length > 0 && (
        <>
          <div className="pave-titre" style={{ marginTop: 18 }}>
            Recommandé — pas encore imposé partout
          </div>
          <p className="aide" style={{ marginTop: -2 }}>
            Bonnes pratiques en cours de généralisation (RezonWal). Utile à anticiper, mais ne
            remplace pas ce qui est exigé aujourd'hui par la commune ou la zone.
          </p>
          {recommandes.map(carte)}
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Contrôles — sessions de check-list                                   */
/* ------------------------------------------------------------------ */

const STATUTS = [
  ['ok', 'OK'],
  ['a_corriger', 'À corriger'],
  ['bloquant', 'Bloquant']
]

function Controles({ evenement, setMessage }) {
  const [modeles, setModeles] = useState([])
  const [sessions, setSessions] = useState([])
  const [sessionOuverte, setSessionOuverte] = useState(null)
  const [nouveauModele, setNouveauModele] = useState('')
  const [sequence, setSequence] = useState('')

  async function charger() {
    const [m, s] = await Promise.all([
      supabase.from('checklist_modeles').select('*').order('ordre'),
      supabase
        .from('controles_sessions')
        .select('*, checklist_modeles(libelle)')
        .eq('evenement_id', evenement.id)
        .order('created_at', { ascending: false })
    ])
    setModeles(m.data ?? [])
    if (!nouveauModele && m.data?.length) setNouveauModele(m.data[0].code)
    setSessions(s.data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function demarrer() {
    const { data, error } = await supabase.rpc('demarrer_controle', {
      p_evenement: evenement.id,
      p_modele_code: nouveauModele,
      p_sequence: sequence.trim() || null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setSequence('')
      await charger()
      setSessionOuverte(data)
    }
  }

  if (sessionOuverte) {
    return (
      <SessionControle
        sessionId={sessionOuverte}
        onFermer={() => {
          setSessionOuverte(null)
          charger()
        }}
        setMessage={setMessage}
      />
    )
  }

  return (
    <>
      <div className="formulaire">
        <label htmlFor="modele">Démarrer un contrôle</label>
        <select
          id="modele"
          value={nouveauModele}
          onChange={(e) => setNouveauModele(e.target.value)}
        >
          {modeles.map((m) => (
            <option key={m.code} value={m.code}>
              {m.libelle}
            </option>
          ))}
        </select>
        <input
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
          placeholder="Séquence — ex. Jour 1, avant balade 13h"
        />
        <button onClick={demarrer}>Démarrer</button>
        <p className="aide">
          Les points fixes du modèle et les exigences légales actuellement applicables
          sont copiés dans la session au moment où elle démarre. La check-list ne bouge
          plus ensuite, même si le questionnaire change.
        </p>
      </div>

      <div className="pave-titre" style={{ marginTop: 16 }}>Sessions précédentes</div>
      {sessions.length === 0 ? (
        <p className="vide">Aucun contrôle encore réalisé.</p>
      ) : (
        sessions.map((s) => (
          <div className="carte" key={s.id}>
            <div className="titre">
              {s.checklist_modeles?.libelle}
              {s.sequence && <span className="mono"> — {s.sequence}</span>}
            </div>
            <div className="meta">
              <span>{new Date(s.date_controle).toLocaleDateString('fr-BE')}</span>
              {s.decision && (
                <span className={`jeton ${s.decision !== 'go' ? 'alerte-texte' : ''}`}>
                  {s.decision.replace('_', ' ').toUpperCase()}
                </span>
              )}
              {!s.decision && <span className="jeton alerte-texte">en cours</span>}
            </div>
            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button className="discret" onClick={() => setSessionOuverte(s.id)}>
                {s.decision ? 'Revoir' : 'Reprendre'}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  )
}

function SessionControle({ sessionId, onFermer, setMessage }) {
  const [session, setSession] = useState(null)
  const [lignes, setLignes] = useState([])
  const [mesures, setMesures] = useState('')

  async function charger() {
    const [s, l] = await Promise.all([
      supabase.from('controles_sessions').select('*').eq('id', sessionId).single(),
      supabase
        .from('controles_lignes')
        .select('*')
        .eq('session_id', sessionId)
        .order('ordre_section')
        .order('ordre_item')
    ])
    setSession(s.data)
    setMesures(s.data?.mesures_compensatoires ?? '')
    setLignes(l.data ?? [])
  }

  useEffect(() => {
    charger()
  }, [sessionId])

  async function majLigne(id, champs) {
    await supabase.from('controles_lignes').update(champs).eq('id', id)
    charger()
  }

  async function conclure(decision) {
    const { error } = await supabase
      .from('controles_sessions')
      .update({
        decision,
        mesures_compensatoires: mesures.trim() || null,
        heure_fin: new Date().toISOString()
      })
      .eq('id', sessionId)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFermer()
  }

  if (!session) return <p className="vide">…</p>

  const sections = [...new Set(lignes.map((l) => l.section))]
  const nCorriger = lignes.filter((l) => l.statut === 'a_corriger').length
  const nBloquant = lignes.filter((l) => l.statut === 'bloquant').length
  const nRestant = lignes.filter((l) => l.statut === 'a_faire').length

  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        <button className="discret" onClick={onFermer}>Retour</button>
      </div>

      {sections.map((sec) => (
        <div key={sec}>
          <div className="pave-titre" style={{ marginTop: 14 }}>{sec}</div>
          {lignes
            .filter((l) => l.section === sec)
            .map((l) => (
              <div className={`carte ${l.statut === 'bloquant' ? 'urgent' : ''}`} key={l.id}>
                <div className="titre" style={{ fontSize: 13.5 }}>{l.libelle}</div>
                <div className="ligne-boutons" style={{ marginTop: 6 }}>
                  {STATUTS.map(([v, lib]) => (
                    <button
                      key={v}
                      className={`module ${l.statut === v ? 'actif' : ''}`}
                      onClick={() => majLigne(l.id, { statut: v })}
                    >
                      {lib}
                    </button>
                  ))}
                </div>
                {(l.statut === 'a_corriger' || l.statut === 'bloquant') && (
                  <input
                    defaultValue={l.observation ?? ''}
                    placeholder="Observation / responsable / heure"
                    onBlur={(e) => majLigne(l.id, { observation: e.target.value })}
                    style={{ marginTop: 8, marginBottom: 0 }}
                  />
                )}
              </div>
            ))}
        </div>
      ))}

      {!session.decision ? (
        <div className="formulaire" style={{ marginTop: 16 }}>
          <div className="pave-titre">Synthèse de fin de contrôle</div>
          <div className="meta" style={{ marginBottom: 10 }}>
            <span>{nRestant} point(s) restant(s)</span>
            <span className={nCorriger > 0 ? 'alerte-texte' : ''}>
              {nCorriger} à corriger
            </span>
            <span className={nBloquant > 0 ? 'alerte-texte' : ''}>{nBloquant} bloquant(s)</span>
          </div>
          <label htmlFor="mesures">Mesures compensatoires éventuelles</label>
          <input id="mesures" value={mesures} onChange={(e) => setMesures(e.target.value)} />
          <div className="ligne-boutons" style={{ marginTop: 10 }}>
            <button onClick={() => conclure('go')}>GO</button>
            <button className="discret" onClick={() => conclure('go_sous_reserve')}>
              GO sous réserve
            </button>
            <button className="discret" onClick={() => conclure('no_go')}>
              NO-GO
            </button>
          </div>
        </div>
      ) : (
        <div className="message" style={{ marginTop: 16 }}>
          Décision : <strong>{session.decision.replace('_', ' ').toUpperCase()}</strong>
          {session.mesures_compensatoires && ` — ${session.mesures_compensatoires}`}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Référentiels — propres à l'organisation, jamais globaux             */
/* ------------------------------------------------------------------ */

const PORTEES = [
  ['commune', 'Commune'],
  ['zone_police', 'Zone de police'],
  ['zone_secours', 'Zone de secours']
]

function Referentiels({ evenement, exploitant, setMessage }) {
  const [partages, setPartages] = useState([])
  const [propres, setPropres] = useState([])
  const [zone, setZone] = useState(undefined)
  const [ouvrirNouveau, setOuvrirNouveau] = useState(false)
  const [referentielOuvert, setReferentielOuvert] = useState(null)

  async function charger() {
    const [r, z] = await Promise.all([
      supabase.from('referentiels').select('*, referentiel_items(count)').order('nom'),
      evenement.commune
        ? supabase.from('communes').select('*').eq('nom', evenement.commune).maybeSingle()
        : Promise.resolve({ data: null })
    ])
    if (r.error) {
      setMessage({ type: 'erreur', texte: r.error.message })
      return
    }
    setZone(z.data ?? null)
    setPartages((r.data ?? []).filter((x) => !x.organisation_id))
    setPropres((r.data ?? []).filter((x) => x.organisation_id === evenement.organisation_id))
  }

  useEffect(() => {
    charger()
  }, [evenement.organisation_id, evenement.commune])

  if (referentielOuvert) {
    return (
      <DetailReferentiel
        referentiel={referentielOuvert}
        exploitant={exploitant}
        onFermer={() => {
          setReferentielOuvert(null)
          charger()
        }}
        setMessage={setMessage}
      />
    )
  }

  const zonesEvenement = zone ? [zone.zone_police, zone.zone_secours].filter(Boolean) : []

  return (
    <>
      <p className="aide" style={{ marginTop: 0 }}>
        Un référentiel propre à ton organisation n'est jamais visible par une autre — la zone
        de police du Condroz ne doit rien dire à un événement organisé à Namur. Aucune analyse
        automatique du document déposé : les dispositions se saisissent une par une, avec la
        même rigueur qu'un texte de loi qu'on recopie — c'est ce qui garantit qu'elles disent
        vraiment ce que dit le règlement, pas une paraphrase approximative.
      </p>

      {evenement.commune && zone && (
        <p className="aide">
          Zone résolue pour <strong>{evenement.commune}</strong> : police «{' '}
          {zone.zone_police ?? '—'} », secours « {zone.zone_secours ?? '—'} ».
        </p>
      )}
      {evenement.commune && zone === null && (
        <div className="message erreur">
          « {evenement.commune} » n'est pas encore dans la bibliothèque partagée — aucune
          zone connue à proposer automatiquement.
        </div>
      )}

      <div className="pave-titre">Référentiels partagés</div>
      {partages.map((r) => {
        const pertinent = !r.zone_nom || zonesEvenement.includes(r.zone_nom)
        return (
          <div
            className="carte"
            key={r.id}
            onClick={() => setReferentielOuvert(r)}
            style={{ cursor: 'pointer', opacity: pertinent ? 1 : 0.55 }}
          >
            <div className="titre">
              {r.nom}
              {pertinent && r.zone_nom && <span className="jeton"> zone actuelle</span>}
            </div>
            <div className="meta">
              <span>{r.zone_nom ?? 'universel'}</span>
              <span>{r.referentiel_items?.[0]?.count ?? 0} item(s)</span>
              {r.derniere_verification && (
                <span>vérifié le {new Date(r.derniere_verification).toLocaleDateString('fr-BE')}</span>
              )}
            </div>
          </div>
        )
      })}

      <div className="pave-titre" style={{ marginTop: 16 }}>
        Référentiels propres à {evenement.organisation_id ? 'ton organisation' : "l'organisation"}
      </div>
      {propres.length === 0 ? (
        <p className="vide">Aucun référentiel local ajouté pour l'instant.</p>
      ) : (
        propres.map((r) => (
          <div className="carte" key={r.id} onClick={() => setReferentielOuvert(r)} style={{ cursor: 'pointer' }}>
            <div className="titre">{r.nom}</div>
            <div className="meta">
              <span>{r.portee} — {r.zone_nom}</span>
              <span>{r.referentiel_items?.[0]?.count ?? 0} item(s)</span>
            </div>
          </div>
        ))
      )}

      <div className="ligne-boutons" style={{ marginTop: 12 }}>
        <button onClick={() => setOuvrirNouveau(!ouvrirNouveau)}>
          {ouvrirNouveau ? 'Fermer' : '+ Ajouter un référentiel local'}
        </button>
      </div>

      {ouvrirNouveau && (
        <NouveauReferentiel
          evenement={evenement}
          setMessage={setMessage}
          onFait={() => {
            setOuvrirNouveau(false)
            charger()
          }}
        />
      )}
    </>
  )
}

function NouveauReferentiel({ evenement, setMessage, onFait }) {
  const [nom, setNom] = useState('')
  const [portee, setPortee] = useState('commune')
  const [zoneNom, setZoneNom] = useState('')
  const [fichier, setFichier] = useState(null)
  const [occupe, setOccupe] = useState(false)

  async function creer() {
    if (!nom.trim()) return
    setOccupe(true)

    let fichierUrl = null
    if (fichier) {
      const chemin = `${evenement.organisation_id}/${Date.now()}-${fichier.name}`
      const { error: erreurUpload } = await supabase.storage
        .from('referentiels')
        .upload(chemin, fichier)
      if (erreurUpload) {
        setMessage({ type: 'erreur', texte: erreurUpload.message })
        setOccupe(false)
        return
      }
      fichierUrl = supabase.storage.from('referentiels').getPublicUrl(chemin).data.publicUrl
    }

    const { error } = await supabase.from('referentiels').insert({
      code: `local-${Date.now()}`,
      nom: nom.trim(),
      portee,
      zone_nom: zoneNom.trim() || null,
      organisation_id: evenement.organisation_id,
      fichier_source_url: fichierUrl
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="formulaire" style={{ marginTop: 10 }}>
      <label htmlFor="nom-ref">Nom</label>
      <input
        id="nom-ref"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        placeholder="Règlement général de police de..."
      />
      <label htmlFor="portee-ref">Portée</label>
      <select id="portee-ref" value={portee} onChange={(e) => setPortee(e.target.value)}>
        {PORTEES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <label htmlFor="zone-ref">Nom de la zone ou de la commune</label>
      <input id="zone-ref" value={zoneNom} onChange={(e) => setZoneNom(e.target.value)} />
      <label htmlFor="fichier-ref">Document source (facultatif — gardé comme preuve)</label>
      <input
        id="fichier-ref"
        type="file"
        accept=".pdf,.docx,.doc"
        onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
      />
      <button disabled={occupe || !nom.trim()} onClick={creer} style={{ marginTop: 8 }}>
        Créer le référentiel
      </button>
      <p className="aide">
        Le document déposé n'est pas analysé automatiquement — il sert de preuve et de
        référence. Les dispositions applicables s'ajoutent une par une dans l'écran suivant.
      </p>
    </div>
  )
}

function DetailReferentiel({ referentiel, exploitant, onFermer, setMessage }) {
  const [items, setItems] = useState([])
  const [ouvrirItem, setOuvrirItem] = useState(false)
  const [occupePromotion, setOccupePromotion] = useState(false)
  const [f, setF] = useState({
    code: '', titre: '', categorie: 'generale', toujours: true,
    condition_cle: '', dispositions: '', caractere: 'obligatoire'
  })
  const [occupe, setOccupe] = useState(false)

  async function promouvoir() {
    setOccupePromotion(true)
    const { error } = await supabase
      .from('referentiels')
      .update({ organisation_id: null, derniere_verification: new Date().toISOString().slice(0, 10) })
      .eq('id', referentiel.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFermer()
    setOccupePromotion(false)
  }

  async function charger() {
    const { data, error } = await supabase
      .from('referentiel_items')
      .select('*')
      .eq('referentiel_id', referentiel.id)
      .order('code')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setItems(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [referentiel.id])

  async function ajouterItem() {
    if (!f.code.trim() || !f.titre.trim() || !f.dispositions.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('referentiel_items').insert({
      referentiel_id: referentiel.id,
      code: f.code.trim(),
      titre: f.titre.trim(),
      categorie: f.categorie,
      toujours_applicable: f.toujours,
      condition_cle: f.toujours ? null : f.condition_cle.trim() || null,
      dispositions: f.dispositions.trim(),
      caractere: f.caractere
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ code: '', titre: '', categorie: 'generale', toujours: true, condition_cle: '', dispositions: '', caractere: 'obligatoire' })
      setOuvrirItem(false)
      charger()
    }
    setOccupe(false)
  }

  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        <button className="discret" onClick={onFermer}>Retour</button>
      </div>

      <h2 style={{ marginTop: 0 }}>{referentiel.nom}</h2>
      {referentiel.fichier_source_url && (
        <p className="aide">
          <a href={referentiel.fichier_source_url} target="_blank" rel="noreferrer">
            Voir le document source →
          </a>
        </p>
      )}

      {exploitant && referentiel.organisation_id && (
        <div className="message">
          Ce référentiel appartient encore à une seule organisation. Le promouvoir le rend
          visible par toute la plateforme, pour toute future demande dans cette même zone.
          <div className="ligne-boutons" style={{ marginTop: 8 }}>
            <button disabled={occupePromotion} onClick={promouvoir}>
              Promouvoir en bien commun
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="vide">Aucune disposition saisie pour l'instant.</p>
      ) : (
        items.map((it) => (
          <div className="carte" key={it.id}>
            <div className="titre">
              <span className="mono">{it.code}</span> — {it.titre}
            </div>
            <div className="meta">
              <span className="jeton">{it.caractere}</span>
              <span>{it.toujours_applicable ? 'toujours applicable' : `si : ${it.condition_cle}`}</span>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 13 }}>{it.dispositions}</p>
          </div>
        ))
      )}

      <div className="ligne-boutons" style={{ marginTop: 12 }}>
        <button onClick={() => setOuvrirItem(!ouvrirItem)}>
          {ouvrirItem ? 'Fermer' : '+ Ajouter une disposition'}
        </button>
      </div>

      {ouvrirItem && (
        <div className="formulaire" style={{ marginTop: 10 }}>
          <label htmlFor="code-item">Code (ex. Art.21, II.004.D)</label>
          <input id="code-item" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <label htmlFor="titre-item">Titre</label>
          <input id="titre-item" value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} />
          <label htmlFor="dispo-item">Disposition — reprise telle quelle du texte source</label>
          <textarea
            id="dispo-item"
            rows={4}
            value={f.dispositions}
            onChange={(e) => setF({ ...f, dispositions: e.target.value })}
          />
          <label className="case-confirme">
            <input
              type="checkbox"
              checked={f.toujours}
              onChange={(e) => setF({ ...f, toujours: e.target.checked })}
            />
            <span>Toujours applicable (sinon, précise le critère déclencheur ci-dessous)</span>
          </label>
          {!f.toujours && (
            <input
              value={f.condition_cle}
              onChange={(e) => setF({ ...f, condition_cle: e.target.value })}
              placeholder="ex. structure.chapiteau, activite.pyrotechnie"
            />
          )}
          <label htmlFor="caractere-item">Caractère</label>
          <select
            id="caractere-item"
            value={f.caractere}
            onChange={(e) => setF({ ...f, caractere: e.target.value })}
          >
            <option value="obligatoire">Obligatoire — contraignant aujourd'hui</option>
            <option value="recommande">Recommandé — pas encore imposé</option>
          </select>
          <button disabled={occupe} onClick={ajouterItem} style={{ marginTop: 8 }}>
            Ajouter la disposition
          </button>
        </div>
      )}
    </>
  )
}
