import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { Missions } from './Securite'
import Radio from './Radio'

const ONGLETS = [
  ['interventions', 'Demandes'],
  ['stocks', 'Stocks'],
  ['attributions', 'Clés & radios'],
  ['radio', 'Matrice radio'],
  ['jauge', 'Jauge'],
  ['transports', 'Transports']
]

export default function Logistique({ evenement, membre }) {
  const [onglet, setOnglet] = useState('interventions')
  const [message, setMessage] = useState(null)

  return (
    <div className="bloc securite dom-bronze">
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

      {onglet === 'interventions' && (
        <Missions
          evenement={evenement}
          membre={membre}
          setMessage={setMessage}
          module="logistique"
          libelle="Demandes logistiques"
        />
      )}
      {onglet === 'stocks' && (
        <Stocks evenement={evenement} membre={membre} setMessage={setMessage} />
      )}
      {onglet === 'attributions' && (
        <Attributions evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'radio' && <Radio evenement={evenement} setMessage={setMessage} />}
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

/*
 * Repris de la v18, qui était nickel sur ce point précis : un point de
 * départ/arrivée se choisit d'abord dans une liste de lieux connus —
 * ça remplit les coordonnées GPS sans que personne ne les tape — et
 * seulement à défaut, on bascule sur une adresse libre avec un lien
 * Maps à côté. La saisie libre reste toujours possible : un chauffeur
 * qui va chercher quelqu'un à la gare n'a pas de "lieu" pour ça.
 */

const STATUTS = [
  ['a_traiter', 'À planifier'],
  ['attribuee', 'Attribuée'],
  ['en_cours', 'En cours'],
  ['resolue', 'Terminée'],
  ['annulee', 'Annulée']
]

function Transports({ evenement, setMessage }) {
  const [lignes, setLignes] = useState([])
  const [lieux, setLieux] = useState([])
  const [chauffeurs, setChauffeurs] = useState([])
  const [masquerClos, setMasquerClos] = useState(true)
  const [ouvrir, setOuvrir] = useState(false)
  const [attribution, setAttribution] = useState(null)

  async function charger() {
    const [t, l, c] = await Promise.all([
      supabase
        .from('transports')
        .select('*, depart:depart_lieu_id(nom), arrivee:arrivee_lieu_id(nom), chauffeur:chauffeur_id(nom_affiche)')
        .eq('evenement_id', evenement.id)
        .order('created_at', { ascending: false }),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id),
      supabase.rpc('chauffeurs_disponibles', { p_evenement: evenement.id })
    ])
    if (t.error) setMessage({ type: 'erreur', texte: t.error.message })
    else setLignes(t.data ?? [])
    setLieux(l.data ?? [])
    if (!c.error) setChauffeurs(c.data ?? [])
  }

  useEffect(() => {
    charger()
    const tmr = setInterval(charger, 20000)
    return () => clearInterval(tmr)
  }, [evenement.id])

  async function changer(id, champs) {
    const { error, count } = await supabase
      .from('transports')
      .update(champs, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0)
      setMessage({ type: 'erreur', texte: 'Modification refusée : droits insuffisants.' })
    else charger()
  }

  async function attribuer(id, chauffeurId, vehicule) {
    await changer(id, {
      chauffeur_id: chauffeurId || null,
      vehicule: vehicule || null,
      statut: chauffeurId ? 'attribuee' : 'a_traiter'
    })
    setAttribution(null)
  }

  const visibles = masquerClos
    ? lignes.filter((l) => !['resolue', 'annulee'].includes(l.statut))
    : lignes

  return (
    <>
      {ouvrir ? (
        <FormTransport
          evenement={evenement}
          lieux={lieux}
          onFait={() => {
            setOuvrir(false)
            charger()
          }}
          onAnnuler={() => setOuvrir(false)}
          setMessage={setMessage}
        />
      ) : (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          <button onClick={() => setOuvrir(true)}>Nouvelle demande</button>
          <button className="discret" onClick={() => setMasquerClos(!masquerClos)}>
            {masquerClos ? 'Afficher les terminés' : 'Masquer les terminés'}
          </button>
        </div>
      )}

      {chauffeurs.length === 0 && (
        <p className="aide">
          Aucun chauffeur déclaré. Dans l'onglet Bénévoles, marque les personnes concernées
          comme chauffeurs pour pouvoir leur attribuer des courses.
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="vide">Aucune course.</p>
      ) : (
        visibles.map((l) => (
          <div className="carte" key={l.id}>
            <div className="titre">
              <span className="mono">{l.reference}</span>{' '}
              <span className={`jeton prio-${l.priorite}`}>{l.priorite}</span>{' '}
              {l.depart?.nom ?? l.depart_libre} → {l.arrivee?.nom ?? l.arrivee_libre}
            </div>
            <div className="meta">
              <span>{l.nb_personnes} pers.</span>
              {l.motif && <span>{l.motif}</span>}
              {l.demandeur && <span>{l.demandeur}</span>}
              {l.chauffeur?.nom_affiche && <span>{l.chauffeur.nom_affiche}</span>}
              {l.vehicule && <span>{l.vehicule}</span>}
            </div>

            {(l.depart_libre || l.arrivee_libre) && (
              <div className="ligne-boutons" style={{ marginTop: 6 }}>
                {l.depart_libre && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.depart_libre)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Itinéraire départ
                  </a>
                )}
                {l.arrivee_libre && (
                  <a
                    className="lien-externe"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(l.arrivee_libre)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Itinéraire arrivée
                  </a>
                )}
              </div>
            )}

            <div className="ligne-boutons" style={{ marginTop: 10 }}>
              <select
                value={l.statut}
                onChange={(e) => changer(l.id, { statut: e.target.value })}
                style={{ width: 'auto', marginBottom: 0 }}
              >
                {STATUTS.map(([v, lib]) => (
                  <option key={v} value={v}>
                    {lib}
                  </option>
                ))}
              </select>
              <button
                className="discret"
                onClick={() => setAttribution(attribution === l.id ? null : l.id)}
              >
                {l.chauffeur_id ? 'Changer le chauffeur' : 'Attribuer un chauffeur'}
              </button>
            </div>

            {attribution === l.id && (
              <AttribuerChauffeur
                chauffeurs={chauffeurs}
                actuel={l.chauffeur_id}
                vehiculeActuel={l.vehicule}
                onValider={(c, v) => attribuer(l.id, c, v)}
              />
            )}
          </div>
        ))
      )}
    </>
  )
}

