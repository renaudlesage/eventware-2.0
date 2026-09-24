import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { modifierOuRefuser } from './ecriture'

const NIVEAUX = {
  situation: {
    libelle: 'Situation',
    aide: "Bourgmestre, élus, cellule communale : chaque intervention avec sa nature, son lieu et son état, sans texte libre."
  },
  operationnel: {
    libelle: 'Opérationnel',
    aide: "Dir-PC-Ops, zone de secours, police : en plus, la description des signalements et des missions, l'âge et le signalement physique d'une personne recherchée."
  }
}

/**
 * Réglages › Partage › Accès autorité (refonte du 24/09, migration 109).
 *
 * Trois choses à régler, toutes réservées au coordinateur (tout
 * pouvoir) :
 *   — les liens, chacun avec son NIVEAU (situation / opérationnel) ;
 *   — les documents de référence qu'on y joint (des liens Drive…) ;
 *   — les contacts de l'annuaire qu'on accepte d'y voir partir.
 * Rien ne sort par défaut : ni contact, ni document.
 */
export default function AccesAutorite({ evenement, setMessage }) {
  const [acces, setAcces] = useState([])
  const [f, setF] = useState({ libelle: '', organisation: '', niveau: 'situation' })
  const [ouvert, setOuvert] = useState(null)
  const [occupe, setOccupe] = useState(false)

  const base = `${window.location.origin}${window.location.pathname}?autorite=`

  async function charger() {
    const { data, error } = await supabase
      .from('acces_autorite')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setAcces(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function creer() {
    if (!f.libelle.trim()) return
    setOccupe(true)
    const { error } = await supabase.from('acces_autorite').insert({
      evenement_id: evenement.id,
      libelle: f.libelle.trim(),
      organisation: f.organisation.trim() || null,
      niveau: f.niveau
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ libelle: '', organisation: '', niveau: 'situation' })
      charger()
    }
    setOccupe(false)
  }

  async function revoquer(id) {
    const refus = await modifierOuRefuser('acces_autorite', { actif: false }, { id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  async function changerNiveau(a, niveau) {
    const refus = await modifierOuRefuser('acces_autorite', { niveau }, { id: a.id })
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  return (
    <>
      <section className="bloc">
        <h2>Accès autorité</h2>
        <p className="aide">
          Un lien de consultation, sans compte ni mot de passe, pour le bourgmestre, le
          Dir-PC-Ops, la zone de secours ou la police. Il montre la situation (interventions,
          recherches, public, météo), comment intervenir (accès secours, PRV, brancardage,
          ressources en eau, installations à risque) et un dossier (documents, annuaire, plan
          radio). Jamais le nom ni le numéro de qui appelle, jamais le nom d'une personne
          recherchée ou d'un membre de l'équipe, jamais la main courante.
        </p>

        <div className="formulaire">
          <div className="saisie-rapide">
            <input
              value={f.libelle}
              onChange={(e) => setF({ ...f, libelle: e.target.value })}
              placeholder="Destinataire — ex. Bourgmestre, Dir-PC-Ops"
            />
            <input
              value={f.organisation}
              onChange={(e) => setF({ ...f, organisation: e.target.value })}
              placeholder="Organisation"
              style={{ flex: '0 1 190px' }}
            />
          </div>
          <div className="onglets" role="radiogroup" aria-label="Niveau de détail">
            {Object.entries(NIVEAUX).map(([k, n]) => (
              <button
                key={k}
                role="radio"
                aria-checked={f.niveau === k}
                className={`module ${f.niveau === k ? 'actif' : ''}`}
                onClick={() => setF({ ...f, niveau: k })}
              >
                {n.libelle}
              </button>
            ))}
          </div>
          <p className="aide">{NIVEAUX[f.niveau].aide}</p>
          <button disabled={occupe || !f.libelle.trim()} onClick={creer}>
            Ouvrir un accès
          </button>
        </div>

        {acces.length === 0 ? (
          <p className="vide">Aucun accès ouvert.</p>
        ) : (
          acces.map((a) => (
            <div className={`carte ${a.actif ? '' : 'revoque'}`} key={a.id}>
              <div className="titre">
                {a.libelle}
                <span className={`jeton ${a.niveau === 'operationnel' ? 'alerte-jeton' : ''}`}>
                  {' '}
                  {NIVEAUX[a.niveau]?.libelle ?? a.niveau}
                </span>
                {!a.actif && <span className="jeton"> révoqué</span>}
              </div>
              <div className="meta">
                {a.organisation && <span>{a.organisation}</span>}
                <span>
                  {a.nb_acces === 0 ? 'jamais consulté' : `${a.nb_acces} consultation(s)`}
                </span>
                {a.dernier_acces && (
                  <span>
                    dernier :{' '}
                    {new Date(a.dernier_acces).toLocaleString('fr-BE', {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                )}
              </div>

              {a.actif && (
                <>
                  <div className="ligne-boutons" style={{ marginTop: 10 }}>
                    <button
                      className="discret"
                      onClick={() => setOuvert(ouvert === a.id ? null : a.id)}
                    >
                      {ouvert === a.id ? 'Masquer' : 'Lien et QR'}
                    </button>
                    <button
                      className="discret"
                      onClick={() => navigator.clipboard?.writeText(base + a.jeton)}
                    >
                      Copier le lien
                    </button>
                    <button
                      className="discret"
                      onClick={() => {
                        const cible = a.niveau === 'operationnel' ? 'situation' : 'operationnel'
                        if (
                          confirm(
                            `Passer l'accès de ${a.libelle} en niveau ${NIVEAUX[cible].libelle.toLowerCase()} ?\n\n${NIVEAUX[cible].aide}`
                          )
                        )
                          changerNiveau(a, cible)
                      }}
                    >
                      Passer en {NIVEAUX[a.niveau === 'operationnel' ? 'situation' : 'operationnel'].libelle.toLowerCase()}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Révoquer l'accès de ${a.libelle} ?`)) revoquer(a.id)
                      }}
                    >
                      Révoquer
                    </button>
                  </div>

                  {ouvert === a.id && (
                    <div className="formulaire" style={{ textAlign: 'center' }}>
                      <QRCodeSVG value={base + a.jeton} size={150} level="M" includeMargin />
                      <div className="identifiant" style={{ marginTop: 8 }}>
                        {base + a.jeton}
                      </div>
                      <p className="aide">
                        Chaque consultation est horodatée et journalisée : on saura qui a
                        regardé et quand.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </section>

      <DocumentsAutorite evenement={evenement} setMessage={setMessage} />
      <ContactsAutorite evenement={evenement} setMessage={setMessage} />
    </>
  )
}

function DocumentsAutorite({ evenement, setMessage }) {
  const [docs, setDocs] = useState([])
  const [f, setF] = useState({ titre: '', url: '', description: '' })

  async function charger() {
    const { data, error } = await supabase
      .from('documents_autorite')
      .select('*')
      .eq('evenement_id', evenement.id)
      .order('ordre')
      .order('titre')
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setDocs(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  const urlValide = /^https?:\/\//i.test(f.url.trim())

  async function ajouter() {
    if (!f.titre.trim() || !urlValide) return
    const { error } = await supabase.from('documents_autorite').insert({
      evenement_id: evenement.id,
      titre: f.titre.trim(),
      url: f.url.trim(),
      description: f.description.trim() || null,
      ordre: docs.length
    })
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else {
      setF({ titre: '', url: '', description: '' })
      charger()
    }
  }

  async function retirer(d) {
    const { error, count } = await supabase
      .from('documents_autorite')
      .delete({ count: 'exact' })
      .eq('id', d.id)
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Retrait refusé.' })
    else charger()
  }

  return (
    <section className="bloc">
      <h2>Documents sur le lien autorité</h2>
      <p className="aide">
        Dossier de sécurité, PPUI, plan d'implantation… Colle le lien de partage (Drive,
        SharePoint) : il doit être ouvert « à toute personne disposant du lien », sinon le
        destinataire tombe sur une demande d'accès.
      </p>
      <div className="saisie-rapide">
        <input
          value={f.titre}
          onChange={(e) => setF({ ...f, titre: e.target.value })}
          placeholder="Titre — ex. Dossier de sécurité"
          style={{ flex: '1 1 180px' }}
        />
        <input
          value={f.url}
          onChange={(e) => setF({ ...f, url: e.target.value })}
          placeholder="https://…"
          style={{ flex: '2 1 240px' }}
        />
      </div>
      <div className="saisie-rapide">
        <input
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Description (facultatif)"
        />
        <button disabled={!f.titre.trim() || !urlValide} onClick={ajouter}>
          Ajouter
        </button>
      </div>
      {f.url.trim() && !urlValide && (
        <p className="aide alerte">Le lien doit commencer par https://</p>
      )}
      {docs.length === 0 ? (
        <p className="vide">Aucun document partagé.</p>
      ) : (
        docs.map((d) => (
          <div className="carte" key={d.id}>
            <div className="titre">
              <a className="lien-externe" href={d.url} target="_blank" rel="noopener noreferrer">
                {d.titre} ↗
              </a>
            </div>
            {d.description && <div className="aide">{d.description}</div>}
            <div className="ligne-boutons">
              <button
                className="discret"
                onClick={() => {
                  if (confirm(`Retirer « ${d.titre} » du lien autorité ?`)) retirer(d)
                }}
              >
                Retirer
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  )
}

function ContactsAutorite({ evenement, setMessage }) {
  const [contacts, setContacts] = useState([])

  async function charger() {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, nom, organisation, fonction, telephone, categorie, visible_autorite')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('categorie', { nullsFirst: false })
      .order('nom')
    if (error) setMessage({ type: 'erreur', texte: texteErreur(error) })
    else setContacts(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function basculer(c) {
    const refus = await modifierOuRefuser(
      'contacts',
      { visible_autorite: !c.visible_autorite },
      { id: c.id }
    )
    if (refus) setMessage({ type: 'erreur', texte: refus })
    else charger()
  }

  const visibles = contacts.filter((c) => c.visible_autorite).length

  return (
    <section className="bloc">
      <h2>Annuaire sur le lien autorité</h2>
      <p className="aide">
        Coche les contacts dont le numéro peut partir sur le lien : PC, coordinateur
        sécurité, suppléant, direction de l'événement… Rien n'est coché par défaut —
        l'annuaire contient souvent des bénévoles qui n'ont pas à être appelés par une
        autorité. Les contacts s'importent dans Données › Référentiel.
      </p>
      {contacts.length === 0 ? (
        <p className="vide">Aucun contact dans l'annuaire de l'événement.</p>
      ) : (
        <>
          <p className="aide">
            <span className="mono">{visibles}</span> sur <span className="mono">{contacts.length}</span> visible(s).
          </p>
          <table className="apercu">
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={c.visible_autorite}
                        onChange={() => basculer(c)}
                        style={{ width: 'auto', margin: 0 }}
                      />
                      {c.nom}
                    </label>
                  </td>
                  <td>{[c.fonction, c.organisation].filter(Boolean).join(' · ')}</td>
                  <td className="mono">{c.telephone}</td>
                  <td>{c.categorie}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
