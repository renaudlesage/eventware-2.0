import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/**
 * FORMULAIRES DE DEMANDE D'AUTORISATION (163).
 *
 * Les formulaires qui valent pour l'événement : celui de sa commune
 * (Ferrières, collège du 16 novembre 2023) et le multidisciplinaire
 * fédéral (IBZ, octobre 2017) que le coordinateur PLANU reporte dans la
 * grille PRIMA de la CoAMU. Chaque question vaut ce qu'Eventware sait
 * déjà (pré-rempli : l'événement, le profil de l'organisation, la
 * conformité, le plan, les contacts…) tant que personne n'a saisi autre
 * chose ; une saisie prime, et se retire pour revenir au pré-rempli.
 * Le dépôt fige le tout (157) et le PDF le reprend dans l'ordre de
 * chaque formulaire.
 */
const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-BE') : '')
const TITRE_VALEUR = {
  oui: 'Oui', non: 'Non'
}

// Ce qu'une valeur jsonb veut dire, en texte — partagé avec le PDF.
export function texteReponse(q, v = q?.valeur) {
  if (v == null || v === '') return ''
  switch (q.type) {
    case 'oui_non':
    case 'annexe':
    case 'oui_non_explication': {
      const o = typeof v === 'object' ? v : { reponse: !!v }
      if (o.reponse == null) return o.explication ?? ''
      return `${o.reponse ? TITRE_VALEUR.oui : TITRE_VALEUR.non}${o.explication ? ` — ${o.explication}` : ''}`
    }
    case 'multi': return Array.isArray(v) ? v.join(', ') : String(v)
    case 'contact': {
      if (typeof v !== 'object') return String(v)
      return [v.nom, v.responsable ? `resp. ${v.responsable}` : null, v.fonction, v.adresse, v.gsm, v.telephone, v.email, v.distance_km ? `${v.distance_km} km` : null].filter(Boolean).join(' · ')
    }
    case 'date': return v ? new Date(v).toLocaleDateString('fr-BE') : ''
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

const CHAMPS_CONTACT = [['nom', 'Nom'], ['fonction', 'Fonction'], ['gsm', 'GSM'], ['email', 'E-mail'], ['adresse', 'Adresse']]

function Reponse({ q, valeur, lectureSeule, onChange }) {
  const v = valeur
  const objet = typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
  const dis = lectureSeule
  switch (q.type) {
    case 'nombre':
      return <input type="number" value={v ?? ''} disabled={dis} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    case 'date':
      return <input type="date" value={v ?? ''} disabled={dis} onChange={(e) => onChange(e.target.value || null)} />
    case 'choix':
      return (
        <select value={v ?? ''} disabled={dis} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'multi': {
      const liste = Array.isArray(v) ? v : []
      return (
        <div className="formulaire-multi">
          {(q.options ?? []).map((o) => (
            <label key={o}>
              <input type="checkbox" checked={liste.includes(o)} disabled={dis}
                onChange={(e) => { const n = e.target.checked ? [...liste, o] : liste.filter((x) => x !== o); onChange(n.length ? n : null) }} />
              {o}
            </label>
          ))}
        </div>
      )
    }
    case 'oui_non':
    case 'annexe':
    case 'oui_non_explication': {
      const reponse = typeof v === 'boolean' ? v : objet.reponse
      const libelles = q.type === 'annexe' ? ['Jointe', 'À joindre'] : ['Oui', 'Non']
      return (
        <div className="formulaire-oui-non">
          <label><input type="radio" name={`q-${q.code}`} checked={reponse === true} disabled={dis} onChange={() => onChange({ ...objet, reponse: true })} />{libelles[0]}</label>
          <label><input type="radio" name={`q-${q.code}`} checked={reponse === false} disabled={dis} onChange={() => onChange({ ...objet, reponse: false })} />{libelles[1]}</label>
          {(q.type !== 'oui_non' || objet.explication) && (
            <input type="text" placeholder={q.type === 'annexe' ? 'Nom du document, précision…' : 'Précisez…'} value={objet.explication ?? ''} disabled={dis}
              onChange={(e) => onChange({ ...objet, reponse: reponse ?? null, explication: e.target.value || undefined })} />
          )}
        </div>
      )
    }
    case 'contact':
      return (
        <div className="formulaire-contact">
          {CHAMPS_CONTACT.map(([k, l]) => (
            <input key={k} type="text" placeholder={l} aria-label={l} value={objet[k] ?? ''} disabled={dis}
              onChange={(e) => { const n = { ...objet, [k]: e.target.value || undefined }; onChange(Object.values(n).some(Boolean) ? n : null) }} />
          ))}
          {objet.responsable && <span className="aide">resp. {objet.responsable}</span>}
        </div>
      )
    default:
      return <textarea rows={1} value={typeof v === 'string' ? v : v == null ? '' : texteReponse(q, v)} disabled={dis} onChange={(e) => onChange(e.target.value || null)} />
  }
}

export default function FormulaireCommunal({ evenement, peut, toutPouvoir, setMessage, onChange }) {
  const [applicables, setApplicables] = useState([])
  const [choisi, setChoisi] = useState(null)
  const [formulaire, setFormulaire] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [ouvertes, setOuvertes] = useState(() => new Set())
  const [brouillons, setBrouillons] = useState({})
  const minuteries = useRef({})
  const peutEditer = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger(code = choisi) {
    const { data, error } = await supabase.rpc('formulaire_dossier', { p_evenement: evenement.id, p_formulaire: code })
    if (error) return setErreur(texteErreur(error))
    setErreur(null)
    const f = Array.isArray(data) ? data[0] : data
    setFormulaire(f)
    if (f?.formulaire?.code && f.formulaire.code !== choisi) setChoisi(f.formulaire.code)
    // Les sections où il manque une obligatoire s'ouvrent d'elles-mêmes la première fois.
    setOuvertes((o) => (o.size ? o : new Set((f?.obligatoires_manquantes ?? []).map((c) => Number(c.split('.')[0])))))
  }
  useEffect(() => {
    supabase.rpc('formulaires_applicables', { p_evenement: evenement.id }).then(({ data }) => setApplicables(data ?? []))
    setChoisi(null); setOuvertes(new Set()); setBrouillons({})
    charger(null)
  }, [evenement.id])
  useEffect(() => () => Object.values(minuteries.current).forEach(clearTimeout), [])

  function choisir(code) { setChoisi(code); setOuvertes(new Set()); setBrouillons({}); charger(code) }

  async function enregistrer(code, valeur) {
    const formulaire_id = formulaire?.formulaire?.id
    const { error } = valeur == null
      ? await supabase.from('formulaire_reponses').delete().eq('evenement_id', evenement.id).eq('formulaire_id', formulaire_id).eq('code', code)
      : await supabase.from('formulaire_reponses').upsert({ evenement_id: evenement.id, formulaire_id, code, valeur }, { onConflict: 'evenement_id,formulaire_id,code' })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setBrouillons((b) => { const n = { ...b }; delete n[code]; return n })
    await charger()
    onChange?.()
  }

  // Les textes attendent une seconde de silence avant de partir ; le reste part tout de suite.
  function changer(q, valeur) {
    setBrouillons((b) => ({ ...b, [q.code]: valeur }))
    clearTimeout(minuteries.current[q.code])
    const delai = ['texte', 'nombre', 'contact', 'oui_non_explication', 'annexe'].includes(q.type) ? 900 : 0
    minuteries.current[q.code] = setTimeout(() => enregistrer(q.code, valeur), delai)
  }

  if (erreur) return <p className="aide">Formulaires de demande : {erreur}</p>
  if (!formulaire) return null
  if (!formulaire.formulaire) {
    return (
      <div className="formulaire-communal">
        <div className="pave-titre">Formulaires de demande d'autorisation</div>
        <p className="vide">Aucun formulaire connu pour cette commune ni cette province. L'exploitant peut en ajouter un (Réglages › Formulaires).</p>
      </div>
    )
  }

  const f = formulaire.formulaire
  const questions = formulaire.questions ?? []
  const manquantes = new Set(formulaire.obligatoires_manquantes ?? [])
  const basculer = (s) => setOuvertes((o) => { const n = new Set(o); n.has(s) ? n.delete(s) : n.add(s); return n })
  // La date limite : N jours avant la mise en place (le montage, sinon le premier jour).
  const miseEnPlace = evenement.date_montage ?? evenement.date_debut
  const limite = f.delai_jours && miseEnPlace ? new Date(new Date(miseEnPlace).getTime() - f.delai_jours * 86400000) : null
  const joursRestants = limite ? Math.ceil((limite - new Date()) / 86400000) : null

  return (
    <div className="formulaire-communal">
      <div className="pave-titre">Formulaires de demande d'autorisation</div>
      {applicables.length > 1 && (
        <div className="formulaire-choix" role="tablist">
          {applicables.map((a) => (
            <button key={a.code} role="tab" aria-selected={a.code === f.code} className={`discret${a.code === f.code ? ' actif' : ''}`} onClick={() => choisir(a.code)}>
              {a.portee === 'commune' ? `Commune de ${a.commune}` : a.portee === 'province' ? `Province de ${a.province}` : 'Multidisciplinaire fédéral'}
            </button>
          ))}
        </div>
      )}
      <p className="formulaire-entete">
        <strong>{f.libelle}</strong>{f.version ? <span className="aide"> · {f.version}</span> : null}
        {f.autorite && <><br /><span className="aide">Demandé par : {f.autorite}</span></>}
        {f.delai_jours && (
          <><br /><span className={joursRestants != null && joursRestants < 0 ? 'formulaire-delai depasse' : 'formulaire-delai'}>
            À rentrer {f.delai_jours} jours avant la mise en place{limite ? `, soit avant le ${jour(limite)}` : ''}
            {joursRestants != null && (joursRestants < 0 ? ' — délai dépassé' : ` — dans ${joursRestants} jour${joursRestants > 1 ? 's' : ''}`)}
          </span>{f.delai_note && <span className="aide"> · {f.delai_note}</span>}</>
        )}
        {f.adresse_envoi && <><br /><span className="aide">Envoi : {f.adresse_envoi}</span></>}
        {f.notes && <><br /><span className="aide">{f.notes}</span></>}
      </p>
      <p className="formulaire-progres">
        <strong>{formulaire.repondues} / {formulaire.total}</strong> questions renseignées
        {manquantes.size > 0
          ? <span className="prc-jeton veille" style={{ marginLeft: 8 }}>{manquantes.size} obligatoire{manquantes.size > 1 ? 's' : ''} sans réponse</span>
          : <span className="prc-jeton ok" style={{ marginLeft: 8 }}>obligatoires complètes</span>}
        <span className="aide"> · ce qu'Eventware sait déjà est pré-rempli ; une saisie prime, et s'efface pour y revenir.</span>
      </p>
      {(formulaire.sections ?? []).map((s) => {
        const qs = questions.filter((q) => q.section === s.section)
        const faites = qs.filter((q) => q.valeur != null).length
        const manque = qs.filter((q) => manquantes.has(q.code)).length
        const ouverte = ouvertes.has(s.section)
        let sousSection = null
        return (
          <div key={s.section} className={`formulaire-section${ouverte ? ' ouverte' : ''}`}>
            <button className="lien formulaire-section-titre" onClick={() => basculer(s.section)} aria-expanded={ouverte}>
              {ouverte ? '▾' : '▸'} {s.section}. {s.titre}
              <span className="aide"> — {faites}/{qs.length}</span>
              {manque > 0 && <span className="prc-jeton veille"> {manque} à compléter</span>}
            </button>
            {ouverte && (
              <table className="tableau formulaire-questions">
                <tbody>
                  {qs.map((q) => {
                    const enCours = q.code in brouillons
                    const valeur = enCours ? brouillons[q.code] : q.saisie ?? q.prerempli ?? null
                    const preRempli = !enCours && q.saisie == null && q.prerempli != null
                    const titreSous = q.sous_section && q.sous_section !== sousSection ? (sousSection = q.sous_section) : null
                    return (
                      <Fragment key={q.code}>
                        {titreSous && <tr className="formulaire-sous-section"><th colSpan={3}>{titreSous}</th></tr>}
                        <tr className={manquantes.has(q.code) ? 'manquante' : ''}>
                          <td className="formulaire-code">{q.code}{q.obligatoire && <span title="obligatoire"> *</span>}</td>
                          <td className="formulaire-libelle">
                            {q.libelle}
                            {q.aide && <div className="aide">{q.aide}</div>}
                          </td>
                          <td className="formulaire-reponse">
                            <Reponse q={q} valeur={valeur} lectureSeule={!peutEditer} onChange={(v) => changer(q, v)} />
                            {preRempli && <span className="prc-jeton formulaire-prerempli" title={texteReponse(q, q.prerempli)}>pré-rempli par Eventware</span>}
                            {!preRempli && q.saisie != null && q.prerempli != null && peutEditer && (
                              <button className="lien aide" title={`Eventware propose : ${texteReponse(q, q.prerempli)}`} onClick={() => { clearTimeout(minuteries.current[q.code]); enregistrer(q.code, null) }}>
                                ↺ revenir au pré-rempli
                              </button>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
