import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const ONGLETS = [
  ['stocks', 'Stocks'],
  ['attributions', 'Clés & radios'],
  ['jauge', 'Jauge'],
  ['transports', 'Transports']
]

export default function Logistique({ evenement, membre }) {
  const [onglet, setOnglet] = useState('stocks')
  const [message, setMessage] = useState(null)

  return (
    <div className="securite">
      <h2>Logistique</h2>

      <div className="onglets">
        {ONGLETS.map(([k, l]) => (
          <button
            key={k}
            className={`module ${onglet === k ? 'actif' : ''}`}
            onClick={() => setOnglet(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {message && (
        <div className={`message ${message.type === 'erreur' ? 'erreur' : ''}`}>
          {message.texte}
        </div>
      )}

      {onglet === 'stocks' && (
        <Stocks evenement={evenement} membre={membre} setMessage={setMessage} />
      )}
      {onglet === 'attributions' && (
        <Attributions evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'jauge' && (
        <Jauge evenement={evenement} membre={membre} setMessage={setMessage} />
      )}
      {onglet === 'transports' && (
        <Transports evenement={evenement} setMessage={setMessage} />
      )}
    </div>
  )
}

/* ================================================================== */
/* Stocks                                                              */
/* ================================================================== */

function Stocks({ evenement, membre, setMessage }) {
  const [articles, setArticles] = useState([])
  const [lieux, setLieux] = useState([])
  const [ouvert, setOuvert] = useState(null)

  async function charger() {
    const [m, l] = await Promise.all([
      supabase
        .from('materiel')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('nom'),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id)
    ])
    if (m.error) setMessage({ type: 'erreur', texte: m.error.message })
    else setArticles(m.data ?? [])
    setLieux(l.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 30000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function bouger(article, sens, quantite, motif, lieuId) {
    const q = Number(quantite)
    if (!q || q <= 0) return
    const { error } = await supabase.from('mouvements_stock').insert({
      evenement_id: evenement.id,
      materiel_id: article.id,
      sens,
      quantite: q,
      motif: motif || null,
      lieu_id: lieuId || null,
      membre_id: membre.id
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setOuvert(null)
      charger()
    }
  }

  const sousSeuil = articles.filter(
    (a) => a.seuil_alerte != null && Number(a.quantite) <= Number(a.seuil_alerte)
  )

  return (
    <>
      <div className="compteurs">
        <span>
          Articles <strong>{articles.length}</strong>
        </span>
        <span className={sousSeuil.length ? 'alerte-texte' : ''}>
          Sous seuil <strong>{sousSeuil.length}</strong>
        </span>
      </div>

      {articles.length === 0 ? (
        <p className="vide">
          Aucun article. À importer depuis le référentiel matériel, ou à créer.
        </p>
      ) : (
        articles.map((a) => {
          const alerte = a.seuil_alerte != null && Number(a.quantite) <= Number(a.seuil_alerte)
          return (
            <div className={`carte ${alerte ? 'urgent' : ''}`} key={a.id}>
              <div className="titre">
                <span className="mono">{a.code}</span> — {a.nom}
              </div>
              <div className="meta">
                <span className={alerte ? 'alerte-texte' : ''}>
                  <strong>{Number(a.quantite)}</strong> {a.unite ?? ''}
                </span>
                {a.seuil_alerte != null && <span>seuil {Number(a.seuil_alerte)}</span>}
                {a.categorie && <span>{a.categorie}</span>}
              </div>
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button
                  className="discret"
                  onClick={() => setOuvert(ouvert === a.id ? null : a.id)}
                >
                  {ouvert === a.id ? 'Fermer' : 'Mouvement'}
                </button>
              </div>
              {ouvert === a.id && (
                <FormMouvement article={a} lieux={lieux} onValider={bouger} />
              )}
            </div>
          )
        })
      )}
    </>
  )
}

function FormMouvement({ article, lieux, onValider }) {
  const [sens, setSens] = useState('sortie')
  const [q, setQ] = useState('')
  const [motif, setMotif] = useState('')
  const [lieu, setLieu] = useState('')

  return (
    <div className="formulaire">
      <div className="saisie-rapide">
        <select
          value={sens}
          onChange={(e) => setSens(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="entree">Entrée</option>
          <option value="sortie">Sortie</option>
          <option value="ajustement">Ajustement</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Quantité"
          style={{ flex: '0 1 110px' }}
        />
        <select
          value={lieu}
          onChange={(e) => setLieu(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="">— lieu —</option>
          {lieux.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}
            </option>
          ))}
        </select>
      </div>
      <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Motif" />
      <button onClick={() => onValider(article, sens, q, motif, lieu)}>
        Enregistrer le mouvement
      </button>
      <p className="aide">
        Le stock suit le mouvement — il ne se corrige pas à la main. Pour un écart
        d'inventaire, utilise « Ajustement » avec un motif : c'est ce qui rend l'écart
        explicable trois semaines après.
      </p>
    </div>
  )
}

/* ================================================================== */
/* Attributions — clés et radios                                       */
/* ================================================================== */

function Attributions({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [filtre, setFiltre] = useState('dehors')
  const [f, setF] = useState({
    nature: 'cle',
    code: '',
    libelle: '',
    detail: '',
    porteur_libre: ''
  })

  async function charger() {
    const { data, error } = await supabase
      .from('attributions')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function remettre() {
    if (!f.code.trim() || !f.libelle.trim()) return
    const { error } = await supabase.from('attributions').insert({
      evenement_id: evenement.id,
      ...f,
      remis_le: new Date().toISOString()
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ nature: 'cle', code: '', libelle: '', detail: '', porteur_libre: '' })
      charger()
    }
  }

  async function rendre(id) {
    const { error } = await supabase
      .from('attributions')
      .update({ rendu_le: new Date().toISOString() })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  const dehors = lignes.filter((l) => !l.rendu_le)
  const visibles = filtre === 'dehors' ? dehors : lignes

  return (
    <>
      <div className="compteurs">
        <span className={dehors.length ? 'alerte-texte' : ''}>
          Non rendus <strong>{dehors.length}</strong>
        </span>
        <span>
          Total <strong>{lignes.length}</strong>
        </span>
      </div>

      <div className="saisie-rapide">
        <select
          value={f.nature}
          onChange={(e) => setF({ ...f, nature: e.target.value })}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          <option value="cle">Clé</option>
          <option value="radio">Radio</option>
          <option value="equipement">Équipement</option>
          <option value="vehicule">Véhicule</option>
        </select>
        <input
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value })}
          placeholder="Code / indicatif"
          style={{ flex: '0 1 130px' }}
        />
        <input
          value={f.libelle}
          onChange={(e) => setF({ ...f, libelle: e.target.value })}
          placeholder="Libellé"
        />
        <input
          value={f.detail}
          onChange={(e) => setF({ ...f, detail: e.target.value })}
          placeholder="Canal, local…"
          style={{ flex: '0 1 140px' }}
        />
        <input
          value={f.porteur_libre}
          onChange={(e) => setF({ ...f, porteur_libre: e.target.value })}
          placeholder="Remis à"
          style={{ flex: '0 1 140px' }}
        />
        <button onClick={remettre}>Remettre</button>
      </div>

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        {[
          ['dehors', 'Non rendus'],
          ['tout', 'Tout']
        ].map(([k, l]) => (
          <button
            key={k}
            className={`module ${filtre === k ? 'actif' : ''}`}
            onClick={() => setFiltre(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Rien en circulation.</p>
      ) : (
        visibles.map((l) => (
          <div className={`carte ${!l.rendu_le ? 'urgent' : ''}`} key={l.id}>
            <div className="titre">
              <span className="mono">{l.code}</span> — {l.libelle}
            </div>
            <div className="meta">
              <span className="jeton">{l.nature}</span>
              {l.detail && <span>{l.detail}</span>}
              {l.porteur_libre && <span>chez {l.porteur_libre}</span>}
              {l.rendu_le ? (
                <span>rendu {new Date(l.rendu_le).toLocaleString('fr-BE')}</span>
              ) : (
                <span className="alerte-texte">non rendu</span>
              )}
            </div>
            {!l.rendu_le && (
              <div className="ligne-boutons" style={{ marginTop: 10 }}>
                <button onClick={() => rendre(l.id)}>Retour</button>
              </div>
            )}
          </div>
        ))
      )}
      <p className="aide">
        Le démontage est le moment où les clés disparaissent — l'équipe est fatiguée et
        personne ne note rien. Cette liste est ce qu'on relit le dimanche soir.
      </p>
    </>
  )
}

/* ================================================================== */
/* Jauge                                                               */
/* ================================================================== */

function Jauge({ evenement, membre, setMessage }) {
  const [jauge, setJauge] = useState(null)
  const [lieux, setLieux] = useState([])
  const [lieu, setLieu] = useState('')
  const [derniers, setDerniers] = useState([])

  async function charger() {
    const [j, l, c] = await Promise.all([
      supabase.rpc('jauge_courante', { p_evenement: evenement.id }),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id),
      supabase
        .from('comptages')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('horodatage', { ascending: false })
        .limit(8)
    ])
    if (!j.error) setJauge(j.data)
    setLieux(l.data ?? [])
    setDerniers(c.data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function compter(sens, nombre) {
    const { error } = await supabase.from('comptages').insert({
      evenement_id: evenement.id,
      sens,
      nombre,
      lieu_id: lieu || null,
      membre_id: membre.id
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  return (
    <>
      <div className="pave" style={{ marginBottom: 14 }}>
        <div className="pave-titre">Présents estimés</div>
        <div className="grand">{jauge ?? '…'}</div>
      </div>

      <label htmlFor="lieu-jauge">Point d'accès</label>
      <select id="lieu-jauge" value={lieu} onChange={(e) => setLieu(e.target.value)}>
        <option value="">— tous —</option>
        {lieux.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} · {l.nom}
          </option>
        ))}
      </select>

      <div className="grille-comptage">
        {[1, 5, 10, 25].map((n) => (
          <button key={'e' + n} onClick={() => compter('entree', n)}>
            + {n}
          </button>
        ))}
        {[1, 5, 10, 25].map((n) => (
          <button key={'s' + n} className="discret" onClick={() => compter('sortie', n)}>
            − {n}
          </button>
        ))}
      </div>

      <p className="aide">
        Saisie par lots : sur le terrain on compte un groupe, pas une personne à la fois.
      </p>

      {derniers.length > 0 && (
        <ul className="chrono">
          {derniers.map((c) => (
            <li key={c.id}>
              <span className="heure mono">
                {new Date(c.horodatage).toLocaleTimeString('fr-BE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="corps">
                {c.sens === 'entree' ? '+' : '−'}
                {c.nombre}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ================================================================== */
/* Transports                                                          */
/* ================================================================== */

const STATUTS = [
  ['a_traiter', 'À traiter'],
  ['attribuee', 'Attribuée'],
  ['en_cours', 'En cours'],
  ['resolue', 'Terminée'],
  ['annulee', 'Annulée']
]

function Transports({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [masquerClos, setMasquerClos] = useState(true)
  const [f, setF] = useState({
    depart_libre: '',
    arrivee_libre: '',
    nb_personnes: 1,
    motif: '',
    priorite: 'P3'
  })

  async function charger() {
    const { data, error } = await supabase
      .from('transports')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    const t = setInterval(charger, 20000)
    return () => clearInterval(t)
  }, [evenement.id])

  async function demander() {
    if (!f.depart_libre.trim() || !f.arrivee_libre.trim()) return
    const { error } = await supabase.from('transports').insert({
      evenement_id: evenement.id,
      ...f,
      nb_personnes: Number(f.nb_personnes) || 1
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ depart_libre: '', arrivee_libre: '', nb_personnes: 1, motif: '', priorite: 'P3' })
      charger()
    }
  }

  async function changer(id, statut) {
    const { error, count } = await supabase
      .from('transports')
      .update({ statut }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  const visibles = masquerClos
    ? lignes.filter((l) => !['resolue', 'annulee'].includes(l.statut))
    : lignes

  return (
    <>
      <div className="saisie-rapide">
        <input
          value={f.depart_libre}
          onChange={(e) => setF({ ...f, depart_libre: e.target.value })}
          placeholder="Départ"
        />
        <input
          value={f.arrivee_libre}
          onChange={(e) => setF({ ...f, arrivee_libre: e.target.value })}
          placeholder="Arrivée"
        />
        <input
          type="number"
          min="1"
          value={f.nb_personnes}
          onChange={(e) => setF({ ...f, nb_personnes: e.target.value })}
          style={{ flex: '0 1 80px' }}
        />
        <select
          value={f.priorite}
          onChange={(e) => setF({ ...f, priorite: e.target.value })}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {['P1', 'P2', 'P3', 'P4'].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button onClick={demander}>Demander</button>
      </div>
      <input
        value={f.motif}
        onChange={(e) => setF({ ...f, motif: e.target.value })}
        placeholder="Motif"
      />

      <div className="ligne-boutons" style={{ marginBottom: 12 }}>
        <button className="discret" onClick={() => setMasquerClos(!masquerClos)}>
          {masquerClos ? 'Afficher les terminés' : 'Masquer les terminés'}
        </button>
      </div>

      {visibles.length === 0 ? (
        <p className="vide">Aucune course en cours.</p>
      ) : (
        visibles.map((l) => (
          <div className="carte" key={l.id}>
            <div className="titre">
              <span className="mono">{l.reference}</span>{' '}
              <span className={`jeton prio-${l.priorite}`}>{l.priorite}</span>{' '}
              {l.depart_libre} → {l.arrivee_libre}
            </div>
            <div className="meta">
              <span>{l.nb_personnes} pers.</span>
              {l.motif && <span>{l.motif}</span>}
              {l.vehicule && <span>{l.vehicule}</span>}
            </div>
            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <select
                value={l.statut}
                onChange={(e) => changer(l.id, e.target.value)}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                {STATUTS.map(([v, lib]) => (
                  <option key={v} value={v}>
                    {lib}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))
      )}
    </>
  )
}
