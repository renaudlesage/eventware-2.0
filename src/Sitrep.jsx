import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * SITREP — restitution de la main courante.
 *
 * Ce que ce document doit permettre : qu'un tiers qui n'était pas là
 * reconstitue la chronologie et sache qui l'atteste. D'où trois
 * exigences qui ne sont pas décoratives —
 *
 *   la PÉRIODE couverte est annoncée, sinon on ne sait pas ce qui
 *   manque ;
 *   le NOMBRE d'entrées est imprimé, pour qu'on ne puisse pas retirer
 *   une page sans que ça se voie ;
 *   le SIGNATAIRE et l'heure d'édition figurent en pied.
 *
 * Le document n'est pas une preuve au sens juridique : c'est une
 * restitution attestée par celui qui l'édite. Le dire clairement vaut
 * mieux que de le laisser croire.
 */

const IMPORTANCES = [
  ['toutes', 'Tout'],
  ['notable', 'Notable et majeur'],
  ['majeur', 'Majeur seulement']
]

export default function Sitrep({ evenement, session, membre }) {
  const [lignes, setLignes] = useState(null)
  const [debut, setDebut] = useState('')
  const [fin, setFin] = useState('')
  const [seuil, setSeuil] = useState('toutes')
  const [signataire, setSignataire] = useState(membre?.nom_affiche ?? '')
  const [qualite, setQualite] = useState('')
  const [destinataire, setDestinataire] = useState('')
  const [erreur, setErreur] = useState(null)
  const [edite, setEdite] = useState(null)

  async function charger() {
    let q = supabase
      .from('journal')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('horodatage')
    if (debut) q = q.gte('horodatage', new Date(debut).toISOString())
    if (fin) q = q.lte('horodatage', new Date(fin).toISOString())
    const { data, error } = await q
    if (error) setErreur(error.message)
    else {
      setLignes(data ?? [])
      setErreur(null)
    }
  }

  useEffect(() => {
    charger()
  }, [evenement.id, debut, fin])

  const visibles = useMemo(() => {
    if (!lignes) return []
    if (seuil === 'majeur') return lignes.filter((l) => l.importance === 'majeur')
    if (seuil === 'notable')
      return lignes.filter((l) => ['notable', 'majeur'].includes(l.importance))
    return lignes
  }, [lignes, seuil])

  const stats = useMemo(() => {
    const s = { saisies: 0, auto: 0, majeures: 0, modules: {} }
    for (const l of visibles) {
      if (l.source === 'saisie') s.saisies++
      else s.auto++
      if (l.importance === 'majeur') s.majeures++
      if (l.module) s.modules[l.module] = (s.modules[l.module] ?? 0) + 1
    }
    return s
  }, [visibles])

  function editer() {
    setEdite(new Date())
    // Laisse React peindre l'en-tête daté avant d'ouvrir l'impression
    setTimeout(() => window.print(), 120)
  }

  if (erreur) return <div className="message erreur">{erreur}</div>
  if (!lignes) return <p className="vide">Chargement…</p>

  const reference =
    'SITREP-' +
    (evenement.slug ?? '').toUpperCase().slice(0, 8) +
    '-' +
    new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const periode =
    debut || fin
      ? `${debut ? new Date(debut).toLocaleString('fr-BE') : 'origine'} → ${
          fin ? new Date(fin).toLocaleString('fr-BE') : 'maintenant'
        }`
      : `Depuis l'ouverture de l'événement jusqu'au ${new Date().toLocaleString('fr-BE')}`

  return (
    <>
      {/* --- Réglages, non imprimés --- */}
      <div className="reglages-sitrep">
        <div className="saisie-rapide">
          <div style={{ flex: '1 1 180px' }}>
            <label htmlFor="sit-debut">Du</label>
            <input
              id="sit-debut"
              type="datetime-local"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label htmlFor="sit-fin">Au</label>
            <input
              id="sit-fin"
              type="datetime-local"
              value={fin}
              onChange={(e) => setFin(e.target.value)}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label htmlFor="sit-seuil">Niveau retenu</label>
            <select id="sit-seuil" value={seuil} onChange={(e) => setSeuil(e.target.value)}>
              {IMPORTANCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="saisie-rapide">
          <input
            value={signataire}
            onChange={(e) => setSignataire(e.target.value)}
            placeholder="Nom du signataire"
          />
          <input
            value={qualite}
            onChange={(e) => setQualite(e.target.value)}
            placeholder="Qualité — ex. Coordinateur sécurité"
          />
          <input
            value={destinataire}
            onChange={(e) => setDestinataire(e.target.value)}
            placeholder="Destinataire — ex. Zone de secours HEMECO"
          />
        </div>

        <div className="ligne-boutons">
          <button disabled={!signataire.trim()} onClick={editer}>
            Éditer le rapport
          </button>
          <button className="discret" onClick={() => exporterCsv(visibles, reference)}>
            Export CSV
          </button>
        </div>
        <p className="aide">
          Le rapport s'ouvre dans la fenêtre d'impression du navigateur : choisis
          « Enregistrer au format PDF » comme imprimante. Un filtre trop restrictif produit
          un document incomplet — la période et le niveau retenus sont imprimés en tête pour
          que le lecteur le sache.
        </p>
      </div>

      {/* --- Document --- */}
      <div className="imprimable sitrep">
        <div className="sitrep-tete">
          <div>
            <div className="sitrep-titre">Rapport de situation</div>
            <div className="sitrep-sous">{evenement.nom}</div>
          </div>
          <div className="sitrep-ref mono">{reference}</div>
        </div>

        <table className="sitrep-entete">
          <tbody>
            <tr>
              <th>Période couverte</th>
              <td>{periode}</td>
            </tr>
            <tr>
              <th>Niveau retenu</th>
              <td>{IMPORTANCES.find((i) => i[0] === seuil)?.[1]}</td>
            </tr>
            <tr>
              <th>Entrées au rapport</th>
              <td>
                <strong>{visibles.length}</strong>
                {visibles.length !== lignes.length && (
                  <> sur {lignes.length} enregistrées sur la période</>
                )}
              </td>
            </tr>
            <tr>
              <th>Phase à l'édition</th>
              <td>{evenement.phase}</td>
            </tr>
            {destinataire && (
              <tr>
                <th>Destinataire</th>
                <td>{destinataire}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="sitrep-section">Synthèse</div>
        <table className="sitrep-entete">
          <tbody>
            <tr>
              <th>Saisies par un opérateur</th>
              <td>{stats.saisies}</td>
            </tr>
            <tr>
              <th>Enregistrées automatiquement</th>
              <td>{stats.auto}</td>
            </tr>
            <tr>
              <th>Événements majeurs</th>
              <td>{stats.majeures}</td>
            </tr>
            <tr>
              <th>Répartition</th>
              <td>
                {Object.entries(stats.modules)
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, n]) => `${m} : ${n}`)
                  .join(' · ') || '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="sitrep-section">Chronologie</div>
        <table className="sitrep-journal">
          <thead>
            <tr>
              <th>Date et heure</th>
              <th>Réf.</th>
              <th>Événement</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => (
              <tr key={l.id} className={l.importance === 'majeur' ? 'majeur' : ''}>
                <td className="mono nowrap">
                  {new Date(l.horodatage).toLocaleString('fr-BE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </td>
                <td className="mono">{l.objet_ref ?? '—'}</td>
                <td>
                  {l.texte}
                  {l.source === 'saisie' && <span className="sitrep-marque"> (saisie)</span>}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan="3">Aucune entrée sur la période et le niveau retenus.</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="sitrep-pied">
          <p>
            Le soussigné atteste que le présent rapport reproduit fidèlement les entrées
            enregistrées dans la main courante de l'événement pour la période indiquée. La
            main courante ne peut être ni modifiée ni supprimée après enregistrement.
          </p>
          <table className="sitrep-entete">
            <tbody>
              <tr>
                <th>Édité par</th>
                <td>
                  {signataire || '—'}
                  {qualite && `, ${qualite}`}
                </td>
              </tr>
              <tr>
                <th>Compte</th>
                <td className="mono">{session?.user?.email}</td>
              </tr>
              <tr>
                <th>Édité le</th>
                <td>{(edite ?? new Date()).toLocaleString('fr-BE')}</td>
              </tr>
            </tbody>
          </table>
          <div className="sitrep-signature">
            <span>Signature</span>
          </div>
        </div>
      </div>
    </>
  )
}

function exporterCsv(lignes, reference) {
  const entetes = ['horodatage', 'importance', 'source', 'module', 'categorie', 'reference', 'texte']
  const echappe = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [
    entetes.join(';'),
    ...lignes.map((l) =>
      [
        new Date(l.horodatage).toISOString(),
        l.importance,
        l.source,
        l.module,
        l.categorie,
        l.objet_ref,
        l.texte
      ]
        .map(echappe)
        .join(';')
    )
  ].join('\n')

  const url = URL.createObjectURL(
    new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `${reference}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
