import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { appliquerIconeEvenement } from './logoPwa'

/**
 * PAGE D'AVIS — le dossier de sécurité lu et instruit par lien (159).
 *
 * Même route que la situation autorité (?autorite=<jeton>) : un lien de
 * niveau « avis » (D1 à D5, CoAMU) ou « instruction » (la commune) y
 * arrive quand situation_autorite le refuse. La discipline lit la
 * version déposée, figée, et rend son avis avec ses prescriptions ; la
 * commune accuse réception et suit les avis. Rien ici ne montre la
 * situation opérationnelle.
 */
const REFUS = {
  P0002: 'Ce lien ne correspond à aucun accès.',
  P0005: "Cet accès a été révoqué par l'organisateur.",
  P0006: 'Cet accès a expiré.',
  P0008: 'Ce lien ne donne pas accès au dossier de sécurité.',
  P0009: "Aucun dossier n'a encore été déposé pour cet événement."
}
const AVIS = [
  ['favorable', 'Favorable'],
  ['favorable_conditions', 'Favorable sous conditions'],
  ['defavorable', 'Défavorable']
]
const AVIS_LIB = Object.fromEntries(AVIS)
const STATUTS = { depose: 'Déposé', en_instruction: 'En instruction', autorise: 'Autorisé', refuse: 'Refusé', retire: 'Retiré' }
const DISCIPLINES = { D1: 'D1 — Secours (zone de secours)', D2: 'D2 — Médical (CoAMU, SMUR)', D3: 'D3 — Police', D4: 'D4 — Logistique', D5: 'D5 — Information', COAMU: 'CoAMU', COMMUNE: 'Commune' }
const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-BE') : '—')
const quand = (d) => (d ? new Date(d).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '')

// (172) Les bornes du dépôt d'avis : les mêmes que la fonction `deposer_avis`, qui refuse au-delà (22001).
const MAX_COMMENTAIRE = 4000
const MAX_PRESCRIPTIONS = 50
const MAX_PRESCRIPTION = 1000

/** Le compteur ne paraît qu'à l'approche de la limite (neuf dixièmes) : avant, il n'apprend rien. */
function Compteur({ n, max }) {
  if (n < max * 0.9) return null
  return (
    <p className={`aide compteur-saisie ${n >= max ? 'alerte-texte' : ''}`} role="status">
      {n.toLocaleString('fr-BE')} / {max.toLocaleString('fr-BE')} caractères{n >= max ? ' : limite atteinte' : ''}
    </p>
  )
}

