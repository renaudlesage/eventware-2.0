import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/*
 * `besoin` : capacité d'encadrement requise.
 * Un bénévole ne voit que ses propres créneaux — la couverture globale,
 * la liste de l'équipe et les jalons ne le concernent pas.
 */
const ONGLETS = [
  ['couverture', 'Couverture', true],
  ['mes_creneaux', 'Mes créneaux', false],
  ['equipe', 'Bénévoles', true],
  ['jalons', 'Jalons', true]
]

const heure = (d) =>
  new Date(d).toLocaleString('fr-BE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

export default function Rh({ evenement, membre, peut }) {
  const encadrement = peut ? peut('rh', 'creer') : true
  const visibles = ONGLETS.filter(([, , besoin]) => !besoin || encadrement)
  const [onglet, setOnglet] = useState(encadrement ? 'couverture' : 'mes_creneaux')
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!visibles.some(([k]) => k === onglet)) setOnglet('mes_creneaux')
  }, [encadrement])

  return (
    <div className="bloc securite">
      <h2>Bénévoles</h2>

      {visibles.length > 1 && (
        <div className="onglets">
          {visibles.map(([k, l]) => (
            <button
              key={k}
              className={`module ${onglet === k ? 'actif' : ''}`}
              onClick={() => setOnglet(k)}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'couverture' && (
        <Couverture evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'mes_creneaux' && (
        <MesCreneaux evenement={evenement} membre={membre} setMessage={setMessage} />
      )}
      {onglet === 'equipe' && <Equipe evenement={evenement} setMessage={setMessage} />}
      {onglet === 'jalons' && <Jalons evenement={evenement} setMessage={setMessage} />}
    </div>
  )
}

/* ================================================================== */
/* Couverture des créneaux                                             */
/* ================================================================== */

function Couverture({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [detail, setDetail] = useState(null)
  const [membres, setMembres] = useState([])
  const [aVenir, setAVenir] = useState(true)
  const [f, setF] = useState({ code: '', poste: '', besoin: 2, debut: '', fin: '' })
  const [ouvrir, setOuvrir] = useState(false)

  async function charger() {
    const [c, m] = await Promise.all([
      supabase.rpc('couverture_creneaux', {
        p_evenement: evenement.id,
        p_depuis: aVenir ? new Date().toISOString() : null
      }),
      supabase
        .from('membres_evenement')
        .select('id, nom_affiche, role')
        .eq('evenement_id', evenement.id)
    ])
    if (c.error) setMessage({ type: 'erreur', texte: c.error.message })
    else setLignes(c.data ?? [])
    setMembres(m.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 30000)
    return () => clearInterval(t)
  }, [evenement.id, aVenir])

  async function creer() {
    if (!f.code.trim() || !f.poste.trim() || !f.debut || !f.fin) return
    const { error } = await supabase.from('creneaux').insert({
      evenement_id: evenement.id,
      code: f.code.trim(),
      poste: f.poste.trim(),
      besoin: Number(f.besoin) || 1,
      debut: new Date(f.debut).toISOString(),
      fin: new Date(f.fin).toISOString(),
      phase: evenement.phase
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ code: '', poste: '', besoin: 2, debut: '', fin: '' })
      setOuvrir(false)
      charger()
    }
  }

  async function affecter(creneauId, membreId) {
    const { error } = await supabase.from('affectations').insert({
      evenement_id: evenement.id,
      creneau_id: creneauId,
      membre_id: membreId,
      statut: 'propose'
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  const decouverts = lignes.filter((l) => l.manque > 0)
  const totalManque = decouverts.reduce((n, l) => n + l.manque, 0)

  return (
    <>
      <div className="compteurs">
        <span>
          Créneaux <strong>{lignes.length}</strong>
        </span>
        <span className={totalManque ? 'alerte-texte' : ''}>
          Postes non couverts <strong>{totalManque}</strong>
        </span>
      </div>

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button className="discret" onClick={() => setAVenir(!aVenir)}>
          {aVenir ? 'Afficher les passés' : 'À venir seulement'}
        </button>
        <button className="discret" onClick={() => setOuvrir(!ouvrir)}>
          {ouvrir ? 'Fermer' : 'Nouveau créneau'}
        </button>
      </div>

      {ouvrir && (
        <div className="formulaire">
          <div className="saisie-rapide">
            <input
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              placeholder="Code"
              style={{ flex: '0 1 90px' }}
            />
            <input
              value={f.poste}
              onChange={(e) => setF({ ...f, poste: e.target.value })}
              placeholder="Poste"
            />
            <input
              type="number"
              min="1"
              value={f.besoin}
              onChange={(e) => setF({ ...f, besoin: e.target.value })}
              style={{ flex: '0 1 80px' }}
            />
          </div>
          <div className="saisie-rapide">
            <input
              type="datetime-local"
              value={f.debut}
              onChange={(e) => setF({ ...f, debut: e.target.value })}
            />
            <input
              type="datetime-local"
              value={f.fin}
              onChange={(e) => setF({ ...f, fin: e.target.value })}
            />
            <button onClick={creer}>Créer</button>
          </div>
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="vide">Aucun créneau.</p>
      ) : (
        lignes.map((l) => (
          <div className={`carte ${l.manque > 0 ? 'urgent' : ''}`} key={l.creneau_id}>
            <div className="titre">
              <span className="mono">{l.code}</span> — {l.poste}
            </div>
            <div className="meta">
              <span>
                {heure(l.debut)} → {new Date(l.fin).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              {l.lieu && <span>{l.lieu}</span>}
              <span>
                <strong>{l.confirmes}</strong>/{l.besoin} confirmé(s)
              </span>
              {l.proposes > 0 && <span>{l.proposes} proposé(s)</span>}
              {l.manque > 0 && (
                <span className="alerte-texte">
                  <strong>manque {l.manque}</strong>
                </span>
              )}
            </div>
            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <button
                className="discret"
                onClick={() => setDetail(detail === l.creneau_id ? null : l.creneau_id)}
              >
                {detail === l.creneau_id ? 'Fermer' : 'Affecter'}
              </button>
            </div>
            {detail === l.creneau_id && (
              <div className="formulaire">
                <div className="ligne-boutons">
                  {membres.map((m) => (
                    <button
                      key={m.id}
                      className="module"
                      onClick={() => affecter(l.creneau_id, m.id)}
                    >
                      {m.nom_affiche ?? m.role}
                    </button>
                  ))}
                </div>
                <p className="aide">
                  Une affectation part en « proposé ». Elle ne compte dans la couverture
                  qu'une fois confirmée par la personne — sinon le planning est un vœu.
                </p>
              </div>
            )}
          </div>
        ))
      )}
    </>
  )
}

/* ================================================================== */
/* Mes créneaux — vue du bénévole                                      */
/* ================================================================== */

function MesCreneaux({ evenement, membre, setMessage }) {
  const [lignes, setLignes] = useState([])

  async function charger() {
    const { data, error } = await supabase
      .from('affectations')
      .select('*, creneaux(code, poste, debut, fin, consignes, lieux:lieu_id(nom))')
      .eq('evenement_id', evenement.id)
      .eq('membre_id', membre.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id, membre.id])

  async function repondre(id, statut) {
    const { error, count } = await supabase
      .from('affectations')
      .update({ statut }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  if (!lignes.length)
    return <p className="vide">Aucun créneau ne t'est proposé pour l'instant.</p>

  return lignes
    .sort((a, b) => new Date(a.creneaux?.debut) - new Date(b.creneaux?.debut))
    .map((a) => (
      <div className={`carte ${a.statut === 'propose' ? 'urgent' : ''}`} key={a.id}>
        <div className="titre">{a.creneaux?.poste}</div>
        <div className="meta">
          <span>
            {a.creneaux && heure(a.creneaux.debut)} →{' '}
            {a.creneaux &&
              new Date(a.creneaux.fin).toLocaleTimeString('fr-BE', {
                hour: '2-digit',
                minute: '2-digit'
              })}
          </span>
          {a.creneaux?.lieux?.nom && <span>{a.creneaux.lieux.nom}</span>}
          <span className="jeton">{a.statut}</span>
        </div>
        {a.creneaux?.consignes && <p className="aide">{a.creneaux.consignes}</p>}
        {['propose', 'confirme'].includes(a.statut) && (
          <div className="ligne-boutons" style={{ marginTop: 10 }}>
            {a.statut === 'propose' && (
              <button onClick={() => repondre(a.id, 'confirme')}>Je confirme</button>
            )}
            {a.statut === 'confirme' && (
              <button onClick={() => repondre(a.id, 'present')}>Je suis sur place</button>
            )}
            <button className="discret" onClick={() => repondre(a.id, 'annule')}>
              Je ne peux pas
            </button>
          </div>
        )}
      </div>
    ))
}

/* ================================================================== */
/* Bénévoles                                                           */
/* ================================================================== */

function Equipe({ evenement, setMessage }) {
  const [membres, setMembres] = useState([])
  const [equipes, setEquipes] = useState([])

  async function charger() {
    const [m, e] = await Promise.all([
      supabase
        .from('membres_evenement')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('role'),
      supabase.from('equipes').select('id, code, nom').eq('evenement_id', evenement.id)
    ])
    if (m.error) setMessage({ type: 'erreur', texte: m.error.message })
    else setMembres(m.data ?? [])
    setEquipes(e.data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function rattacher(id, equipeId) {
    const { error, count } = await supabase
      .from('membres_evenement')
      .update({ equipe_id: equipeId || null }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  if (!membres.length) return <p className="vide">Aucun membre.</p>

  return (
    <>
      <div className="compteurs">
        <span>
          Membres <strong>{membres.length}</strong>
        </span>
        <span>
          Actifs <strong>{membres.filter((m) => m.actif).length}</strong>
        </span>
      </div>
      {membres.map((m) => (
        <div className="carte" key={m.id}>
          <div className="titre">{m.nom_affiche ?? '(sans nom)'}</div>
          <div className="meta">
            <span className={`jeton ${m.role}`}>{m.role}</span>
            {m.perimetre && <span>{m.perimetre}</span>}
            {m.telephone && <span className="mono">{m.telephone}</span>}
            {!m.actif && <span className="alerte-texte">inactif</span>}
          </div>
          <div className="ligne-boutons" style={{ marginTop: 10 }}>
            <select
              value={m.equipe_id ?? ''}
              onChange={(e) => rattacher(m.id, e.target.value)}
              style={{ width: 'auto', marginBottom: 0 }}
            >
              <option value="">— sans équipe —</option>
              {equipes.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.code} · {eq.nom}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <p className="aide">
        L'équipe de rattachement détermine les missions qui apparaissent dans « Mon terrain ».
        Sans équipe, la personne ne voit que ce qui lui est nommément attribué.
      </p>
    </>
  )
}

/* ================================================================== */
/* Jalons                                                              */
/* ================================================================== */

const STATUTS_JALON = [
  ['a_venir', 'À venir'],
  ['en_cours', 'En cours'],
  ['fait', 'Fait'],
  ['rate', 'Raté'],
  ['annule', 'Annulé']
]

function Jalons({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [f, setF] = useState({ code: '', libelle: '', echeance: '', responsable: '' })

  async function charger() {
    const { data, error } = await supabase
      .from('jalons')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('echeance')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!f.code.trim() || !f.libelle.trim() || !f.echeance) return
    const { error } = await supabase.from('jalons').insert({
      evenement_id: evenement.id,
      ...f,
      echeance: new Date(f.echeance).toISOString()
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ code: '', libelle: '', echeance: '', responsable: '' })
      charger()
    }
  }

  async function changer(id, statut) {
    const { error } = await supabase.from('jalons').update({ statut }).eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  const maintenant = Date.now()

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value })}
          placeholder="Code"
          style={{ flex: '0 1 90px' }}
        />
        <input
          value={f.libelle}
          onChange={(e) => setF({ ...f, libelle: e.target.value })}
          placeholder="Libellé"
        />
        <input
          type="datetime-local"
          value={f.echeance}
          onChange={(e) => setF({ ...f, echeance: e.target.value })}
        />
        <input
          value={f.responsable}
          onChange={(e) => setF({ ...f, responsable: e.target.value })}
          placeholder="Responsable"
          style={{ flex: '0 1 140px' }}
        />
        <button onClick={creer}>Ajouter</button>
      </div>

      {lignes.length === 0 ? (
        <p className="vide">Aucun jalon.</p>
      ) : (
        lignes.map((j) => {
          const depasse =
            j.statut === 'a_venir' && new Date(j.echeance).getTime() < maintenant
          return (
            <div className={`carte ${depasse || j.statut === 'rate' ? 'urgent' : ''}`} key={j.id}>
              <div className="titre">
                <span className="mono">{j.code}</span> — {j.libelle}
                {j.critique && <span className="jeton alerte-texte"> critique</span>}
              </div>
              <div className="meta">
                <span className={depasse ? 'alerte-texte' : ''}>{heure(j.echeance)}</span>
                {j.responsable && <span>{j.responsable}</span>}
                {j.categorie && <span>{j.categorie}</span>}
                {depasse && <span className="alerte-texte">échéance dépassée</span>}
              </div>
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <select
                  value={j.statut}
                  onChange={(e) => changer(j.id, e.target.value)}
                  style={{ width: 'auto', marginBottom: 0 }}
                >
                  {STATUTS_JALON.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })
      )}
    </>
  )
}
