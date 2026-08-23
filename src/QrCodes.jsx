import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'

/**
 * QR codes de signalement.
 *
 * Un QR générique pour tout l'événement, et un QR par lieu. Le second
 * est ce qui rend le signalement utile : quand le participant scanne
 * le QR collé sur le bloc sanitaire 3, le PC sait où c'est sans que
 * personne n'ait à décrire quoi que ce soit — et sans dépendre du GPS,
 * qui est justement mauvais à l'intérieur.
 */
export default function QrCodes({ evenement }) {
  const [lieux, setLieux] = useState([])
  const [choisis, setChoisis] = useState([])
  const [taille, setTaille] = useState(150)

  const base = `${window.location.origin}${window.location.pathname}?sos=${evenement.jeton_public}`

  useEffect(() => {
    supabase
      .from('lieux')
      .select('id, code, nom, type, pk_km')
      .eq('evenement_id', evenement.id)
      .order('code')
      .then(({ data }) => setLieux(data ?? []))
  }, [evenement.id])

  function basculer(code) {
    setChoisis((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]))
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
      <h2>QR de signalement</h2>

      <p className="aide">
        Le QR générique vaut pour tout l'événement. Un QR par lieu transmet la position sans
        dépendre du GPS — décisif à l'intérieur d'un bloc sanitaire, où le GPS ne vaut rien.
      </p>

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

      <div className="ligne-boutons" style={{ marginBottom: 14 }}>
        <button
          className="discret"
          onClick={() => setChoisis(lieux.map((l) => l.code))}
        >
          Tout sélectionner
        </button>
        <button className="discret" onClick={() => setChoisis([])}>
          Aucun
        </button>
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
            <div className="planche-titre">Un problème ? Signalez-le</div>
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
              <br />
              <strong>Urgence vitale : appelez le 112</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
