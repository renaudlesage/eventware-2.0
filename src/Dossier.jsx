import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import DossierSecurite from './DossierSecurite'
import { Prima } from './Prima'
import NotificationDmp from './NotificationDmp'
import FormulaireCommunal from './FormulaireCommunal'
import { telechargerDossierPdf } from './exportDossierPdf'
import { diffuserDossier } from './diffuserDossier'

/**
 * DOSSIER DE SÉCURITÉ (157, étape 2).
 *
 * Le dossier déposé à la commune : son statut, ses contrôles de
 * complétude (156 — un bloquant empêche le dépôt), ses versions figées
 * à chaque dépôt, et le document .docx assemblé depuis les données
 * encodées. Qui a « référentiels : créer » ou tout pouvoir dépose ;
 * tout pouvoir retire.
 */
const STATUTS = {
  brouillon: 'Brouillon', depose: 'Déposé', en_instruction: 'En instruction',
  autorise: 'Autorisé', refuse: 'Refusé', retire: 'Retiré'
}
const GRAVITES = [
  ['bloquant', 'Bloquant — empêche le dépôt', 'chaud'],
  ['alerte', 'À compléter', 'veille'],
  ['chaud', 'Contrôle avant-vol : à corriger', 'chaud'],
  ['veille', 'Contrôle avant-vol : à vérifier', 'veille']
]

const quand = (iso) => (iso ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '')

