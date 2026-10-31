import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'

/* ================================================================== */
/* Stocks                                                              */
/* ================================================================== */

export default function Stocks({ evenement, membre, peut, toutPouvoir, setMessage }) {
  const [articles, setArticles] = useState([])
  const [lieux, setLieux] = useState([])
  const [ouvert, setOuvert] = useState(null)
  const [ouvrirCreation, setOuvrirCreation] = useState(false)

  // Un article est un référentiel ; un mouvement est de la logistique.
  const peutCreerArticle = toutPouvoir || peut?.('referentiels', 'creer')
  const peutMouvement = toutPouvoir || peut?.('logistique', 'creer')

  async function charger() {
    const [m, l] = await Promise.all([
      supabase
        .from('materiel')
        .select('*')
        .eq('evenement_id', evenement.id)
        .order('nom'),
      supabase.from('lieux').select('id, code, nom').eq('evenement_id', evenement.id)
    ])
    if (m.error) setMessage({ type: 'erreur', texte: texteErreur(m.error) })
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
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
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

      {peutCreerArticle && (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          <button onClick={() => setOuvrirCreation(!ouvrirCreation)}>
            {ouvrirCreation ? 'Fermer' : '+ Ajouter un article'}
          </button>
        </div>
      )}

      {ouvrirCreation && (
        <FormArticle
          evenement={evenement}
          lieux={lieux}
          setMessage={setMessage}
          onFait={() => {
            setOuvrirCreation(false)
            charger()
          }}
        />
      )}

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
              {peutMouvement && (
                <div className="ligne-boutons" style={{ marginTop: 10 }}>
                  <button
                    className="discret"
                    onClick={() => setOuvert(ouvert === a.id ? null : a.id)}
                  >
                    {ouvert === a.id ? 'Fermer' : 'Mouvement'}
                  </button>
                </div>
              )}
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

const CATEGORIES_MATERIEL = [
  'boissons', 'consommables', 'hygiène', 'énergie', 'sécurité', 'signalétique', 'autre'
]

/**
 * Créer un article de stock — manquait entièrement : l'écran promettait
 * « ou à créer » sans qu'aucun formulaire n'existe. Le seuil d'alerte
 * se règle ici, à la création — c'est lui qui fait basculer le réactif
 * (« il n'y en avait plus ») au proactif (une alerte avant la rupture).
 */
function FormArticle({ evenement, lieux, setMessage, onFait }) {
  const [code, setCode] = useState('')
  const [nom, setNom] = useState('')
  const [categorie, setCategorie] = useState('consommables')
  const [quantite, setQuantite] = useState('')
  const [unite, setUnite] = useState('')
  const [seuilAlerte, setSeuilAlerte] = useState('')
  const [lieuId, setLieuId] = useState('')
  const [occupe, setOccupe] = useState(false)

  async function creer() {
    if (!code.trim() || !nom.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('materiel').insert({
      evenement_id: evenement.id,
      code: code.trim(),
      nom: nom.trim(),
      categorie,
      quantite: Number(quantite) || 0,
      unite: unite.trim() || null,
      seuil_alerte: seuilAlerte.trim() ? Number(seuilAlerte) : null,
      lieu_id: lieuId || null
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else onFait()
    setOccupe(false)
  }

  return (
    <div className="formulaire">
      <div className="saisie-rapide">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code — ex. GOB-01"
          style={{ flex: '0 1 110px' }}
        />
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom" />
      </div>
      <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
        {CATEGORIES_MATERIEL.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <div className="saisie-rapide">
        <input
          type="number"
          value={quantite}
          onChange={(e) => setQuantite(e.target.value)}
          placeholder="Quantité initiale"
        />
        <input
          value={unite}
          onChange={(e) => setUnite(e.target.value)}
          placeholder="Unité — ex. litres, unités"
        />
      </div>
      <label htmlFor="seuil-article">Seuil d'alerte</label>
      <input
        id="seuil-article"
        type="number"
        value={seuilAlerte}
        onChange={(e) => setSeuilAlerte(e.target.value)}
        placeholder="En dessous de cette quantité, l'article passe en alerte"
      />
      <select value={lieuId} onChange={(e) => setLieuId(e.target.value)}>
        <option value="">— lieu de stockage (facultatif) —</option>
        {lieux.map((l) => (
          <option key={l.id} value={l.id}>{l.nom}</option>
        ))}
      </select>
      <button disabled={occupe || !code.trim() || !nom.trim()} onClick={creer} style={{ marginTop: 8 }}>
        Créer l'article
      </button>
      <p className="aide">
        Sans seuil, l'article ne pourra jamais basculer en alerte — il reste utilisable, juste
        muet sur la rupture qui approche.
      </p>
    </div>
  )
}
