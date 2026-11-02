import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { telechargerNotificationDmpPdf } from './exportNotificationDmpPdf'

/**
 * NOTIFICATION DU DISPOSITIF MÉDICAL PRÉVENTIF — CoAMU & CU 112 (165).
 *
 * Le formulaire v1.6 (février 2025) des clusters BHN-LILU, pré-rempli
 * par ce qu'Eventware sait (nom, nature PRIMA, créneaux du programme,
 * prestataire et responsable depuis les contacts, effectifs, postes,
 * adresses), complété ici, exporté en PDF au format du document, et
 * marqué envoyé. À transmettre au plus tard 10 jours ouvrés avant
 * l'événement à la CoAMU de la province et à la CU 112.
 */
export const CATEGORIES_PERSONNEL = [
  ['infirmier', 'Infirmier(ère)s', true], ['infirmier_sisu', 'Infirmiers titrés SISU', true],
  ['medecin_generaliste', 'Médecin généraliste', true], ['medecin_specialise', 'Médecin spécialisé', true],
  ['medecin_urgentiste', 'Médecin SMA, SMU, TPPSU', true], ['secouriste_ambulancier', 'Secouristes-ambulanciers', true],
  ['secouriste', 'Secouristes', false], ['equipe_intervention', 'Équipe(s) d’intervention', false]
]
export const MOYENS = [['poste_soins', 'Poste de soins / secours'], ['poste_medicalise', 'Poste de secours médicalisé'], ['poste_medico_chir', 'Poste de secours médico-chirurgical'], ['autre', 'Autre']]
export const VECTEURS = [['vsl', 'VSL'], ['ambulance_atnup', 'Ambulance ATNUP'], ['ambulance_112', 'Ambulance 112 *'], ['pit', 'PIT'], ['smur', 'SMUR']]
export const ADRESSES = [['acces_public', 'Accès public'], ['acces_secours', 'Accès secours'], ['poste_soins', 'Poste de soins']]
const DOCUMENTS = ['dossier de présentation', 'plan(s) d’implantation du site', 'plan(s) de sécurité', 'itinéraire (circuit)', 'plan de mobilité (accès, IN-OUT, …)', 'localisation du/des poste(s) de soins', 'dossier de sécurité Eventware']
const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-BE') : '')