export default function Dossier({ evenement, peut, toutPouvoir, setMessage }) {
  const [dossier, setDossier] = useState(null)
  const [versions, setVersions] = useState([])
  const [avis, setAvis] = useState([])
  const [liens, setLiens] = useState([])
  const [discipline, setDiscipline] = useState('D1')
  const [controles, setControles] = useState([])
  const [erreur, setErreur] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [ouverte, setOuverte] = useState(null)
  const peutDeposer = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger() {
    const [d, k] = await Promise.all([
      supabase.from('dossiers_securite').select('*').eq('evenement_id', evenement.id).maybeSingle(),
      supabase.rpc('controle_dossier', { p_evenement: evenement.id })
    ])
    if (k.error) setErreur(texteErreur(k.error))
    else { setErreur(null); setControles(k.data ?? []) }
    setDossier(d.data ?? null)
    if (d.data?.id) {
      const [v, a] = await Promise.all([
        supabase.from('dossier_versions').select('id, version, created_at, auteur_nom, contenu').eq('dossier_id', d.data.id).order('version', { ascending: false }),
        // (159) Les avis de la version courante, en vigueur, avec leurs prescriptions.
        supabase.from('avis_autorite').select('*, prescriptions_dossier(*)').eq('dossier_id', d.data.id).eq('version', d.data.version_courante).is('remplace_le', null).order('discipline')
      ])
      setVersions(v.data ?? [])
      setAvis(a.data ?? [])
    } else { setVersions([]); setAvis([]) }
    const l = await supabase.from('acces_autorite').select('id, jeton, libelle, organisation, niveau, discipline, actif, nb_acces, dernier_acces')
      .eq('evenement_id', evenement.id).in('niveau', ['avis', 'instruction']).is('deleted_at', null).order('created_at')
    setLiens(l.data ?? [])
  }

  const base = `${window.location.origin}${window.location.pathname}?autorite=`
  const DISCIPLINES = { D1: 'D1 — Secours', D2: 'D2 — Médical', D3: 'D3 — Police', D4: 'D4 — Logistique', D5: 'D5 — Information', COAMU: 'CoAMU', COMMUNE: 'Commune' }
  const AVIS_LIB = { favorable: 'favorable', favorable_conditions: 'favorable sous conditions', defavorable: 'DÉFAVORABLE' }

  async function ouvrirLien(d = discipline) {
    const commune = d === 'COMMUNE'
    const { error } = await supabase.from('acces_autorite').insert({
      evenement_id: evenement.id, libelle: commune ? `Commune de ${evenement.commune ?? '?'}` : `Avis ${d}`,
      niveau: commune ? 'instruction' : 'avis', discipline: d
    })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    charger()
  }

  function copier(texte) {
    navigator.clipboard?.writeText(texte).then(() => setMessage({ type: 'succes', texte: 'Lien copié.' })).catch(() => {})
  }

  useEffect(() => { charger() }, [evenement.id])

  async function deposer() {
    if (!window.confirm('Déposer le dossier ? Un instantané complet est figé : ce que la commune reçoit ne bougera plus.')) return
    setOccupe(true)
    const { data, error } = await supabase.rpc('deposer_dossier', { p_evenement: evenement.id })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setMessage({ type: 'succes', texte: `Dossier déposé — version ${data?.version}.` })
    diffuserDossier(evenement.id)
    charger()
  }

  // (161, étape 7 MVP) La décision reçue de la commune, consignée par l'organisateur.
  async function decider(statutDecision) {
    const commentaire = window.prompt(statutDecision === 'autorise'
      ? 'Dossier autorisé par la commune. Référence de l’arrêté (facultatif) — pense à le déposer dans Réglages › Partage, sous « Documents sur le lien autorité ».'
      : 'Dossier refusé par la commune. Motif (facultatif).')
    if (commentaire === null) return
    setOccupe(true)
    const { error } = await supabase.rpc('decider_dossier', { p_evenement: evenement.id, p_statut: statutDecision, p_commentaire: commentaire || null })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    diffuserDossier(evenement.id)
    charger()
  }

  // (étape 6) Le PDF : la version déposée telle quelle, sinon l'instantané du moment.
  async function pdf() {
    setOccupe(true)
    try {
      const derniere = versions[0]
      let contenu = derniere?.contenu
      if (!contenu) {
        const { data, error } = await supabase.rpc('instantane_dossier', { p_evenement: evenement.id })
        if (error) throw error
        contenu = Array.isArray(data) ? data[0] : data
      }
      telechargerDossierPdf({ evenement, contenu, version: derniere?.version ?? null, deposeLe: derniere?.created_at ?? null, statut: STATUTS[statut], avis })
    } catch (e) {
      setMessage({ type: 'erreur', texte: texteErreur(e) })
    }
    setOccupe(false)
  }

  async function retirer() {
    if (!window.confirm('Retirer le dossier déposé ?')) return
    setOccupe(true)
    const { error } = await supabase.rpc('retirer_dossier', { p_evenement: evenement.id })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    diffuserDossier(evenement.id)
    charger()
  }

  const bloquants = controles.filter((c) => c.gravite === 'bloquant')
  const statut = dossier?.statut ?? 'brouillon'

  return (
    <section className="bloc dossier-securite">
      <h2>Dossier de sécurité</h2>
      <div className="dossier-etat">
        <span className={`prc-jeton ${['autorise'].includes(statut) ? 'ok' : ['refuse'].includes(statut) ? 'chaud' : 'veille'}`}>{STATUTS[statut]}</span>
        {dossier?.version_courante > 0 && <span> version {dossier.version_courante}</span>}
        {dossier?.depose_le && <span className="aide"> · déposé le {quand(dossier.depose_le)}</span>}
        {dossier?.niveau_dmp && <span className="aide"> · DMP niveau {dossier.niveau_dmp}</span>}
      </div>

      {erreur ? (
        <p className="aide">Contrôles : {erreur}</p>
      ) : (
        <>
          <p className="aide">
            {bloquants.length === 0
              ? 'Aucun point bloquant : le dossier peut être déposé.'
              : `${bloquants.length} point${bloquants.length > 1 ? 's' : ''} bloquant${bloquants.length > 1 ? 's' : ''} avant de pouvoir déposer.`}
          </p>
          {GRAVITES.map(([g, libelle, ton]) => {
            const lignes = controles.filter((c) => c.gravite === g)
            if (!lignes.length) return null
            return (
              <div className="dossier-controles" key={g}>
                <div className={`pave-titre ${ton}`}>{libelle} ({lignes.length})</div>
                <ul>
                  {lignes.map((c) => (
                    <li key={c.code} className={`controle-${g}`}>
                      <strong>{c.titre}</strong>
                      {c.detail && <span className="aide"> — {c.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}

      <div className="ligne-boutons">
        {peutDeposer && (
          <button onClick={deposer} disabled={occupe || bloquants.length > 0 || !!erreur} title={bloquants.length ? 'Corriger les points bloquants d’abord' : ''}>
            {dossier?.version_courante > 0 ? 'Déposer une nouvelle version' : 'Déposer le dossier'}
          </button>
        )}
        {toutPouvoir && ['depose', 'en_instruction'].includes(statut) && (
          <>
            <button className="discret" onClick={retirer} disabled={occupe}>Retirer le dossier</button>
            <button className="discret decision-autorise" onClick={() => decider('autorise')} disabled={occupe}>Autorisé par la commune</button>
            <button className="discret decision-refuse" onClick={() => decider('refuse')} disabled={occupe}>Refusé par la commune</button>
          </>
        )}
        {dossier?.decide_le && <span className="aide">décision le {quand(dossier.decide_le)}</span>}
        <button className="discret" onClick={pdf} disabled={occupe}>
          {versions[0] ? `Télécharger le PDF (version ${versions[0].version})` : 'Télécharger le PDF (brouillon)'}
        </button>
      </div>

      {versions.length > 0 && (
        <div className="dossier-versions">
          <div className="pave-titre">Versions déposées</div>
          <ul>
            {versions.map((v) => {
              const c = v.contenu ?? {}
              const ouv = ouverte === v.id
              return (
                <li key={v.id}>
                  <button className="lien" onClick={() => setOuverte(ouv ? null : v.id)}>
                    Version {v.version} — {quand(v.created_at)}{v.auteur_nom ? ` par ${v.auteur_nom}` : ''}
                  </button>
                  {ouv && (
                    <div className="aide dossier-version-detail">
                      Fréquentation {c.evenement?.frequentation_max ?? '?'} · du {c.evenement?.date_montage ?? '?'} au {c.evenement?.date_demontage ?? '?'} ·{' '}
                      {(c.prescriptions ?? []).length} prescriptions · {(c.lieux ?? []).length} lieux · {(c.plan ?? []).length} objets du plan ·{' '}
                      {(c.contacts ?? []).length} contacts · {(c.controles ?? []).filter((k) => k.gravite === 'alerte').length} alertes au dépôt
                      {c.formulaire && <> · formulaire communal {c.formulaire.repondues}/{c.formulaire.total}</>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* (163) Le formulaire multidisciplinaire de la commune : douze sections, pré-remplies par Eventware, complétées ici.
          Une réponse change les contrôles (DOS_FORMULAIRE) : on les recharge. */}
      <FormulaireCommunal evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} onChange={charger} />

      {/* (164) La grille PRIMA de la CoAMU : score de risque, zone, niveau du dispositif médical préventif ; elle remplace la grille à points de la 160.
          Une saisie change les contrôles (DOS_PRIMA_*) : on les recharge. */}
      <Prima evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} onChange={charger}
        onLienCoamu={toutPouvoir ? () => { setDiscipline('COAMU'); ouvrirLien('COAMU') } : null} />

      {/* (165) La notification du dispositif médical préventif à la CoAMU et à la CU 112, 10 jours ouvrés avant. */}
      <NotificationDmp evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} setMessage={setMessage} onChange={charger} />

      {/* (159) Les avis des disciplines sur la version déposée, et les liens qui permettent de les rendre. */}
      {dossier?.version_courante > 0 && (
        <div className="dossier-avis">
          <div className="pave-titre">Avis des disciplines — version {dossier.version_courante} ({avis.length})</div>
          {avis.length === 0 ? <p className="vide">Aucun avis rendu sur cette version.</p> : (
            <ul>
              {avis.map((a) => (
                <li key={a.id} className={a.avis === 'defavorable' ? 'controle-bloquant' : a.avis === 'favorable_conditions' ? 'controle-alerte' : ''}>
                  <strong>{DISCIPLINES[a.discipline] ?? a.discipline}</strong> : {AVIS_LIB[a.avis]}{a.rendu_par ? ` (${a.rendu_par})` : ''} <span className="aide">{quand(a.rendu_le)}</span>
                  {a.commentaire && <div className="aide">{a.commentaire}</div>}
                  {(a.prescriptions_dossier ?? []).length > 0 && (
                    <ul>{a.prescriptions_dossier.map((p) => <li key={p.id}>{p.texte}{p.caractere === 'recommande' ? ' (recommandé)' : ''}</li>)}</ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {toutPouvoir && (
            <>
              <div className="pave-titre">Liens d’avis</div>
              {liens.length > 0 && (
                <ul>
                  {liens.map((l) => (
                    <li key={l.id} className={l.actif ? '' : 'inactif'}>
                      {l.libelle}{l.organisation ? ` · ${l.organisation}` : ''} <span className="prc-jeton veille">{l.discipline}</span>{' '}
                      <span className="aide">{l.nb_acces ? `${l.nb_acces} visite(s)` : 'jamais consulté'}{l.actif ? '' : ' · révoqué'}</span>{' '}
                      {l.actif && <button className="discret" onClick={() => copier(base + l.jeton)}>Copier le lien</button>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="ligne-boutons">
                <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} aria-label="Discipline">
                  {Object.entries(DISCIPLINES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button className="discret" onClick={() => ouvrirLien()}>+ Ouvrir un lien d’avis</button>
              </div>
              <p className="aide">Le lien se révoque et se date dans Partage › Accès autorité.</p>
            </>
          )}
        </div>
      )}

      <DossierSecurite evenement={evenement} setMessage={setMessage} />
    </section>
  )
}
