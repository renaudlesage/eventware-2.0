import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { libelleStatut } from './libelles'

/*
 * `besoin` : capacité d'encadrement requise.
 * Un bénévole ne voit que ses propres créneaux — la couverture globale
 * et la liste de l'équipe ne le concernent pas.
 */
const ONGLETS = [
  ['couverture', 'Couverture', true],
  ['equipe', 'Bénévoles', true],
  ['fiches', 'Fiches de poste', true]
]

const heure = (d) =>
  new Date(d).toLocaleString('fr-BE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

export default function Rh({ evenement, membre, peut }) {
  const [onglet, setOnglet] = useState('couverture')
  const [message, setMessage] = useState(null)

  return (
    <div className="bloc securite dom-azur">
      <h2>Bénévoles</h2>

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

      {onglet === 'couverture' && (
        <Couverture evenement={evenement} setMessage={setMessage} />
      )}
      {onglet === 'equipe' && <Equipe evenement={evenement} setMessage={setMessage} />}
      {onglet === 'fiches' && <FichesPoste evenement={evenement} setMessage={setMessage} />}
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
  const [rappelPour, setRappelPour] = useState(null)
  const [fiches, setFiches] = useState([])

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
    supabase
      .from('fiches_poste')
      .select('id, intitule')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('intitule')
      .then(({ data }) => setFiches(data ?? []))
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

  /**
   * Rappel de prise de poste. Il est écrit sur le créneau, donc tous
   * ses affectés le voient — pas d'envoi personne par personne, qui
   * garantirait surtout d'en oublier un.
   *
   * Livraison : dans l'application. Celui qui ne l'ouvre pas ne le voit
   * pas — c'est la limite honnête de ce qui existe aujourd'hui, il n'y
   * a ni SMS ni notification poussée dans le projet.
   */
  async function envoyerRappel(creneauId, texte) {
    const { error, count } = await supabase
      .from('creneaux')
      .update(
        { rappel: texte.trim() || null, rappel_envoye_le: texte.trim() ? new Date().toISOString() : null },
        { count: 'exact' }
      )
      .eq('id', creneauId)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Envoi refusé : droits insuffisants.' })
    else {
      setRappelPour(null)
      charger()
    }
  }

  async function rattacherFiche(creneauId, ficheId) {
    const { error, count } = await supabase
      .from('creneaux')
      .update({ fiche_id: ficheId }, { count: 'exact' })
      .eq('id', creneauId)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
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
              <button
                className="discret"
                onClick={() => setRappelPour(rappelPour === l.creneau_id ? null : l.creneau_id)}
              >
                {l.rappel_envoye_le ? 'Rappel envoyé ✓' : 'Rappel'}
              </button>
            </div>

            {detail === l.creneau_id && (
              <div className="formulaire" style={{ marginTop: 6 }}>
                <label htmlFor={`fiche-${l.creneau_id}`}>Fiche de poste</label>
                <select
                  id={`fiche-${l.creneau_id}`}
                  value={l.fiche_id ?? ''}
                  onChange={(e) => rattacherFiche(l.creneau_id, e.target.value || null)}
                >
                  <option value="">— aucune —</option>
                  {fiches.map((fi) => (
                    <option key={fi.id} value={fi.id}>{fi.intitule}</option>
                  ))}
                </select>
                <p className="aide">
                  Ce que le bénévole lira sur ce créneau. Les fiches se rédigent dans
                  l'onglet « Fiches de poste » — une fois, pour tous les créneaux du même
                  poste.
                </p>
              </div>
            )}

            {rappelPour === l.creneau_id && (
              <FormRappel
                valeurInitiale={l.rappel ?? ''}
                envoyeLe={l.rappel_envoye_le}
                onEnvoyer={(texte) => envoyerRappel(l.creneau_id, texte)}
                onAnnuler={() => setRappelPour(null)}
              />
            )}
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

function FormRappel({ valeurInitiale, envoyeLe, onEnvoyer, onAnnuler }) {
  const [texte, setTexte] = useState(valeurInitiale)

  return (
    <div className="formulaire">
      <label htmlFor="rappel">Rappel avant la prise de poste</label>
      <textarea
        id="rappel"
        rows={2}
        autoFocus
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder="Ex : rendez-vous à l'entrée technique, prends une frontale."
      />
      <div className="ligne-boutons">
        <button disabled={!texte.trim()} onClick={() => onEnvoyer(texte)}>
          {envoyeLe ? 'Mettre à jour le rappel' : 'Envoyer aux affectés'}
        </button>
        {envoyeLe && (
          <button className="discret" onClick={() => onEnvoyer('')}>
            Retirer
          </button>
        )}
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
      <p className="aide">
        Visible par tous les affectés de ce créneau, dans leur écran « Mes créneaux ».
        Ils le verront en ouvrant l'application — il n'y a ni SMS ni notification poussée.
        {envoyeLe && ` Dernier envoi : ${heure(envoyeLe)}.`}
      </p>
    </div>
  )
}

/* ================================================================== */
/* Mes créneaux — vue du bénévole                                      */
/* ================================================================== */

export function MesCreneaux({ evenement, membre, setMessage, onCompteurs }) {
  const [lignes, setLignes] = useState([])

  async function charger() {
    const { data, error } = await supabase
      .from('affectations')
      .select('*, creneaux(code, poste, debut, fin, consignes, rappel, rappel_envoye_le, lieux:lieu_id(nom), fiches_poste:fiche_id(intitule, mission, taches, materiel, a_signaler, contact))')
      .eq('evenement_id', evenement.id)
      .eq('membre_id', membre.id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setLignes(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id, membre.id])

  // Remonte au bloc parent : combien de créneaux attendent une
  // confirmation, combien sont confirmés — sur la même liste que
  // celle affichée en dessous.
  const aConfirmer = lignes.filter((a) => a.statut === 'propose').length
  const confirmes = lignes.filter((a) => a.statut === 'confirme').length
  useEffect(() => {
    onCompteurs?.({ aConfirmer, confirmes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aConfirmer, confirmes])

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
          <span className="jeton">{libelleStatut(a.statut)}</span>
        </div>
        {a.creneaux?.consignes && <p className="aide">{a.creneaux.consignes}</p>}

        {/* Le rappel passe AVANT la fiche : il est ponctuel et vient
            d'être écrit pour ce créneau-là, la fiche est permanente. */}
        {a.creneaux?.rappel && (
          <div className="message" style={{ marginTop: 8 }}>
            <strong>Rappel du chef d'équipe</strong>
            <p style={{ margin: '4px 0 0' }}>{a.creneaux.rappel}</p>
          </div>
        )}

        {a.creneaux?.fiches_poste && <FichePoste fiche={a.creneaux.fiches_poste} />}

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

/**
 * Fiche de poste, côté bénévole — repliée par défaut.
 *
 * Dépliée d'office, elle noierait l'heure et le lieu, qui sont ce qu'on
 * vient vérifier en ouvrant l'app. Ce qu'on lit une fois en préparant
 * son poste ne doit pas encombrer ce qu'on relit dix fois sur place.
 */
function FichePoste({ fiche }) {
  const [ouvert, setOuvert] = useState(false)
  const taches = Array.isArray(fiche.taches) ? fiche.taches : []

  return (
    <div style={{ marginTop: 8 }}>
      <button className="lien" onClick={() => setOuvert(!ouvert)}>
        {ouvert ? 'Masquer la fiche de poste' : 'Voir ma fiche de poste'}
      </button>

      {ouvert && (
        <div className="formulaire" style={{ marginTop: 6 }}>
          {fiche.mission && <p style={{ marginTop: 0 }}>{fiche.mission}</p>}

          {taches.length > 0 && (
            <>
              <span className="etiquette">Ce qu'il y a à faire</span>
              <ul className="chrono">
                {taches.map((t, i) => (
                  <li key={i}>
                    <span className="corps">{t}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {fiche.materiel && (
            <p className="aide">
              <span className="etiquette">Matériel remis</span> {fiche.materiel}
            </p>
          )}

          {fiche.a_signaler && (
            <p className="aide alerte-texte">
              <span className="etiquette">À remonter tout de suite</span> {fiche.a_signaler}
            </p>
          )}

          {fiche.contact && (
            <p className="aide">
              <span className="etiquette">En cas de doute</span> {fiche.contact}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/* Bénévoles                                                           */
/* ================================================================== */

function Equipe({ evenement, setMessage }) {
  const [membres, setMembres] = useState([])
  const [equipes, setEquipes] = useState([])
  const [recherche, setRecherche] = useState('')

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

  async function basculerChauffeur(id, actuel) {
    const { error, count } = await supabase
      .from('membres_evenement')
      .update({ est_chauffeur: !actuel }, { count: 'exact' })
      .eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else if (count === 0) setMessage({ type: 'erreur', texte: 'Modification refusée.' })
    else charger()
  }

  async function majVehicule(id, type_vehicule) {
    await supabase.from('membres_evenement').update({ type_vehicule }).eq('id', id)
    charger()
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

  const q = recherche.trim().toLowerCase()
  const visibles = q
    ? membres.filter((m) =>
        [m.nom_affiche, m.perimetre, m.role, m.telephone]
          .filter(Boolean)
          .some((x) => x.toLowerCase().includes(q))
      )
    : membres

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

      <input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Rechercher un bénévole, un poste, un rôle…"
      />

      {visibles.length === 0 && (
        <p className="vide">Aucun membre ne correspond à « {recherche} ».</p>
      )}

      {visibles.map((m) => (
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
            <button
              className={`module ${m.est_chauffeur ? 'actif' : ''}`}
              onClick={() => basculerChauffeur(m.id, m.est_chauffeur)}
            >
              {m.est_chauffeur ? 'Chauffeur ✓' : 'Marquer chauffeur'}
            </button>
          </div>
          {m.est_chauffeur && (
            <input
              defaultValue={m.type_vehicule ?? ''}
              placeholder="Véhicule habituel — utilitaire, 7 places…"
              onBlur={(e) => majVehicule(m.id, e.target.value || null)}
              style={{ marginTop: 8, marginBottom: 0 }}
            />
          )}
        </div>
      ))}
      <p className="aide">
        L'équipe de rattachement détermine les missions qui apparaissent dans « Mon terrain ».
        « Chauffeur » n'est pas un rôle : c'est une catégorie en plus, qui rend la personne
        disponible pour une attribution dans Logistique → Transports. Elle garde ses
        capacités habituelles.
      </p>
    </>
  )
}

/* ================================================================== */
/* Fiches de poste — rédaction                                         */
/* ================================================================== */

/**
 * La fiche appartient au poste, pas au créneau : « Responsable BAR »
 * veut dire la même chose à 18h et à 02h. Écrite une fois, rattachée
 * à autant de créneaux qu'il faut — deux copies finiraient par dire
 * deux choses différentes.
 *
 * Les champs sont séparés plutôt que libres parce qu'un champ
 * « consignes » existait déjà et était resté vide sur les cinq
 * créneaux : devant une page blanche on n'écrit rien, devant une
 * question on répond.
 */
function FichesPoste({ evenement, setMessage }) {
  const [fiches, setFiches] = useState([])
  const [ouvert, setOuvert] = useState(null)

  async function charger() {
    const { data, error } = await supabase
      .from('fiches_poste')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('intitule')
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else setFiches(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function enregistrer(fiche) {
    const charge = {
      evenement_id: evenement.id,
      intitule: fiche.intitule.trim(),
      mission: fiche.mission?.trim() || null,
      taches: (fiche.taches ?? []).filter((t) => t.trim()),
      materiel: fiche.materiel?.trim() || null,
      a_signaler: fiche.a_signaler?.trim() || null,
      contact: fiche.contact?.trim() || null
    }
    const requete = fiche.id
      ? supabase.from('fiches_poste').update(charge).eq('id', fiche.id)
      : supabase.from('fiches_poste').insert(charge)
    const { error } = await requete
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setOuvert(null)
      charger()
    }
  }

  return (
    <>
      <p className="aide" style={{ marginTop: 0 }}>
        Une fiche par poste, réutilisée par tous ses créneaux. Elle se rattache depuis
        l'onglet Couverture.
      </p>

      {fiches.length === 0 && ouvert === null && (
        <p className="vide">Aucune fiche rédigée.</p>
      )}

      {fiches.map((fi) =>
        ouvert === fi.id ? (
          <FormFiche
            key={fi.id}
            initiale={fi}
            onEnregistrer={enregistrer}
            onAnnuler={() => setOuvert(null)}
          />
        ) : (
          <div className="carte" key={fi.id}>
            <div className="titre">{fi.intitule}</div>
            {fi.mission && <p className="aide">{fi.mission}</p>}
            <div className="meta">
              <span>{(fi.taches ?? []).length} tâche(s)</span>
              {!fi.a_signaler && <span className="alerte-texte">rien à remonter précisé</span>}
            </div>
            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button className="discret" onClick={() => setOuvert(fi.id)}>
                Modifier
              </button>
            </div>
          </div>
        )
      )}

      {ouvert === 'nouvelle' ? (
        <FormFiche
          initiale={{ intitule: '', mission: '', taches: [''], materiel: '', a_signaler: '', contact: '' }}
          onEnregistrer={enregistrer}
          onAnnuler={() => setOuvert(null)}
        />
      ) : (
        <div className="ligne-boutons" style={{ marginTop: 10 }}>
          <button onClick={() => setOuvert('nouvelle')}>+ Nouvelle fiche</button>
        </div>
      )}
    </>
  )
}

function FormFiche({ initiale, onEnregistrer, onAnnuler }) {
  const [f, setF] = useState({
    ...initiale,
    taches: (initiale.taches ?? []).length ? initiale.taches : ['']
  })

  const maj = (champ, valeur) => setF((x) => ({ ...x, [champ]: valeur }))

  function majTache(i, valeur) {
    setF((x) => {
      const t = [...x.taches]
      t[i] = valeur
      return { ...x, taches: t }
    })
  }

  return (
    <div className="formulaire">
      <label htmlFor="f-intitule">Intitulé du poste</label>
      <input
        id="f-intitule"
        value={f.intitule}
        onChange={(e) => maj('intitule', e.target.value)}
        placeholder="Ex : Responsable BAR plaine"
      />

      <label htmlFor="f-mission">La mission en une phrase</label>
      <input
        id="f-mission"
        value={f.mission ?? ''}
        onChange={(e) => maj('mission', e.target.value)}
        placeholder="À quoi sert ce poste — ce que le bénévole lit en premier"
      />

      <label>Ce qu'il y a à faire</label>
      {f.taches.map((t, i) => (
        <input
          key={i}
          value={t}
          onChange={(e) => majTache(i, e.target.value)}
          placeholder={`Tâche ${i + 1}`}
        />
      ))}
      <button
        className="discret"
        onClick={() => setF((x) => ({ ...x, taches: [...x.taches, ''] }))}
        style={{ marginBottom: 8 }}
      >
        + Tâche
      </button>

      <label htmlFor="f-materiel">Matériel remis</label>
      <input
        id="f-materiel"
        value={f.materiel ?? ''}
        onChange={(e) => maj('materiel', e.target.value)}
        placeholder="Radio canal 5, caisse, frontale…"
      />

      <label htmlFor="f-signaler">À remonter tout de suite</label>
      <input
        id="f-signaler"
        value={f.a_signaler ?? ''}
        onChange={(e) => maj('a_signaler', e.target.value)}
        placeholder="Ce qu'il ne doit pas gérer seul — la limite de son autonomie"
      />

      <label htmlFor="f-contact">En cas de doute, qui</label>
      <input
        id="f-contact"
        value={f.contact ?? ''}
        onChange={(e) => maj('contact', e.target.value)}
        placeholder="Nom et canal radio ou téléphone"
      />

      <div className="ligne-boutons" style={{ marginTop: 8 }}>
        <button disabled={!f.intitule.trim()} onClick={() => onEnregistrer(f)}>
          Enregistrer
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}