export default function NotificationDmp({ evenement, peut, toutPouvoir, setMessage, onChange }) {
  const [n, setN] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [ouverte, setOuverte] = useState(false)
  const [brouillon, setBrouillon] = useState({})
  const enAttente = useRef({})
  const minuterie = useRef(null)
  const peutSaisir = toutPouvoir || peut?.('referentiels', 'creer')

  async function charger() {
    const { data, error } = await supabase.rpc('notification_dmp', { p_evenement: evenement.id })
    if (error) return setErreur(texteErreur(error))
    setErreur(null)
    setN(Array.isArray(data) ? data[0] : data)
  }
  useEffect(() => { charger(); setBrouillon({}) }, [evenement.id])
  useEffect(() => () => clearTimeout(minuterie.current), [])

  async function enregistrer(champs) {
    const { error } = await supabase.from('notifications_dmp').upsert({ evenement_id: evenement.id, ...champs }, { onConflict: 'evenement_id' })
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    setBrouillon((b) => { const r = { ...b }; Object.keys(champs).forEach((k) => delete r[k]); return r })
    await charger()
    onChange?.()
  }
  // Une saisie attend une seconde de silence ; une liste part tout de suite. Tout ce qui attend part ensemble.
  function changer(champ, valeur, differe = true) {
    enAttente.current = { ...enAttente.current, [champ]: valeur }
    setBrouillon((b) => ({ ...b, [champ]: valeur }))
    clearTimeout(minuterie.current)
    minuterie.current = setTimeout(() => {
      const champs = enAttente.current
      enAttente.current = {}
      enregistrer(champs)
    }, differe ? 900 : 0)
  }
  const val = (champ) => (champ in brouillon ? brouillon[champ] : n?.[champ])
  const pre = (champ) => n?.preremplis?.includes(champ) && !(champ in brouillon)

  async function marquerEnvoyee() {
    const a = window.prompt('Envoyée à (adresses) :', [n.destinataires?.coamu, n.destinataires?.cu112].filter(Boolean).join(', '))
    if (a === null) return
    await enregistrer({ envoyee_le: new Date().toISOString(), envoyee_a: a || null })
  }

  if (erreur) return <p className="aide">Notification DMP : {erreur}</p>
  if (!n) return null

  const depassee = n.date_limite && new Date(n.date_limite) < new Date()
  const badge = (champ) => (pre(champ) ? <span className="prc-jeton prima-source" title="déduit des données Eventware">Eventware</span> : null)
  // Des fonctions, pas des composants : un composant défini ici serait recréé à chaque rendu et perdrait le focus à chaque frappe.
  const texte = (champ, libelle) => (
    <label key={champ}>
      {libelle}
      <input type="text" value={val(champ) ?? ''} disabled={!peutSaisir} onChange={(e) => changer(champ, e.target.value || null)} />
      {badge(champ)}
    </label>
  )
  const objet = (champ, cle, libelle) => (
    <label key={`${champ}-${cle}`}>
      {libelle}
      <input type="text" value={val(champ)?.[cle] ?? ''} disabled={!peutSaisir} onChange={(e) => changer(champ, { ...(val(champ) ?? {}), [cle]: e.target.value || undefined })} />
    </label>
  )
  const liste = (champ, colonnes, vide) => {
    const lignes = val(champ) ?? []
    const maj = (i, k, v) => changer(champ, lignes.map((l, j) => (j === i ? { ...l, [k]: v || undefined } : l)))
    return (
      <table className="tableau notif-liste" key={champ}>
        <thead><tr>{colonnes.map(([k, l]) => <th key={k}>{l}</th>)}{peutSaisir && <th></th>}</tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              {colonnes.map(([k, , type, options]) => (
                <td key={k}>
                  {type === 'select'
                    ? <select value={l[k] ?? ''} disabled={!peutSaisir} onChange={(e) => maj(i, k, e.target.value)}>{options.map(([c, lib]) => <option key={c} value={c}>{lib}</option>)}</select>
                    : <input type={type ?? 'text'} value={l[k] ?? ''} disabled={!peutSaisir} onChange={(e) => maj(i, k, e.target.value)} />}
                </td>
              ))}
              {peutSaisir && <td><button className="discret" aria-label="Retirer" onClick={() => changer(champ, lignes.filter((_, j) => j !== i), false)}>×</button></td>}
            </tr>
          ))}
          {!lignes.length && <tr><td colSpan={colonnes.length + 1} className="aide">{vide}</td></tr>}
        </tbody>
      </table>
    )
  }
  const ajouter = (champ, ligne) => changer(champ, [...(val(champ) ?? []), ligne], false)

  return (
    <div className="notification-dmp">
      <div className="pave-titre">Notification du dispositif médical préventif — CoAMU & CU 112</div>
      <p className="notif-resume">
        {n.envoyee_le
          ? <span className="prc-jeton ok">envoyée le {jour(n.envoyee_le)}{n.envoyee_a ? ` à ${n.envoyee_a}` : ''}</span>
          : <span className={`prc-jeton ${depassee ? 'chaud' : n.complete ? 'veille' : 'veille'}`}>{n.complete ? 'prête à envoyer' : 'à compléter'}</span>}
        {n.date_limite && <span className={`notif-delai${depassee ? ' depasse' : ''}`}> · au plus tard 10 jours ouvrés avant l'événement : <strong>{jour(n.date_limite)}</strong>{depassee ? ' — délai dépassé' : n.jours_ouvres_restants != null ? ` (dans ${n.jours_ouvres_restants} jour${n.jours_ouvres_restants > 1 ? 's' : ''} ouvré${n.jours_ouvres_restants > 1 ? 's' : ''})` : ''}</span>}
        {n.niveau_dossier != null && <span className="aide"> · niveau {n.niveau_dossier} au dernier dépôt</span>}
      </p>
      <p className="aide">
        À envoyer par le CPU ou l'autorité à la CoAMU{n.destinataires?.coamu ? ` (${n.destinataires.coamu})` : ' de la province'} et à la CU 112 ({n.destinataires?.cu112}), avec les documents joints. Passé le délai, le formulaire n'est pas pris en considération.
      </p>
      <div className="ligne-boutons">
        <button className="discret" onClick={() => setOuverte(!ouverte)}>{ouverte ? 'Replier' : 'Compléter la notification'}</button>
        <button className="discret" onClick={() => telechargerNotificationDmpPdf({ evenement, notification: n })}>Télécharger le PDF (formulaire v1.6)</button>
        {peutSaisir && !n.envoyee_le && <button className="discret" onClick={marquerEnvoyee}>Marquer comme envoyée</button>}
        {peutSaisir && n.envoyee_le && <button className="discret" onClick={() => enregistrer({ envoyee_le: null, envoyee_a: null })}>Annuler l'envoi</button>}
      </div>

      {ouverte && (
        <div className="formulaire notif-formulaire">
          <div className="pave-titre">Informations générales</div>
          <div className="grille-2">
            <label>Nom complet de l'événement<input type="text" value={n.nom ?? ''} disabled /></label>
            {texte('nature', "Nature de l'événement")}
          </div>
          <div className="aide">Dates et heures : accès au public, et dispositif médical préventif opérationnel.{badge('creneaux')}</div>
          {liste('creneaux', [['date', 'Date', 'date'], ['acces_debut', 'Public : début', 'time'], ['acces_fin', 'Public : fin', 'time'], ['dmp_debut', 'DMP : début', 'time'], ['dmp_fin', 'DMP : fin', 'time']], "Aucun créneau.")}
          {peutSaisir && <button className="discret" onClick={() => ajouter('creneaux', { date: evenement.date_debut })}>+ Créneau</button>}
          <div className="notif-documents">
            <span className="aide">Je joins les documents suivants :{badge('documents')}</span>
            {DOCUMENTS.map((d) => (
              <label key={d}><input type="checkbox" checked={(val('documents') ?? []).includes(d)} disabled={!peutSaisir}
                onChange={(e) => changer('documents', e.target.checked ? [...(val('documents') ?? []), d] : (val('documents') ?? []).filter((x) => x !== d), false)} />{d}</label>
            ))}
          </div>

          <div className="pave-titre">Partie I — CoAMU : moyens de secours médicaux mis en œuvre</div>
          <div className="grille-2">
            <label>Prestataire de soins
              <select value={val('prestataire_interne') == null ? '' : val('prestataire_interne') ? 'interne' : 'externe'} disabled={!peutSaisir}
                onChange={(e) => changer('prestataire_interne', e.target.value === '' ? null : e.target.value === 'interne', false)}>
                <option value="">—</option><option value="interne">Interne</option><option value="externe">Externe</option>
              </select>
            </label>
            {texte('prestataire_nom', "Nom du prestataire de soins")}
            {texte('contact_nom', "Personne de contact")}
            {texte('contact_gsm', "GSM")}
          </div>
          <div className="aide">Responsable du DMP{badge('responsable_dmp')}</div>
          <div className="grille-4">
            {objet('responsable_dmp', 'nom', "Nom")}{objet('responsable_dmp', 'prenom', "Prénom")}
            {objet('responsable_dmp', 'nn', "N° national")}{objet('responsable_dmp', 'gsm', "GSM")}
          </div>
          <div className="aide">Médecin coordinateur</div>
          <div className="grille-4">
            {objet('medecin_coordinateur', 'nom', "Nom")}{objet('medecin_coordinateur', 'prenom', "Prénom")}
            {objet('medecin_coordinateur', 'nn', "N° national")}{objet('medecin_coordinateur', 'gsm', "GSM")}
            {objet('medecin_coordinateur', 'inami', "N° INAMI")}
          </div>
          <div className="aide">Personnel engagé — nombre par catégorie{badge('effectifs')} ; les catégories marquées * se complètent nominativement (vérification par la CoAMU).</div>
          <div className="grille-4">
            {CATEGORIES_PERSONNEL.map(([k, l, nominatif]) => (
              <label key={k}>{l}{nominatif ? ' *' : ''}
                <input type="number" min="0" value={val('effectifs')?.[k] ?? ''} disabled={!peutSaisir} onChange={(e) => changer('effectifs', { ...(val('effectifs') ?? {}), [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
            ))}
          </div>
          {liste('personnel', [['categorie', 'Catégorie', 'select', CATEGORIES_PERSONNEL.map(([k, l]) => [k, l])], ['nom', 'Nom'], ['prenom', 'Prénom'], ['num_nat', 'N° national'], ['badge', 'Badge / visa / INAMI']], "Aucune personne nommée.")}
          {peutSaisir && <button className="discret" onClick={() => ajouter('personnel', { categorie: 'secouriste_ambulancier' })}>+ Personne</button>}
          <div className="aide">Moyens engagés (pour information){badge('moyens')}</div>
          <table className="tableau notif-liste">
            <thead><tr><th>Moyen</th><th>Fixes</th><th>Mobiles</th></tr></thead>
            <tbody>
              {MOYENS.map(([k, l]) => (
                <tr key={k}>
                  <td>{k === 'autre' ? <input type="text" placeholder="Autre : préciser" value={val('moyens')?.autre?.libelle ?? ''} disabled={!peutSaisir} onChange={(e) => changer('moyens', { ...(val('moyens') ?? {}), autre: { ...(val('moyens')?.autre ?? {}), libelle: e.target.value || undefined } })} /> : l}</td>
                  {['fixes', 'mobiles'].map((c) => (
                    <td key={c}><input type="number" min="0" className="prima-nombre" value={val('moyens')?.[k]?.[c] ?? ''} disabled={!peutSaisir}
                      onChange={(e) => changer('moyens', { ...(val('moyens') ?? {}), [k]: { ...(val('moyens')?.[k] ?? {}), [c]: e.target.value === '' ? undefined : Number(e.target.value) } })} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="aide">Vecteurs engagés (* : vérifiés par la CoAMU)</div>
          <div className="grille-4">
            {VECTEURS.map(([k, l]) => (
              <label key={k}>{l}<input type="number" min="0" value={val('vecteurs')?.[k] ?? ''} disabled={!peutSaisir} onChange={(e) => changer('vecteurs', { ...(val('vecteurs') ?? {}), [k]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
            ))}
          </div>
          <label>Informations complémentaires utiles à la bonne gestion des secours{badge('informations')}
            <textarea rows={2} value={val('informations') ?? ''} disabled={!peutSaisir} onChange={(e) => changer('informations', e.target.value || null)} />
          </label>

          <div className="pave-titre">Partie II — CU 112</div>
          <div className="aide">Adresses postales des lieux concernés{badge('adresses')}</div>
          <table className="tableau notif-liste">
            <thead><tr><th>Lieu</th><th>Rue(s) n°</th><th>Code postal</th><th>Localité</th></tr></thead>
            <tbody>
              {ADRESSES.map(([k, l]) => (
                <tr key={k}>
                  <td>{l}</td>
                  {['rue', 'cp', 'localite'].map((c) => (
                    <td key={c}><input type="text" value={val('adresses')?.[k]?.[c] ?? ''} disabled={!peutSaisir}
                      onChange={(e) => changer('adresses', { ...(val('adresses') ?? {}), [k]: { ...(val('adresses')?.[k] ?? {}), [c]: e.target.value || undefined } })} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="aide">Ambulances agréées par le SPF Santé publique</div>
          {liste('ambulances_112', [['indicatif', 'Indicatif radio'], ['plaque', 'Plaque'], ['issi', 'ISSI ASTRID'], ['gsm', 'GSM']], "Aucune ambulance agréée 112.")}
          {peutSaisir && <button className="discret" onClick={() => ajouter('ambulances_112', {})}>+ Ambulance 112</button>}
          <div className="aide">SMUR pour interventions et évacuations vers les hôpitaux</div>
          {liste('smur', [['indicatif', 'Indicatif radio'], ['plaque', 'Plaque'], ['issi', 'ISSI ASTRID'], ['gsm', 'GSM']], "Aucun SMUR.")}
          {peutSaisir && <button className="discret" onClick={() => ajouter('smur', {})}>+ SMUR</button>}
          <p className="aide">{n.version}.</p>
        </div>
      )}
    </div>
  )
}
