import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'
import { useDrapeau } from './useDrapeau'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * Le lien participant, et ses QR codes.
 *
 * Un lien générique pour tout l'événement — la vitrine : infos,
 * horaire, plan — et, quand le module SOS participants est actif, un
 * QR par lieu. Le second est ce qui rend le signalement utile : quand
 * le participant scanne le QR collé sur le bloc sanitaire 3, le PC sait
 * où c'est sans que personne n'ait à décrire quoi que ce soit — et sans
 * dépendre du GPS, qui est justement mauvais à l'intérieur.
 *
 * Sans le module SOS, la vitrine existe quand même : le lien se copie,
 * le QR générique s'imprime, la planche dit « programme et plan » au
 * lieu de « signalez-le ».
 */
export default function QrCodes({ evenement }) {
  const [lieux, setLieux] = useState([])
  const [choisis, setChoisis] = useState([])
  const [taille, setTaille] = useState(150)
  const [copie, setCopie] = useDrapeau(2000)

  const sos = !!evenement.modules?.sos_participants
  const base = `${window.location.origin}${window.location.pathname}?sos=${evenement.jeton_public}`

  useEffect(() => {
    if (!sos) return
    supabase
      .from('lieux')
      .select('id, code, nom, type, pk_km')
      .eq('evenement_id', evenement.id)
      .order('code')
      .then(({ data }) => setLieux(data ?? []))
  }, [evenement.id, sos])

  function basculer(code) {
    setChoisis((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]))
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(base)
      setCopie()
    } catch {
      /* Sans presse-papiers (http://, ancien navigateur), le lien reste
         sélectionnable dans le champ juste au-dessus. */
    }
  }

  const planches = [
    { code: null, nom: evenement.nom, url: base },
    ...lieux
      .filter((l) => choisis.includes(l.code))
      .map((l) => ({
        code: l.code,
        nom: l.nom,
        url: `${base}&lieu=${encodeURIComponent(l.code)}`
      }))
  ]

  return (
    <div className="qr">
      <h2>{sos ? 'Lien participant et QR de signalement' : 'Lien participant'}</h2>

      <p className="aide">
        {sos
          ? "Le QR générique vaut pour tout l'événement. Un QR par lieu transmet la position sans dépendre du GPS — décisif à l'intérieur d'un bloc sanitaire, où le GPS ne vaut rien."
          : "Ce lien ouvre la vitrine — infos, horaire, plan — sans compte. Le signalement participant n'est pas actif sur cet événement : la page ne propose pas de formulaire."}
      </p>

      <label htmlFor="lien-participant">Lien à diffuser</label>
      <div className="saisie-rapide">
        <input id="lien-participant" className="mono" value={base} readOnly onFocus={(e) => e.target.select()} />
        <button className="discret" onClick={copier}>
          {copie ? 'Copié ✓' : 'Copier'}
        </button>
        <a className="lien-externe" href={base} target="_blank" rel="noreferrer">
          Ouvrir
        </a>
      </div>

      {sos && (
        <>
          <label>Lieux à imprimer</label>
          <div className="ligne-boutons" style={{ marginBottom: 12 }}>
            {lieux.length === 0 && <span className="vide">Aucun lieu encodé.</span>}
            {lieux.map((l) => (
              <button
                key={l.id}
                className={`module ${choisis.includes(l.code) ? 'actif' : ''}`}
                onClick={() => basculer(l.code)}
              >
                {l.code}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="ligne-boutons" style={{ marginBottom: 14 }}>
        {sos && (
          <>
            <button
              className="discret"
              onClick={() => setChoisis(lieux.map((l) => l.code))}
            >
              Tout sélectionner
            </button>
            <button className="discret" onClick={() => setChoisis([])}>
              Aucun
            </button>
          </>
        )}
        <select
          value={taille}
          onChange={(e) => setTaille(Number(e.target.value))}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value={110}>Petit</option>
          <option value={150}>Moyen</option>
          <option value={210}>Grand</option>
        </select>
        <button className="discret" onClick={() => window.print()}>
          Imprimer
        </button>
      </div>

      <div className="imprimable planches">
        {planches.map((p) => (
          <div className="planche" key={p.code ?? 'general'}>
            <div className="planche-titre">
              {sos ? 'Un problème ? Signalez-le' : 'Programme, plan, infos'}
            </div>
            <QRCodeSVG value={p.url} size={taille} level="M" includeMargin />
            <div className="planche-lieu">
              {p.code ? (
                <>
                  <strong>{p.nom}</strong>
                  <br />
                  <span className="mono">{p.code}</span>
                </>
              ) : (
                <strong>{p.nom}</strong>
              )}
            </div>
            <div className="planche-pied">
              Scannez — aucune application à installer
              {sos && (
                <>
                  <br />
                  <strong>Urgence vitale : appelez le 112</strong>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* (168) Le QR du poste : un par poste, pour le bénévole qui arrive. */}
      <QrPostes evenement={evenement} taille={taille} />
    </div>
  )
}

/**
 * (168) Le QR du poste. Un jeton par poste (distinct des créneaux),
 * généré depuis le planning ; la planche se colle sur le bar, le stand
 * jetons, la barrière. La page qu'il ouvre ne montre ni nom ni numéro
 * personnel — seul le numéro du QG, saisi ici, y figure.
 */
function QrPostes({ evenement, taille }) {
  const [postes, setPostes] = useState([])
  const [fiches, setFiches] = useState([])
  const [lieux, setLieux] = useState([])
  const [choisis, setChoisis] = useState([])
  const [telephoneQg, setTelephoneQg] = useState(evenement.telephone_qg ?? '')
  const [occupe, setOccupe] = useState(false)
  const [message, setMessage] = useState(null)

  async function charger() {
    const [p, f, l] = await Promise.all([
      supabase.from('postes_qr').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('poste'),
      supabase.from('fiches_poste').select('id, intitule').eq('evenement_id', evenement.id).is('deleted_at', null).order('intitule'),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id).is('deleted_at', null).order('nom')
    ])
    setPostes(p.data ?? [])
    setFiches(f.data ?? [])
    setLieux(l.data ?? [])
  }
  useEffect(() => {
    charger()
  }, [evenement.id])

  async function generer() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('generer_postes_qr', { p_evenement: evenement.id })
    setOccupe(false)
    if (error) return setMessage({ type: 'erreur', texte: texteErreur(error) })
    const n = Number(Array.isArray(data) ? data[0] : data) || 0
    setMessage({ type: 'succes', texte: n ? `${n} poste${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} depuis les créneaux.` : 'Tous les postes du planning ont déjà leur QR.' })
    charger()
  }
  async function modifier(p, champs) {
    const refus = await modifierOuRefuser('postes_qr', champs, { id: p.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }
  async function enregistrerTelephone() {
    const v = telephoneQg.trim() || null
    if (v === (evenement.telephone_qg ?? null)) return
    const refus = await modifierOuRefuser('evenements', { telephone_qg: v }, { id: evenement.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else setMessage({ type: 'succes', texte: v ? `Numéro du QG affiché sur les pages de poste : ${v}.` : 'Plus aucun numéro sur les pages de poste.' })
  }

  const base = `${window.location.origin}${window.location.pathname}?poste=`
  const basculer = (id) => setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const sansFiche = postes.filter((p) => !p.fiche_id).length

  return (
    <div className="qr-postes">
      <h2>QR du poste</h2>
      <p className="aide">
        Un QR par poste, collé sur place : le bénévole qui arrive y lit sa fiche, son créneau, le canal radio,
        le DEA et la sortie de secours les plus proches, les fiches réflexe et le numéro du QG. Sans compte.
        La page ne montre jamais un nom ni un numéro personnel.
      </p>
      {message && <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>{message.texte}</div>}

      <label htmlFor="telephone-qg">Numéro du QG affiché sur la page (le seul)</label>
      <div className="saisie-rapide">
        <input id="telephone-qg" value={telephoneQg} placeholder="0470 00 00 00" onChange={(e) => setTelephoneQg(e.target.value)} onBlur={enregistrerTelephone} style={{ maxWidth: 220 }} />
        <button className="discret" disabled={occupe} onClick={generer}>{occupe ? 'Génération…' : 'Générer les QR depuis les créneaux'}</button>
      </div>

      {postes.length === 0 ? (
        <p className="vide">Aucun poste : génère-les depuis les créneaux du planning (Bénévoles).</p>
      ) : (
        <>
          {sansFiche > 0 && <p className="aide alerte-texte">{sansFiche} poste{sansFiche > 1 ? 's' : ''} sans fiche : la page dira « demande les consignes au QG ».</p>}
          <table className="qr-postes-table">
            <thead>
              <tr><th>Poste</th><th>Fiche</th><th>Lieu</th><th>Accès</th><th>Actif</th><th>Imprimer</th></tr>
            </thead>
            <tbody>
              {postes.map((p) => (
                <tr key={p.id} className={p.actif ? '' : 'inactif'}>
                  <td><strong>{p.poste}</strong><br /><a className="lien-externe" href={`${base}${p.jeton}`} target="_blank" rel="noreferrer">ouvrir la page</a></td>
                  <td>
                    <select value={p.fiche_id ?? ''} onChange={(e) => modifier(p, { fiche_id: e.target.value || null })} aria-label={`Fiche du poste ${p.poste}`}>
                      <option value="">— aucune —</option>
                      {fiches.map((f) => <option key={f.id} value={f.id}>{f.intitule}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={p.lieu_id ?? ''} onChange={(e) => modifier(p, { lieu_id: e.target.value || null })} aria-label={`Lieu du poste ${p.poste}`}>
                      <option value="">— aucun —</option>
                      {lieux.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
                    </select>
                  </td>
                  <td className="mono">{p.nb_acces ?? 0}</td>
                  <td><input type="checkbox" checked={!!p.actif} onChange={(e) => modifier(p, { actif: e.target.checked })} aria-label={`QR actif pour ${p.poste}`} /></td>
                  <td><input type="checkbox" checked={choisis.includes(p.id)} onChange={() => basculer(p.id)} aria-label={`Imprimer le QR de ${p.poste}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ligne-boutons" style={{ margin: '8px 0 14px' }}>
            <button className="discret" onClick={() => setChoisis(postes.filter((p) => p.actif).map((p) => p.id))}>Tout sélectionner</button>
            <button className="discret" onClick={() => setChoisis([])}>Aucun</button>
            <button className="discret" onClick={() => window.print()}>Imprimer</button>
          </div>
          <div className="imprimable planches">
            {postes.filter((p) => choisis.includes(p.id)).map((p) => (
              <div className="planche planche-poste" key={p.id}>
                <div className="planche-titre">Ton poste : scanne-moi</div>
                <QRCodeSVG value={`${base}${p.jeton}`} size={taille} level="M" includeMargin />
                <div className="planche-lieu">
                  <strong>{p.poste}</strong>
                  {p.lieu_id && <><br />{lieux.find((l) => l.id === p.lieu_id)?.nom}</>}
                </div>
                <div className="planche-pied">
                  Fiche, créneau, canal radio, secours proches — aucune application à installer
                  <br />
                  <strong>Urgence vitale : appelez le 112</strong>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
