import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Matrice radio.
 *
 * Deux objets distincts, souvent confondus sur le terrain :
 *   le CANAL appartient au dispositif — fréquence, sous-ton, usage ;
 *   l'INDICATIF appartient à la personne — il suit le porteur.
 *
 * Les confondre oblige à reprogrammer tous les postes dès qu'une équipe
 * change de titulaire.
 */

const BANDES = [
  ['pmr446', 'PMR446'],
  ['vhf', 'VHF'],
  ['uhf', 'UHF'],
  ['dmr', 'DMR'],
  ['autre', 'Autre']
]

export default function Radio({ evenement, setMessage }) {
  const [canaux, setCanaux] = useState([])
  const [postes, setPostes] = useState([])
  const [equipes, setEquipes] = useState([])
  const [edite, setEdite] = useState(null)
  const [vue, setVue] = useState('matrice')
  const [f, setF] = useState({
    numero: '',
    libelle: '',
    bande: 'pmr446',
    frequence_mhz: '',
    sous_ton: '',
    usage_prevu: ''
  })

  async function charger() {
    const [c, a, e] = await Promise.all([
      supabase
        .from('canaux_radio')
        .select('*')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('ordre'),
      supabase
        .from('attributions')
        .select('*')
        .eq('evenement_id', evenement.id)
        .eq('nature', 'radio')
        .is('deleted_at', null)
        .order('code'),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id)
    ])
    if (c.error) setMessage({ type: 'erreur', texte: c.error.message })
    else setCanaux(c.data ?? [])
    setPostes(a.data ?? [])
    setEquipes(e.data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!f.numero.trim() || !f.libelle.trim()) return
    const { error } = await supabase.from('canaux_radio').insert({
      evenement_id: evenement.id,
      ...f,
      frequence_mhz: f.frequence_mhz ? Number(f.frequence_mhz) : null,
      sous_ton: f.sous_ton || null,
      usage_prevu: f.usage_prevu || null,
      ordre: 100 + canaux.length
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ ...f, numero: '', libelle: '', frequence_mhz: '', sous_ton: '', usage_prevu: '' })
      charger()
    }
  }

  async function maj(id, champs) {
    const { error, count } = await supabase
      .from('canaux_radio')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else {
      setEdite(null)
      charger()
    }
  }

  async function majPoste(id, champs) {
    const { error } = await supabase.from('attributions').update(champs).eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  const urgence = canaux.filter((c) => c.canal_urgence)

  return (
    <>
      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['matrice', 'Canaux'],
          ['postes', `Postes (${postes.length})`],
          ['plan', 'Plan de programmation']
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

      {urgence.length === 0 && (
        <div className="message erreur">
          Aucun canal d'urgence déclaré. Un canal doit rester libre de tout trafic courant,
          sinon un appel prioritaire arrive dans une conversation en cours.
        </div>
      )}

      {/* ---------------- Canaux ---------------- */}

      {vue === 'matrice' && (
        <>
          <div className="saisie-rapide">
            <input
              value={f.numero}
              onChange={(e) => setF({ ...f, numero: e.target.value })}
              placeholder="N°"
              style={{ flex: '0 1 70px' }}
            />
            <input
              value={f.libelle}
              onChange={(e) => setF({ ...f, libelle: e.target.value })}
              placeholder="Usage — Sécurité, Logistique…"
            />
            <select
              value={f.bande}
              onChange={(e) => setF({ ...f, bande: e.target.value })}
              style={{ width: 'auto', marginBottom: 0 }}
            >
              {BANDES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input
              value={f.frequence_mhz}
              onChange={(e) => setF({ ...f, frequence_mhz: e.target.value })}
              placeholder="MHz"
              style={{ flex: '0 1 110px' }}
            />
            <input
              value={f.sous_ton}
              onChange={(e) => setF({ ...f, sous_ton: e.target.value })}
              placeholder="CTCSS / DCS"
              style={{ flex: '0 1 130px' }}
            />
            <button disabled={!f.numero.trim() || !f.libelle.trim()} onClick={creer}>
              Ajouter
            </button>
          </div>

          {canaux.length === 0 ? (
            <p className="vide">Aucun canal déclaré.</p>
          ) : (
            canaux.map((c) => (
              <div className={`carte ${c.canal_urgence ? 'urgent' : ''}`} key={c.id}>
                <div className="titre">
                  <span className="mono">CH {c.numero}</span> — {c.libelle}
                  {c.canal_urgence && <span className="jeton alerte-texte"> urgence</span>}
                  {!c.actif && <span className="jeton"> inactif</span>}
                </div>
                <div className="meta">
                  <span>{BANDES.find((b) => b[0] === c.bande)?.[1]}</span>
                  {c.frequence_mhz && (
                    <span className="mono">{Number(c.frequence_mhz).toFixed(4)} MHz</span>
                  )}
                  <span className="mono">{c.sous_ton ?? 'sans sous-ton'}</span>
                  {c.usage_prevu && <span>{c.usage_prevu}</span>}
                </div>

                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <select
                    value={c.equipe_id ?? ''}
                    onChange={(e) => maj(c.id, { equipe_id: e.target.value || null })}
                    style={{ width: 'auto', marginBottom: 0 }}
                  >
                    <option value="">— équipe —</option>
                    {equipes.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.code}
                      </option>
                    ))}
                  </select>
                  <button
                    className="discret"
                    onClick={() => maj(c.id, { canal_urgence: !c.canal_urgence })}
                  >
                    {c.canal_urgence ? "Retirer l'urgence" : "Marquer canal d'urgence"}
                  </button>
                  <button className="discret" onClick={() => maj(c.id, { actif: !c.actif })}>
                    {c.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                </div>
              </div>
            ))
          )}

          <p className="aide">
            Le sous-ton CTCSS ou DCS ne filtre que l'écoute : il ne chiffre rien. Le trafic
            reste audible de quiconque écoute la fréquence sans sous-ton. Rien de
            confidentiel ne passe par la radio.
          </p>
        </>
      )}

      {/* ---------------- Postes ---------------- */}

      {vue === 'postes' && (
        <>
          {postes.length === 0 ? (
            <p className="vide">
              Aucun poste attribué. Les postes se remettent depuis Logistique → Clés &amp;
              radios.
            </p>
          ) : (
            postes.map((p) => (
              <div className={`carte ${p.rendu_le ? '' : 'urgent'}`} key={p.id}>
                <div className="titre">
                  <span className="mono">{p.code}</span> — {p.libelle}
                </div>
                <div className="meta">
                  {p.porteur_libre && <span>chez {p.porteur_libre}</span>}
                  {p.rendu_le ? <span>rendu</span> : <span className="alerte-texte">en circulation</span>}
                </div>
                <div className="saisie-rapide" style={{ marginTop: 10 }}>
                  <input
                    defaultValue={p.indicatif ?? ''}
                    placeholder="Indicatif — ALPHA 3"
                    onBlur={(e) => majPoste(p.id, { indicatif: e.target.value || null })}
                    style={{ flex: '0 1 170px' }}
                  />
                  <select
                    value={p.canal_id ?? ''}
                    onChange={(e) => majPoste(p.id, { canal_id: e.target.value || null })}
                    style={{ width: 'auto', marginBottom: 0 }}
                  >
                    <option value="">— canal —</option>
                    {canaux.map((c) => (
                      <option key={c.id} value={c.id}>
                        CH {c.numero} · {c.libelle}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
          <p className="aide">
            L'indicatif suit la personne, pas le poste : quand un porteur change, on
            réattribue l'indicatif sans reprogrammer quoi que ce soit.
          </p>
        </>
      )}

      {/* ---------------- Plan de programmation ---------------- */}

      {vue === 'plan' && (
        <>
          <div className="ligne-boutons" style={{ marginBottom: 12 }}>
            <button className="discret" onClick={() => window.print()}>
              Imprimer / PDF
            </button>
          </div>

          <div className="imprimable">
            <h3 className="titre-impression">{evenement.nom} — plan de programmation radio</h3>
            <table className="sitrep-journal">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Usage</th>
                  <th>Bande</th>
                  <th>Fréquence</th>
                  <th>Sous-ton</th>
                </tr>
              </thead>
              <tbody>
                {canaux
                  .filter((c) => c.actif)
                  .map((c) => (
                    <tr key={c.id} className={c.canal_urgence ? 'majeur' : ''}>
                      <td className="mono nowrap">CH {c.numero}</td>
                      <td>
                        {c.libelle}
                        {c.canal_urgence && ' — RÉSERVÉ URGENCE'}
                      </td>
                      <td>{BANDES.find((b) => b[0] === c.bande)?.[1]}</td>
                      <td className="mono nowrap">
                        {c.frequence_mhz ? Number(c.frequence_mhz).toFixed(4) : '—'}
                      </td>
                      <td className="mono">{c.sous_ton ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <div className="sitrep-section">Indicatifs</div>
            <table className="sitrep-journal">
              <thead>
                <tr>
                  <th>Indicatif</th>
                  <th>Poste</th>
                  <th>Porteur</th>
                  <th>Canal</th>
                </tr>
              </thead>
              <tbody>
                {postes.map((p) => {
                  const c = canaux.find((x) => x.id === p.canal_id)
                  return (
                    <tr key={p.id}>
                      <td className="mono nowrap">{p.indicatif ?? '—'}</td>
                      <td className="mono">{p.code}</td>
                      <td>{p.porteur_libre ?? '—'}</td>
                      <td className="mono nowrap">{c ? `CH ${c.numero}` : '—'}</td>
                    </tr>
                  )
                })}
                {postes.length === 0 && (
                  <tr>
                    <td colSpan="4">Aucun poste attribué.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="aide">
            Feuille à afficher au PC et à remettre avec les postes. Elle contient tout ce
            qu'il faut pour reprogrammer un appareil perdu ou remplacé.
          </p>
        </>
      )}
    </>
  )
}
