import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

/**
 * Ce que voit le public — administration.
 *
 * L'écran existe parce que le défaut est « rien n'est public ». La base
 * contient des dizaines de lieux dont le PC Ops, les PRV et les voies
 * de secours : c'est l'organisateur qui désigne ce qui sort, un par un,
 * et jamais l'inverse. Cet écran est donc le seul endroit d'où du
 * contenu peut devenir visible sans compte.
 */
export default function Vitrine({ evenement, setMessage }) {
  const [vue, setVue] = useState('lieux')

  return (
    <section className="bloc dom-sarcelle">
      <h2>Ce que voit le public</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Rien n'est publié par défaut. Ce que tu coches ici devient visible par toute personne
        qui scanne un QR — sans compte, sans mot de passe.
      </p>

      <div className="onglets">
        {[
          ['lieux', 'Lieux'],
          ['programme', 'Horaire'],
          ['communications', 'Communications']
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

      {vue === 'lieux' && <Publiables
        evenement={evenement}
        setMessage={setMessage}
        table="lieux"
        libelle={(l) => `${l.code} · ${l.nom}`}
        detail={(l) => l.type}
        ordre="code"
        avertissement="Les lieux opérationnels — PC Ops, PRV, voies de secours, zones techniques — n'ont rien à faire ici. Ne publie que ce qu'un participant doit pouvoir trouver."
      />}

      {vue === 'programme' && <Publiables
        evenement={evenement}
        setMessage={setMessage}
        table="programme"
        libelle={(p) => p.titre}
        detail={(p) => new Date(p.debut).toLocaleString('fr-BE', {
          weekday: 'short', hour: '2-digit', minute: '2-digit'
        })}
        ordre="debut"
        avertissement="Les briefings, le montage et les réunions internes ne regardent pas le public."
      />}

      {vue === 'communications' && (
        <Communications evenement={evenement} setMessage={setMessage} />
      )}
    </section>
  )
}

/** Liste cochable, commune aux lieux et au programme. */
function Publiables({ evenement, setMessage, table, libelle, detail, ordre, avertissement }) {
  const [lignes, setLignes] = useState(null)

  async function charger() {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order(ordre)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id, table])

  async function basculer(id, valeur) {
    const { error, count } = await supabase
      .from(table)
      .update({ public: valeur }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  if (lignes === null) return <p className="vide">…</p>

  const publies = lignes.filter((l) => l.public).length

  return (
    <>
      <p className="aide alerte-texte">{avertissement}</p>
      <div className="compteurs">
        <span>
          Publiés <strong>{publies}</strong> sur {lignes.length}
        </span>
      </div>

      {lignes.map((l) => (
        <label className="case-confirme" key={l.id} style={{ margin: '4px 0' }}>
          <input
            type="checkbox"
            checked={!!l.public}
            onChange={(e) => basculer(l.id, e.target.checked)}
          />
          <span>
            {libelle(l)}
            {detail(l) && <span className="aide"> · {detail(l)}</span>}
          </span>
        </label>
      ))}
    </>
  )
}

/**
 * Communications — le canal d'avant, pendant et surtout d'après.
 * Une communication sans date de publication reste un brouillon : rien
 * ne part tant qu'on ne l'a pas décidé.
 */
function Communications({ evenement, setMessage }) {
  const [lignes, setLignes] = useState(null)
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({ titre: '', corps: '', lien_url: '', lien_libelle: '' })

  async function charger() {
    const { data, error } = await supabase
      .from('communications')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  async function creer() {
    if (!f.titre.trim()) return
    const { error } = await supabase.from('communications').insert({
      evenement_id: evenement.id,
      titre: f.titre.trim(),
      corps: f.corps.trim() || null,
      lien_url: f.lien_url.trim() || null,
      lien_libelle: f.lien_libelle.trim() || null
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ titre: '', corps: '', lien_url: '', lien_libelle: '' })
      setOuvrir(false)
      charger()
    }
  }

  async function publier(id, publie) {
    const refus = await modifierOuRefuser(
      'communications',
      { publie_le: publie ? new Date().toISOString() : null },
      { id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  if (lignes === null) return <p className="vide">…</p>

  return (
    <>
      <p className="aide">
        Visible dans l'app participant. C'est aussi le canal d'après-événement :
        remerciements, photos, annonce de l'édition suivante — ce qui fait qu'on garde l'app
        au lieu de la désinstaller le dimanche soir.
      </p>

      {lignes.length === 0 && !ouvrir && <p className="vide">Aucune communication.</p>}

      {lignes.map((c) => (
        <div className={`carte ${c.publie_le ? '' : 'urgent'}`} key={c.id}>
          <div className="titre">{c.titre}</div>
          {c.corps && <p style={{ margin: '4px 0 0', fontSize: 13 }}>{c.corps}</p>}
          <div className="meta">
            <span className="jeton">{c.publie_le ? 'publiée' : 'brouillon'}</span>
            {c.publie_le && (
              <span>
                depuis le{' '}
                {new Date(c.publie_le).toLocaleDateString('fr-BE')}
              </span>
            )}
          </div>
          <div className="ligne-boutons" style={{ marginTop: 8 }}>
            <button className="discret" onClick={() => publier(c.id, !c.publie_le)}>
              {c.publie_le ? 'Retirer du public' : 'Publier'}
            </button>
          </div>
        </div>
      ))}

      {ouvrir ? (
        <div className="formulaire" style={{ marginTop: 10 }}>
          <input
            value={f.titre}
            onChange={(e) => setF({ ...f, titre: e.target.value })}
            placeholder="Titre"
            autoFocus
          />
          <textarea
            rows={3}
            value={f.corps}
            onChange={(e) => setF({ ...f, corps: e.target.value })}
            placeholder="Message"
          />
          <div className="saisie-rapide">
            <input
              value={f.lien_url}
              onChange={(e) => setF({ ...f, lien_url: e.target.value })}
              placeholder="Lien (facultatif)"
            />
            <input
              value={f.lien_libelle}
              onChange={(e) => setF({ ...f, lien_libelle: e.target.value })}
              placeholder="Texte du lien"
              style={{ flex: '0 1 160px' }}
            />
          </div>
          <div className="ligne-boutons">
            <button disabled={!f.titre.trim()} onClick={creer}>
              Créer en brouillon
            </button>
            <button className="discret" onClick={() => setOuvrir(false)}>
              Annuler
            </button>
          </div>
          <p className="aide">
            Créée en brouillon : elle ne sera visible qu'après avoir cliqué « Publier ».
          </p>
        </div>
      ) : (
        <div className="ligne-boutons" style={{ marginTop: 10 }}>
          <button onClick={() => setOuvrir(true)}>+ Nouvelle communication</button>
        </div>
      )}
    </>
  )
}
