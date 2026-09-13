import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/**
 * Invitations — administration.
 *
 * Remplace l'échange d'identifiants UUID : la personne crée son compte,
 * tape un code de sept caractères, elle est dans l'événement avec le
 * bon rôle. Pour une ASBL de cinquante membres, c'est la différence
 * entre un message par personne et un seul message au groupe.
 *
 * Un lien porte un rôle : celui des bénévoles ne doit pas donner les
 * droits d'un coordinateur. D'où un lien par population plutôt qu'un
 * code unique pour tout le monde.
 */
export default function Invitations({ evenement, setMessage }) {
  const [liens, setLiens] = useState(null)
  const [roles, setRoles] = useState([])
  const [ouvrir, setOuvrir] = useState(false)
  const [f, setF] = useState({ libelle: '', role_id: '', usages_max: '' })

  async function charger() {
    const [i, r] = await Promise.all([
      supabase
        .from('invitations')
        .select('*, roles(code, libelle)')
        .eq('evenement_id', evenement.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('roles')
        .select('id, code, libelle')
        .eq('evenement_id', evenement.id)
        .order('libelle')
    ])
    if (i.error) setMessage({ type: 'erreur', texte: i.error.message })
    else setLiens(i.data ?? [])
    setRoles(r.data ?? [])
    if (!f.role_id && r.data?.length) {
      const benevole = r.data.find((x) => x.code === 'benevole') ?? r.data[0]
      setF((x) => ({ ...x, role_id: benevole.id }))
    }
  }

  useEffect(() => {
    charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenement.id])

  async function creer() {
    const { error } = await supabase.from('invitations').insert({
      evenement_id: evenement.id,
      libelle: f.libelle.trim() || null,
      role_id: f.role_id || null,
      usages_max: f.usages_max ? Number(f.usages_max) : null
    })
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else {
      setF({ ...f, libelle: '', usages_max: '' })
      setOuvrir(false)
      charger()
    }
  }

  async function basculer(id, actif) {
    const { error } = await supabase.from('invitations').update({ actif }).eq('id', id)
    if (error) setMessage({ type: 'erreur', texte: error.message })
    else charger()
  }

  function lien(code) {
    return `${window.location.origin}${window.location.pathname}?code=${code}`
  }

  if (liens === null) return <p className="vide">…</p>

  return (
    <section className="bloc">
      <h2>Inviter des membres</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Chacun crée son compte, puis entre le code — ou clique le lien. Plus besoin
        d'échanger des identifiants un par un.
      </p>

      {liens.length === 0 && !ouvrir && <p className="vide">Aucun lien d'invitation.</p>}

      {liens.map((l) => {
        const epuise = l.usages_max != null && l.usages >= l.usages_max
        return (
          <div className={`carte ${!l.actif || epuise ? '' : 'urgent'}`} key={l.id}>
            <div className="titre">
              <span className="mono" style={{ fontSize: 20, letterSpacing: '0.15em' }}>
                {l.code}
              </span>
            </div>
            <div className="meta">
              {l.libelle && <span>{l.libelle}</span>}
              <span className="jeton">{l.roles?.libelle ?? 'Bénévole'}</span>
              <span>
                {l.usages}
                {l.usages_max != null ? ` / ${l.usages_max}` : ''} utilisation(s)
              </span>
              {!l.actif && <span className="alerte-texte">désactivé</span>}
              {epuise && l.actif && <span className="alerte-texte">épuisé</span>}
            </div>

            <div className="ligne-boutons" style={{ marginTop: 8 }}>
              <button
                className="discret"
                onClick={() => navigator.clipboard?.writeText(l.code)}
              >
                Copier le code
              </button>
              <button
                className="discret"
                onClick={() => navigator.clipboard?.writeText(lien(l.code))}
              >
                Copier le lien
              </button>
              <button className="discret" onClick={() => basculer(l.id, !l.actif)}>
                {l.actif ? 'Désactiver' : 'Réactiver'}
              </button>
            </div>
          </div>
        )
      })}

      {ouvrir ? (
        <div className="formulaire" style={{ marginTop: 10 }}>
          <input
            value={f.libelle}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
            placeholder="À quoi sert ce lien — ex. Membres ASBL, Bénévoles bar"
            autoFocus
          />
          <div className="saisie-rapide">
            <select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.libelle}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={f.usages_max}
              onChange={(e) => setF({ ...f, usages_max: e.target.value })}
              placeholder="Nb max (vide = illimité)"
            />
            <button onClick={creer}>Créer</button>
          </div>
          <p className="aide">
            Le rôle porté par le lien est celui que recevront ceux qui l'utilisent. Un lien
            « coordinateur » mérite une limite d'une seule utilisation ; un lien bénévoles
            peut rester ouvert.
          </p>
        </div>
      ) : (
        <div className="ligne-boutons" style={{ marginTop: 10 }}>
          <button onClick={() => setOuvrir(true)}>+ Nouveau lien d'invitation</button>
        </div>
      )}
    </section>
  )
}

/**
 * Saisie d'un code — pour quelqu'un qui vient de créer son compte et
 * n'appartient encore à aucun événement.
 */
export function RejoindreParCode({ onRejoint }) {
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get('code') ?? ''
  )
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  async function rejoindre() {
    if (!code.trim()) return
    setOccupe(true)
    setErreur(null)
    const { data, error } = await supabase.rpc('rejoindre_evenement', { p_code: code.trim() })
    if (error) setErreur(error.message)
    else {
      const r = data?.[0]
      // Le lien arrive souvent avec ?code= : on le retire pour que le
      // rechargement suivant ne rejoue pas l'adhésion.
      window.history.replaceState({}, '', window.location.pathname)
      onRejoint?.(r?.id_evenement)
    }
    setOccupe(false)
  }

  return (
    <section className="bloc">
      <h2>Rejoindre un événement</h2>
      <p className="aide" style={{ marginTop: 0 }}>
        Si on t'a transmis un code d'invitation, entre-le ici.
      </p>
      {erreur && <div className="message erreur">{erreur}</div>}
      <div className="saisie-rapide">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && rejoindre()}
          placeholder="Code à 7 caractères"
          style={{ fontFamily: 'var(--mono)', letterSpacing: '0.15em' }}
          autoComplete="off"
        />
        <button disabled={occupe || !code.trim()} onClick={rejoindre}>
          Rejoindre
        </button>
      </div>
    </section>
  )
}
