import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { supprimerOuRefuser } from './ecriture'

/**
 * Fiches réflexe (liste, éditeur), sorties de Securite.jsx au lot 12
 * (26/09), sans changement de comportement.
 */

/* ================================================================== */
/* Fiches réflexe                                                      */
/* ================================================================== */

export default function Fiches({ evenement, peut, toutPouvoir }) {
  const [fiches, setFiches] = useState(null)
  const [ouverte, setOuverte] = useState(null)
  const [edite, setEdite] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [note, setNote] = useState(null)

  // Policies `fiches_creation` / `fiches_modification` : créer une fiche
  // ou installer le pack (RPC, même test) exige `referentiels:creer` ;
  // modifier ou retirer (`supprimer_logiquement`) `referentiels:modifier`.
  const peutCreer = toutPouvoir || peut?.('referentiels', 'creer')
  const peutModifier = toutPouvoir || peut?.('referentiels', 'modifier')

  async function charger() {
    const { data } = await supabase
      .from('fiches_reflexe')
      .select('*')
      .eq('evenement_id', evenement.id)
      .is('deleted_at', null)
      .order('ordre')
    setFiches(data ?? [])
  }

  useEffect(() => {
    charger()
  }, [evenement.id])

  async function installerPack() {
    setOccupe(true)
    const { data, error } = await supabase.rpc('installer_fiches_standard', {
      p_evenement: evenement.id
    })
    setNote(
      error
        ? texteErreur(error)
        : `${data} fiche(s) installée(s). Adapte-les à ton site : une fiche générique ne vaut que comme point de départ.`
    )
    setOccupe(false)
    charger()
  }

  async function enregistrer(fiche, champs) {
    const { error, count } = await supabase
      .from('fiches_reflexe')
      .update(champs, { count: 'exact' })
      .eq('id', fiche.id)
    if (error) setNote(texteErreur(error))
    else if (count === 0) setNote('Modification refusée : droits insuffisants.')
    else {
      setNote(null)
      setEdite(null)
      charger()
    }
  }

  async function creer() {
    const numero = (fiches?.length ?? 0) + 1
    const { data, error } = await supabase
      .from('fiches_reflexe')
      .insert({
        evenement_id: evenement.id,
        // Code FR-xx attribué par la base (110, audit 4.8).
        titre: 'Nouvelle fiche',
        conduite: [],
        a_ne_pas_faire: [],
        ordre: 100 + numero
      })
      .select()
      .single()
    if (error) setNote(texteErreur(error))
    else {
      await charger()
      setEdite(data.id)
      setOuverte(data.id)
    }
  }

  async function supprimer(fiche) {
    if (!confirm(`Retirer la fiche « ${fiche.titre} » ?`)) return
    // Suppression logique par la fonction serveur (voir ecriture.js) :
    // un `update` direct de `deleted_at` serait refusé par RLS.
    const refus = await supprimerOuRefuser('fiches_reflexe', fiche.id)
    if (refus) setNote(refus)
    else charger()
  }

  if (fiches === null) return <p className="vide">…</p>

  return (
    <>
      {note && <div className="message">{note}</div>}

      {peutCreer && (
        <div className="ligne-boutons" style={{ marginBottom: 12 }}>
          <button onClick={creer}>Nouvelle fiche</button>
          <button className="discret" disabled={occupe} onClick={installerPack}>
            Installer le pack standard
          </button>
        </div>
      )}

      {fiches.length === 0 && (
        <p className="vide">
          Aucune fiche réflexe.
          {peutCreer && ' Les conduites à tenir doivent être disponibles avant l\u2019événement, pas pendant.'}
        </p>
      )}

      {fiches.map((fi) =>
        edite === fi.id ? (
          <EditeurFiche
            key={fi.id}
            fiche={fi}
            onEnregistrer={(champs) => enregistrer(fi, champs)}
            onAnnuler={() => setEdite(null)}
          />
        ) : (
          <div className="carte" key={fi.id}>
            <div
              className="titre"
              style={{ cursor: 'pointer' }}
              onClick={() => setOuverte(ouverte === fi.id ? null : fi.id)}
            >
              <span className="mono">{fi.code}</span> — {fi.titre}
            </div>
            <div className="meta">
              {fi.declencheur && <span>{fi.declencheur}</span>}
              {fi.categorie && <span>{fi.categorie}</span>}
              <span>{(fi.conduite ?? []).length} étape(s)</span>
              {fi.origine === 'seed' && <span className="jeton">standard</span>}
            </div>

            {ouverte === fi.id && (
              <div style={{ marginTop: 10 }}>
                <ol className="liste-pave">
                  {(fi.conduite ?? []).map((etape, i) => (
                    <li key={i}>{etape}</li>
                  ))}
                </ol>
                {(fi.a_ne_pas_faire ?? []).length > 0 && (
                  <>
                    <div className="pave-titre" style={{ marginTop: 10 }}>
                      À ne pas faire
                    </div>
                    <ul className="liste-pave">
                      {fi.a_ne_pas_faire.map((x, i) => (
                        <li key={i} className="alerte-texte">
                          {x}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {fi.contacts && <p className="aide">{fi.contacts}</p>}
                {peutModifier && (
                  <div className="ligne-boutons" style={{ marginTop: 10 }}>
                    <button className="discret" onClick={() => setEdite(fi.id)}>
                      Modifier
                    </button>
                    <button className="discret" onClick={() => supprimer(fi)}>
                      Retirer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}

      {peutModifier && (
        <p className="aide">
          Modifier une fiche standard la fait passer en fiche propre à l'événement : elle ne
          sera plus écrasée si tu réinstalles le pack.
        </p>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Éditeur de fiche réflexe.
 *
 * Les étapes se saisissent une par ligne plutôt que dans un champ unique :
 * une conduite à tenir se lit dans l'ordre, et on doit pouvoir en
 * intercaler une sans réécrire le reste.
 */
function EditeurFiche({ fiche, onEnregistrer, onAnnuler }) {
  const [f, setF] = useState({
    code: fiche.code ?? '',
    titre: fiche.titre ?? '',
    categorie: fiche.categorie ?? '',
    declencheur: fiche.declencheur ?? '',
    contacts: fiche.contacts ?? '',
    ordre: fiche.ordre ?? 100
  })
  const [conduite, setConduite] = useState(fiche.conduite ?? [])
  const [pieges, setPieges] = useState(fiche.a_ne_pas_faire ?? [])

  function enregistrer() {
    onEnregistrer({
      ...f,
      ordre: Number(f.ordre) || 100,
      categorie: f.categorie || null,
      declencheur: f.declencheur || null,
      contacts: f.contacts || null,
      conduite: conduite.filter((x) => x.trim()),
      a_ne_pas_faire: pieges.filter((x) => x.trim())
    })
  }

  return (
    <div className="formulaire">
      <div className="saisie-rapide">
        <input
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value })}
          placeholder="Code"
          style={{ flex: '0 1 110px' }}
        />
        <input
          value={f.titre}
          onChange={(e) => setF({ ...f, titre: e.target.value })}
          placeholder="Titre"
        />
        <input
          type="number"
          value={f.ordre}
          onChange={(e) => setF({ ...f, ordre: e.target.value })}
          title="Ordre d'affichage"
          style={{ flex: '0 1 80px' }}
        />
      </div>

      <label htmlFor={fiche.id + 'decl'}>Quand l'appliquer</label>
      <input
        id={fiche.id + 'decl'}
        value={f.declencheur}
        onChange={(e) => setF({ ...f, declencheur: e.target.value })}
        placeholder="Ce qu'on observe — flammes, personne au sol…"
      />

      <label htmlFor={fiche.id + 'cat'}>Catégorie</label>
      <input
        id={fiche.id + 'cat'}
        value={f.categorie}
        onChange={(e) => setF({ ...f, categorie: e.target.value })}
        placeholder="incendie, sanitaire, évacuation…"
      />

      <ListeOrdonnee
        titre="Conduite à tenir"
        aide="Une action par ligne, dans l'ordre où on les fait."
        valeurs={conduite}
        setValeurs={setConduite}
      />

      <ListeOrdonnee
        titre="À ne pas faire"
        aide="Les erreurs qu'on commet sous le coup de l'urgence."
        valeurs={pieges}
        setValeurs={setPieges}
        alerte
      />

      <label htmlFor={fiche.id + 'cont'}>Contacts</label>
      <input
        id={fiche.id + 'cont'}
        value={f.contacts}
        onChange={(e) => setF({ ...f, contacts: e.target.value })}
        placeholder="112 — PC-Ops — responsable"
      />

      <div className="ligne-boutons">
        <button disabled={!f.titre.trim() || !f.code.trim()} onClick={enregistrer}>
          Enregistrer
        </button>
        <button className="discret" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </div>
  )
}

function ListeOrdonnee({ titre, aide, valeurs, setValeurs, alerte }) {
  function modifier(i, v) {
    const copie = [...valeurs]
    copie[i] = v
    setValeurs(copie)
  }
  function retirer(i) {
    setValeurs(valeurs.filter((_, j) => j !== i))
  }
  function deplacer(i, sens) {
    const j = i + sens
    if (j < 0 || j >= valeurs.length) return
    const copie = [...valeurs]
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
    setValeurs(copie)
  }

  return (
    <>
      <div className="pave-titre" style={{ marginTop: 14 }}>
        {titre}
      </div>
      {valeurs.map((v, i) => (
        <div className="saisie-rapide" key={i}>
          <span className="rang mono">{i + 1}</span>
          <input
            value={v}
            onChange={(e) => modifier(i, e.target.value)}
            className={alerte ? 'alerte-texte' : undefined}
          />
          <button className="discret" onClick={() => deplacer(i, -1)} aria-label="Monter">
            ↑
          </button>
          <button className="discret" onClick={() => deplacer(i, 1)} aria-label="Descendre">
            ↓
          </button>
          <button className="discret" onClick={() => retirer(i)} aria-label="Retirer">
            ×
          </button>
        </div>
      ))}
      <div className="ligne-boutons" style={{ marginBottom: 10 }}>
        <button className="discret" onClick={() => setValeurs([...valeurs, ''])}>
          Ajouter une ligne
        </button>
      </div>
      <p className="aide" style={{ marginTop: -4 }}>
        {aide}
      </p>
    </>
  )
}

