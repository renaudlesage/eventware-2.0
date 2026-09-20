import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'

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
  const [copie, setCopie] = useState(false)

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
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
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
    </div>
  )
}