function AttribuerChauffeur({ chauffeurs, actuel, vehiculeActuel, onValider }) {
  const [chauffeurId, setChauffeurId] = useState(actuel ?? '')
  const [vehicule, setVehicule] = useState(vehiculeActuel ?? '')

  return (
    <div className="formulaire">
      <label htmlFor="att-chauffeur">Chauffeur</label>
      <select
        id="att-chauffeur"
        value={chauffeurId}
        onChange={(e) => setChauffeurId(e.target.value)}
      >
        <option value="">— aucun —</option>
        {chauffeurs.map((c) => (
          <option key={c.membre_id} value={c.membre_id}>
            {c.nom ?? '(sans nom)'}
            {c.en_course ? ' — déjà en course' : ''}
            {c.type_vehicule ? ` · ${c.type_vehicule}` : ''}
          </option>
        ))}
      </select>
      <label htmlFor="att-vehicule">Véhicule</label>
      <input
        id="att-vehicule"
        value={vehicule}
        onChange={(e) => setVehicule(e.target.value)}
        placeholder="Plaque, modèle ou repère"
      />
      <button onClick={() => onValider(chauffeurId, vehicule)}>Valider</button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Nouvelle demande — point préétabli ou adresse libre                 */
/* ------------------------------------------------------------------ */

function FormTransport({ evenement, lieux, onFait, onAnnuler, setMessage }) {
  const [depart, setDepart] = useState({ lieuId: '', libre: '' })
  const [arrivee, setArrivee] = useState({ lieuId: '', libre: '' })
  const [nbPersonnes, setNbPersonnes] = useState(1)
  const [motif, setMotif] = useState('')
  const [demandeur, setDemandeur] = useState('')
  const [contact, setContact] = useState('')
  const [priorite, setPriorite] = useState('P3')
  const [occupe, setOccupe] = useState(false)

  const pret = (depart.lieuId || depart.libre.trim()) && (arrivee.lieuId || arrivee.libre.trim())

  async function creer() {
    setOccupe(true)
    const { error } = await supabase.from('transports').insert({
      evenement_id: evenement.id,
      depart_lieu_id: depart.lieuId || null,
      depart_libre: depart.lieuId ? null : depart.libre.trim() || null,
      arrivee_lieu_id: arrivee.lieuId || null,
      arrivee_libre: arrivee.lieuId ? null : arrivee.libre.trim() || null,
      nb_personnes: Number(nbPersonnes) || 1,
      motif: motif.trim() || null,
      demandeur: demandeur.trim() || null,
      contact: contact.trim() || null,
      priorite
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="formulaire">
      <PointDepartArrivee
        titre="Départ"
        lieux={lieux}
        valeur={depart}
        onChange={setDepart}
      />
      <PointDepartArrivee
        titre="Arrivée"
        lieux={lieux}
        valeur={arrivee}
        onChange={setArrivee}
      />

      <div className="saisie-rapide">
        <input
          type="number"
          min="1"
          value={nbPersonnes}
          onChange={(e) => setNbPersonnes(e.target.value)}
          placeholder="Nb pers."
          style={{ flex: '0 1 90px' }}
        />
        <select
          value={priorite}
          onChange={(e) => setPriorite(e.target.value)}
          style={{ width: 'auto', marginBottom: 0 }}
        >
          {['P1', 'P2', 'P3', 'P4'].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder="Motif"
        />
      </div>
      <div className="saisie-rapide">
        <input
          value={demandeur}
          onChange={(e) => setDemandeur(e.target.value)}
          placeholder="Demandé par"
        />
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Contact"
        />
      </div>

      <div className="ligne-boutons">
        <button disabled={occupe || !pret} onClick={creer}>
          Créer la demande
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}

/**
 * Choix d'un point de départ ou d'arrivée.
 *
 * Les deux moyens coexistent visiblement, comme dans la v18 : un
 * sélecteur de lieu connu, ET un champ d'adresse libre juste en dessous,
 * toujours affiché. Choisir un lieu vide le champ libre ; taper dans le
 * champ libre annule la sélection de lieu. Aucun des deux n'est masqué
 * derrière une option de menu qu'il faut deviner.
 */
function PointDepartArrivee({ titre, lieux, valeur, onChange }) {
  const lieuChoisi = lieux.find((l) => l.id === valeur.lieuId)

  return (
    <div style={{ marginBottom: 12 }}>
      <label>{titre}</label>

      <select
        value={valeur.lieuId}
        onChange={(e) => onChange({ lieuId: e.target.value, libre: '' })}
      >
        <option value="">— choisir un lieu du dispositif —</option>
        {lieux.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} · {l.nom}
          </option>
        ))}
      </select>

      <div className="saisie-rapide" style={{ marginTop: 6 }}>
        <input
          value={lieuChoisi ? '' : valeur.libre}
          disabled={!!lieuChoisi}
          onChange={(e) => onChange({ lieuId: '', libre: e.target.value })}
          placeholder={
            lieuChoisi
              ? `${lieuChoisi.nom} (lieu du dispositif — vide le champ pour saisir une adresse)`
              : 'Ou une adresse — rue, n°, code postal, ville'
          }
        />
        <a
          className={`bouton-maps ${valeur.libre.trim() && !lieuChoisi ? '' : 'inactif'}`}
          href={
            valeur.libre.trim() && !lieuChoisi
              ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(valeur.libre.trim())}`
              : undefined
          }
          target="_blank"
          rel="noreferrer"
        >
          Carte
        </a>
      </div>
      {lieuChoisi && (
        <button
          className="lien"
          style={{ marginTop: 4 }}
          onClick={() => onChange({ lieuId: '', libre: '' })}
        >
          Saisir une adresse à la place
        </button>
      )}
    </div>
  )
}
