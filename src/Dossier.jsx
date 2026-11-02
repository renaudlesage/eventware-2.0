import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import DossierSecurite from './DossierSecurite'

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
      const v = await supabase.from('dossier_versions').select('id, version, created_at, auteur_nom, contenu').eq('dossier_id', d.data.id).order('version', { ascending: false })
      setVersions(v.data ?? [])
    } else setVersions([])
  }

  useEffect(() => { charger() }, [evenement.id])

  async function deposer() {
    if (!window.confirm('Déposer le dossier ? Un instantané complet est figé : ce que la commune reçoit ne bougera plus.')) return
    setOccupe(true)
    const { data, error } = await supabase.rpc('deposer_dossier', { p_evenement: evenement.id })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setMessage({ type: 'succes', texte: `Dossier déposé — version ${data?.version}.` })
    charger()
  }

  async function retirer() {
    if (!window.confirm('Retirer le dossier déposé ?')) return
    setOccupe(true)
    const { error } = await supabase.rpc('retirer_dossier', { p_evenement: evenement.id })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
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
          <button className="discret" onClick={retirer} disabled={occupe}>Retirer le dossier</button>
        )}
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
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <DossierSecurite evenement={evenement} setMessage={setMessage} />
    </section>
  )
}