export default function AvisAutorite({ jeton }) {
  const [s, setS] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [avis, setAvis] = useState('favorable')
  const [commentaire, setCommentaire] = useState('')
  const [echeance, setEcheance] = useState('')
  const [prescriptions, setPrescriptions] = useState([])
  const [occupe, setOccupe] = useState(false)
  const [modifier, setModifier] = useState(false)

  async function charger() {
    const { data, error } = await supabase.rpc('dossier_par_jeton', { p_jeton: jeton })
    if (error) return setErreur(REFUS[error.code] ?? texteErreur(error))
    setS(data)
    setErreur(null)
  }
  useEffect(() => { charger() }, [jeton])
  useEffect(() => { if (s) appliquerIconeEvenement(s.evenement?.nom, s.evenement?.logo_url) }, [s?.evenement?.logo_url])

  async function envoyer(e) {
    e.preventDefault()
    setOccupe(true)
    const { error } = await supabase.rpc('deposer_avis', {
      p_jeton: jeton, p_avis: avis, p_commentaire: commentaire || null,
      p_prescriptions: prescriptions.filter((p) => p.texte.trim()), p_echeance: echeance || null
    })
    setOccupe(false)
    if (error) return setErreur(texteErreur(error))
    setModifier(false)
    charger()
  }

  async function accuser() {
    const { error } = await supabase.rpc('accuser_reception_dossier', { p_jeton: jeton })
    if (error) return setErreur(texteErreur(error))
    charger()
  }

  if (erreur && !s) {
    return (
      <div className="autorite">
        <div className="message erreur">{erreur}</div>
        <p className="aide">Rapproche-toi de l'organisateur pour obtenir un lien valable.</p>
      </div>
    )
  }
  if (!s) return <div className="autorite"><p className="vide">Chargement…</p></div>

  const c = s.contenu ?? {}
  const ev = c.evenement ?? {}
  const d = s.dossier ?? {}
  const dest = s.destinataire ?? {}
  const instruction = dest.niveau === 'instruction'
  const questionnaire = Object.entries(c.questionnaire ?? {}).flatMap(([g, v]) => Object.entries(v ?? {}).filter(([, b]) => b).map(([k]) => `${g} · ${k}`))
  const prescriptionsApplicables = c.prescriptions ?? []
  const peutRendre = ['depose', 'en_instruction'].includes(d.statut) && dest.discipline
  const monAvis = s.mon_avis

  return (
    <div className="autorite avis-dossier">
      <header className="bandeau">
        <div className="bandeau-titre">
          {s.evenement?.logo_url && <img src={s.evenement.logo_url} alt="" className="logo-participant" />}
          <div>
            <h1>{s.evenement?.nom}</h1>
            <p className="acces-role">
              {dest.libelle}{dest.organisation ? ` · ${dest.organisation}` : ''} · <span className="mono">{DISCIPLINES[dest.discipline] ?? dest.niveau}</span>
            </p>
          </div>
        </div>
        <div className="etat-droite">
          <span className="niveau-autorite niveau-normal">Dossier {STATUTS[d.statut] ?? d.statut}</span>
          <span className="compte">version {d.version} · déposée le {jour(d.depose_le)}</span>
        </div>
      </header>
      {erreur && <div className="message erreur">{erreur}</div>}

      <main className="autorite-corps">
        <section className="bloc">
          <h2>1. Organisateur</h2>
          <dl className="fiche-cles">
            <dt>Organisation</dt><dd>{c.organisateur?.nom ?? '—'}{c.organisateur?.contact_nom ? ` · ${c.organisateur.contact_nom}` : ''}{c.organisateur?.contact_tel ? ` · ${c.organisateur.contact_tel}` : ''}</dd>
            <dt>Responsable légal</dt><dd>{c.profil_securite?.responsable_legal ?? '—'}{c.profil_securite?.responsable_legal_tel ? ` · ${c.profil_securite.responsable_legal_tel}` : ''}</dd>
            <dt>Responsable sécurité</dt><dd>{c.profil_securite?.securite_nom ?? '—'}{c.profil_securite?.securite_tel ? ` · ${c.profil_securite.securite_tel}` : ''}</dd>
          </dl>
        </section>
        <section className="bloc">
          <h2>2. Assurances</h2>
          <dl className="fiche-cles">
            <dt>Compagnie</dt><dd>{c.profil_securite?.assurance_compagnie ?? '—'}</dd>
            <dt>Police</dt><dd>{c.profil_securite?.assurance_police ?? '—'}</dd>
          </dl>
        </section>
        <section className="bloc">
          <h2>3. Manifestation</h2>
          <dl className="fiche-cles">
            <dt>Commune</dt><dd>{ev.commune ?? '—'}{ev.province ? ` (${ev.province})` : ''}{ev.zone_secours ? ` · zone de secours ${ev.zone_secours}` : ''}{ev.zone_police ? ` · zone de police ${ev.zone_police}` : ''}</dd>
            <dt>Dates</dt><dd>montage le {jour(ev.date_montage)} · du {jour(ev.date_debut)} au {jour(ev.date_fin)} · démontage le {jour(ev.date_demontage)}</dd>
            <dt>Public attendu</dt><dd>{ev.frequentation_min ?? '?'} à {ev.frequentation_max ?? '?'} personnes</dd>
            <dt>Déclaré</dt><dd>{questionnaire.length ? questionnaire.join(', ') : 'rien de déclaré'}</dd>
            <dt>Lieux</dt><dd>{(c.lieux ?? []).length} lieux, dont {(c.lieux ?? []).filter((l) => l.type === 'pc_ops').map((l) => `PC-Ops « ${l.nom} »`).join(', ') || 'aucun PC-Ops'}</dd>
            <dt>Plan</dt><dd>{(c.plan ?? []).length} objets d'implantation</dd>
          </dl>
        </section>
        <section className="bloc">
          <h2>4. Prescriptions applicables ({prescriptionsApplicables.length})</h2>
          {prescriptionsApplicables.length === 0 ? <p className="vide">Aucune prescription de référentiel ne s'applique.</p> : (
            <ul className="liste-prescriptions">
              {prescriptionsApplicables.map((p, i) => (
                <li key={i}><span className="mono">{p.code}</span> {p.titre} <span className="aide">({p.caractere === 'recommande' ? 'recommandé' : 'obligatoire'} · {p.referentiel})</span>{p.complement_local && <div className="aide">Local : {p.complement_local}</div>}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="bloc">
          <h2>5. Dispositif de secours et DMP</h2>
          {(c.secours ?? []).length === 0 ? <p className="vide">Aucun moyen de premiers secours déclaré.</p> : (
            <ul>{(c.secours ?? []).map((m, i) => <li key={i}>{m.quantite} × {m.type}{m.commentaire ? ` — ${m.commentaire}` : ''}</li>)}</ul>
          )}
          <p className="aide">DMP : {d.niveau_dmp ? `niveau ${d.niveau_dmp}${d.score_dmp != null ? ` (${d.score_dmp} points)` : ''}` : 'non calculé'}</p>
        </section>
        <section className="bloc">
          <h2>6. Contacts</h2>
          {(c.contacts ?? []).length === 0 ? <p className="vide">Aucun contact partagé.</p> : (
            <ul>{(c.contacts ?? []).map((k, i) => <li key={i}>{k.nom}{k.fonction ? ` (${k.fonction})` : ''}{k.organisation ? ` · ${k.organisation}` : ''}{k.telephone ? ` · ${k.telephone}` : ''}{k.role_autorite === 'interlocuteur' ? ' — interlocuteur' : ''}</li>)}</ul>
          )}
          {(c.controles ?? []).filter((k) => k.gravite === 'alerte').length > 0 && (
            <p className="aide">Au dépôt, l'organisateur signalait : {(c.controles ?? []).filter((k) => k.gravite === 'alerte').map((k) => k.titre).join(' ; ')}.</p>
          )}
        </section>

        <section className="bloc">
          <h2>7. Avis rendus sur cette version</h2>
          {(s.avis ?? []).length === 0 ? <p className="vide">Aucun avis encore.</p> : (
            <ul className="liste-avis">
              {(s.avis ?? []).map((a) => (
                <li key={a.id}>
                  <strong>{DISCIPLINES[a.discipline] ?? a.discipline}</strong> — {AVIS_LIB[a.avis]}{a.rendu_par ? ` (${a.rendu_par})` : ''} <span className="aide">{quand(a.rendu_le)}</span>
                  {a.commentaire && <div>{a.commentaire}</div>}
                  {a.prescriptions?.length > 0 && <ul>{a.prescriptions.map((p, i) => <li key={i}>{p.texte}{p.caractere === 'recommande' ? ' (recommandé)' : ''}</li>)}</ul>}
                  {a.echeance && <div className="aide">à réaliser pour le {jour(a.echeance)}</div>}
                </li>
              ))}
            </ul>
          )}
          {instruction && d.statut === 'depose' && (
            <button onClick={accuser}>Accuser réception — passer en instruction</button>
          )}
        </section>

        {peutRendre && (
          <section className="bloc avis-formulaire">
            <h2>Mon avis — {DISCIPLINES[dest.discipline]}</h2>
            {monAvis && !modifier ? (
              <>
                <p><strong>{AVIS_LIB[monAvis.avis]}</strong> rendu le {quand(monAvis.rendu_le)}{monAvis.commentaire ? ` — ${monAvis.commentaire}` : ''}</p>
                {monAvis.prescriptions?.length > 0 && <ul>{monAvis.prescriptions.map((p, i) => <li key={i}>{p.texte}{p.caractere === 'recommande' ? ' (recommandé)' : ''}</li>)}</ul>}
                <button className="discret" onClick={() => { setModifier(true); setAvis(monAvis.avis); setCommentaire(monAvis.commentaire ?? ''); setPrescriptions(monAvis.prescriptions ?? []); setEcheance(monAvis.echeance ?? '') }}>Rendre un nouvel avis</button>
              </>
            ) : (
              <form className="formulaire" onSubmit={envoyer}>
                <div className="onglets" role="radiogroup" aria-label="Avis">
                  {AVIS.map(([k, l]) => (
                    <button type="button" key={k} role="radio" aria-checked={avis === k} className={`module ${avis === k ? 'actif' : ''}`} onClick={() => setAvis(k)}>{l}</button>
                  ))}
                </div>
                <label>Commentaire<textarea value={commentaire} maxLength={MAX_COMMENTAIRE} onChange={(e) => setCommentaire(e.target.value)} rows={3} /></label>
                <Compteur n={commentaire.length} max={MAX_COMMENTAIRE} />
                <div className="pave-titre">Prescriptions</div>
                {prescriptions.map((p, i) => (
                  <div className="saisie-rapide prescription-ligne" key={i}>
                    <input value={p.texte} maxLength={MAX_PRESCRIPTION} aria-label={`Prescription ${i + 1}`} placeholder="Ce que l'organisateur doit mettre en place" onChange={(e) => setPrescriptions(prescriptions.map((x, j) => (j === i ? { ...x, texte: e.target.value } : x)))} />
                    <select value={p.caractere ?? 'obligatoire'} onChange={(e) => setPrescriptions(prescriptions.map((x, j) => (j === i ? { ...x, caractere: e.target.value } : x)))} aria-label="Caractère">
                      <option value="obligatoire">obligatoire</option>
                      <option value="recommande">recommandé</option>
                    </select>
                    <button type="button" className="discret" onClick={() => setPrescriptions(prescriptions.filter((_, j) => j !== i))} aria-label="Retirer">×</button>
                    <Compteur n={p.texte.length} max={MAX_PRESCRIPTION} />
                  </div>
                ))}
                <button type="button" className="discret" disabled={prescriptions.length >= MAX_PRESCRIPTIONS} onClick={() => setPrescriptions([...prescriptions, { texte: '', caractere: 'obligatoire' }])}>+ Prescription</button>
                {prescriptions.length >= MAX_PRESCRIPTIONS && <p className="aide" role="status">{MAX_PRESCRIPTIONS} prescriptions au plus par avis.</p>}
                <label>À réaliser pour le (facultatif)<input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} /></label>
                <div className="ligne-boutons">
                  <button type="submit" disabled={occupe}>Rendre l'avis</button>
                  {monAvis && <button type="button" className="discret" onClick={() => setModifier(false)}>Annuler</button>}
                </div>
              </form>
            )}
          </section>
        )}
        {!peutRendre && dest.discipline && <p className="aide">Le dossier n'est plus en instruction : aucun avis ne peut être rendu sur cette version.</p>}
      </main>
    </div>
  )
}
