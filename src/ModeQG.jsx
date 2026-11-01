import { useEffect, useMemo, useState } from 'react'
import { CarteTactique, useTactique } from './ColonneSituation'
import Meteo from './Meteo'
import { TYPES } from './PcOps'
import { libelleStatut, libelleEtapeTransport, aParcours } from './libelles'

/**
 * Mode QG — la Situation en plein écran, pour l'écran du PC-Ops (1/11,
 * demande de Ren).
 *
 * Trois zones, sans défilement de page :
 *   — la carte tactique, qui occupe la moitié gauche ;
 *   — à droite, UNE file « à décider », tous domaines confondus, triée
 *     par gravité puis par âge : mayday, alerte, recherche, SOS reçu,
 *     P1, SOS pris en charge, P2, le reste. Avec le moyen engagé et
 *     depuis combien de temps, et les mêmes gestes que la Situation
 *     (prendre en charge, clôturer, attribuer, convertir) ;
 *   — en bas, le temps : les dernières entrées majeures de la main
 *     courante à gauche, ce qui vient (programme, jalons, transports)
 *     à droite.
 *
 * En tête : l'événement, la phase, l'heure, le dernier relevé, la météo
 * et les chiffres de la phase. Rien n'est chargé en plus : tout vient de
 * la Situation et de la carte tactique. Échap ou « Quitter » rend la
 * Situation ordinaire.
 */

const RANG = { mayday: 6, alerte: 5, recherche: 5, sos_recu: 4, p1: 3, sos: 2, p2: 2, autre: 1, jalon_retard: 4, jalon: 1 }

const hhmm = (d) => (d ? new Date(d).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '')
const jjmm = (d) => (d ? new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' }) : '')

function ecoule(date, maintenant) {
  if (!date) return ''
  const min = Math.max(0, Math.round((maintenant - new Date(date)) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, '0')}`
}

/** La file « à décider », construite depuis ce que la Situation a déjà. */
function construireFile({ s, signalements, demandes, phase, maintenant }) {
  const items = []
  for (const a of s.alertes ?? []) {
    items.push({ cle: 'al' + (a.id ?? a.titre), rang: RANG.alerte, genre: 'alerte', titre: a.titre, detail: a.consigne || a.message, depuis: a.emise_le, statut: a.acquittee_le ? 'vue par le PC' : 'active', chaud: true, nature: 'Alerte ' + a.niveau })
  }
  for (const r of s.recherches ?? []) {
    items.push({ cle: 'r' + (r.reference ?? r.nom), rang: RANG.recherche, genre: 'recherche', titre: `Recherche — ${r.nom || 'personne'}`, detail: [r.description, r.dernier_lieu && `vu·e : ${r.dernier_lieu}`].filter(Boolean).join(' · '), depuis: r.depuis, statut: 'en cours', chaud: true, nature: 'Recherche' })
  }
  for (const x of signalements) {
    const recu = x.statut === 'recu'
    items.push({
      cle: 's' + x.id, rang: recu ? RANG.sos_recu : RANG.sos, genre: 'sos', objet: x,
      titre: `${TYPES[x.type] ?? x.type}${x.description ? ` — ${x.description}` : ''}`,
      lieu: x.lieu?.nom, position: x, depuis: x.recu_le, statut: libelleStatut(x.statut), chaud: recu, nature: x.reference ?? 'SOS', contact: x.contact
    })
  }
  for (const d of demandes) {
    const p1 = d.priorite === 'P1'
    items.push({
      cle: 'd' + d.id, rang: p1 ? RANG.p1 : d.priorite === 'P2' ? RANG.p2 : RANG.autre, genre: 'demande', objet: d,
      titre: d.titre, lieu: d.lieu?.nom, position: d, depuis: d.demarree_le || d.attribuee_le || d.created_at,
      statut: libelleStatut(d.statut), chaud: p1, nature: `${d.module === 'securite' ? 'Sécurité' : 'Logistique'} ${d.priorite} · ${d.reference}`,
      moyen: d.equipe?.code ? `équipe ${d.equipe.code}` : d.membre?.nom_affiche ? d.membre.nom_affiche : null
    })
  }
  // Hors exploitation, les échéances entrent dans la file : un jalon en
  // retard est une décision à prendre autant qu'un SOS en exploitation.
  if (phase === 'preparation' || phase === 'montage' || phase === 'cloture') {
    for (const j of s.jalons ?? []) {
      const retard = j.echeance && new Date(j.echeance) < maintenant
      items.push({ cle: 'j' + (j.libelle + j.echeance), rang: retard ? RANG.jalon_retard : RANG.jalon, genre: 'jalon', titre: j.libelle, detail: j.responsable ? `responsable : ${j.responsable}` : null, depuis: retard ? j.echeance : null, echeance: j.echeance, statut: retard ? 'en retard' : libelleStatut(j.statut), chaud: !!retard || !!j.critique, nature: j.critique ? 'Jalon critique' : 'Jalon' })
    }
  }
  return items.sort((a, b) => b.rang - a.rang || (new Date(a.depuis ?? 0) - new Date(b.depuis ?? 0)))
}

export default function ModeQG({ evenement, s, signalements, demandes, equipes, maj, surTrace, peutSos, peutMissions, occupe, agir, attribuer, convertir, peut, toutPouvoir, onAller, onQuitter }) {
  const { fond, vif, lieux } = useTactique(evenement)
  const [maintenant, setMaintenant] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 15000)
    return () => clearInterval(t)
  }, [])

  // Échap quitte ; la page ne défile pas derrière.
  useEffect(() => {
    const touche = (e) => { if (e.key === 'Escape') onQuitter() }
    window.addEventListener('keydown', touche)
    document.body.classList.add('qg-actif')
    return () => {
      window.removeEventListener('keydown', touche)
      document.body.classList.remove('qg-actif')
    }
  }, [onQuitter])

  const phase = s.evenement?.phase ?? evenement.phase ?? 'exploitation'
  const file = useMemo(() => construireFile({ s, signalements, demandes, phase, maintenant }), [s, signalements, demandes, phase, maintenant])
  const parModule = s.missions?.par_module ?? {}
  const secu = parModule.securite ?? { ouvertes: 0, p1: 0 }
  const logi = parModule.logistique ?? { ouvertes: 0, p1: 0 }
  const exploitation = phase === 'exploitation'

  // Les chiffres de la phase, en tête : ceux qu'on lit en entrant.
  const chiffres = exploitation || phase === 'demontage'
    ? [
        ['SOS à traiter', s.signalements?.non_pris_en_charge ?? 0, 'chaud'],
        ['Demandes P1', (secu.p1 ?? 0) + (logi.p1 ?? 0), 'chaud'],
        ['Demandes ouvertes', (secu.ouvertes ?? 0) + (logi.ouvertes ?? 0), ''],
        ['Transports', s.logistique?.transports_ouverts ?? 0, ''],
        ...(aParcours(s.evenement) ? [['Sans nouvelles', s.parcours?.sans_nouvelles ?? 0, 'chaud'], ['Sur le parcours', s.parcours?.en_route ?? 0, '']] : []),
        ...(evenement.frequentation_max > 0 && s.logistique?.jauge != null ? [['Présents', `${s.logistique.jauge} / ${evenement.frequentation_max}`, s.logistique.jauge >= 0.9 * evenement.frequentation_max ? 'chaud' : '']] : [])
      ]
    : [
        ['Retards jalon', s.jalons_en_retard ?? 0, 'chaud'],
        ['Jalons à venir', (s.jalons ?? []).length, ''],
        ['Demandes ouvertes', (secu.ouvertes ?? 0) + (logi.ouvertes ?? 0), ''],
        ['SOS à traiter', s.signalements?.non_pris_en_charge ?? 0, 'chaud']
      ]

  const journal = (s.journal ?? []).slice(0, 14)
  const aVenir = [
    ...(vif?.programme ?? []).map((p) => ({ cle: 'p' + p.id, quand: p.debut, texte: p.titre, ou: p.lieu_libre, genre: 'programme' })),
    ...(s.logistique?.transports ?? []).map((t) => ({ cle: 't' + t.id, quand: t.attendu_le || t.souhaite_pour, texte: `${t.reference} ${t.depart ?? '?'} → ${t.arrivee ?? '?'}${t.nb_personnes ? ` · ${t.nb_personnes} pers.` : ''}`, ou: t.chauffeur ? `${t.chauffeur}${t.etape ? ` · ${libelleEtapeTransport(t.etape)}` : ''}` : libelleStatut(t.statut), genre: 'transport' })),
    ...(exploitation ? [] : (s.jalons ?? []).map((j) => ({ cle: 'j' + j.libelle, quand: j.echeance, texte: j.libelle, ou: j.responsable, genre: 'jalon', jour: true })))
  ].sort((a, b) => new Date(a.quand ?? 8.64e15) - new Date(b.quand ?? 8.64e15)).slice(0, 14)

  return (
    <div className="mode-qg" role="region" aria-label="Mode QG">
      <header className="qg-tete">
        <div className="qg-titre">
          <strong>{evenement.nom}</strong>
          <span className="mono">{phase}</span>
          <span className="qg-heure mono">{hhmm(maintenant)}</span>
          <span className="qg-releve">{maj ? `relevé ${hhmm(maj)}` : 'relevé…'}</span>
        </div>
        <div className="qg-chiffres">
          {chiffres.map(([lib, val, etat]) => (
            <div key={lib} className={`qg-chiffre ${etat && Number(String(val).split(' ')[0]) > 0 ? etat : ''}`}>
              <span className="qg-chiffre-valeur mono">{val}</span>
              <span className="qg-chiffre-libelle">{lib}</span>
            </div>
          ))}
        </div>
        <button className="discret qg-quitter" onClick={onQuitter} title="Quitter le mode QG (Échap)">Quitter</button>
      </header>

      <div className="qg-meteo">
        <Meteo evenement={evenement} peut={peut} toutPouvoir={toutPouvoir} compact autoJournal={false} />
      </div>

      <section className="qg-carte" aria-label="Carte tactique">
        {!fond ? <p className="vide">Chargement de la carte…</p> : <CarteTactique evenement={evenement} fond={fond} vif={vif} lieux={lieux} hauteur="100%" />}
      </section>

      <section className="qg-file" aria-label="À décider">
        <h3>À décider <span className="mono">{file.length}</span></h3>
        {file.length === 0 ? (
          <p className="moniteur-vide">Rien n'attend de décision.</p>
        ) : (
          <ol className="qg-liste">
            {file.map((it) => (
              <li key={it.cle} className={`qg-item ${it.chaud ? 'chaud' : ''} genre-${it.genre}`}>
                <div className="qg-item-tete">
                  <span className="qg-nature">{it.nature}</span>
                  {it.depuis && <span className="qg-depuis mono">{it.genre === 'jalon' ? `retard ${ecoule(it.depuis, maintenant)}` : `depuis ${ecoule(it.depuis, maintenant)}`}</span>}
                  {it.echeance && !it.depuis && <span className="qg-depuis mono">{jjmm(it.echeance)}</span>}
                </div>
                <div className="qg-item-titre">{it.titre}</div>
                <div className="qg-item-meta">
                  <span>{it.statut}</span>
                  {it.moyen && <span>{it.moyen}</span>}
                  {it.lieu && <span>{it.lieu}</span>}
                  {it.position && surTrace && surTrace(it.position) && <span className="mono">{surTrace(it.position)}</span>}
                  {it.detail && <span>{it.detail}</span>}
                  {it.contact && <a className="lien-externe mono" href={`tel:${String(it.contact).replace(/\s/g, '')}`}>{it.contact}</a>}
                </div>
                {it.genre === 'sos' && peutSos && (
                  <div className="qg-actions">
                    {it.objet.statut === 'recu' && <button className="discret" disabled={occupe === it.objet.id} onClick={() => agir('signalements', it.objet, 'pris_en_charge', 'pris en charge')}>Prendre en charge</button>}
                    {it.objet.statut !== 'recu' && <button className="discret" disabled={occupe === it.objet.id} onClick={() => agir('signalements', it.objet, 'clos', 'clôturé')}>Clôturer</button>}
                    {convertir && <button className="discret" disabled={occupe === it.objet.id} onClick={() => convertir(it.objet)}>→ Demande</button>}
                  </div>
                )}
                {it.genre === 'demande' && peutMissions && (
                  <div className="qg-actions">
                    {equipes.length > 0 && (
                      <select value={it.objet.equipe_id ?? ''} onChange={(e) => attribuer(it.objet, e.target.value)} aria-label="Équipe">
                        <option value="">— équipe —</option>
                        {equipes.map((eq) => <option key={eq.id} value={eq.id}>{eq.code}</option>)}
                      </select>
                    )}
                    {['a_traiter', 'attribuee'].includes(it.objet.statut) && <button className="discret" disabled={occupe === it.objet.id} onClick={() => agir('missions', it.objet, 'en_cours', 'démarrée')}>Démarrer</button>}
                    <button className="discret" disabled={occupe === it.objet.id} onClick={() => agir('missions', it.objet, 'resolue', 'résolue')}>Clore</button>
                  </div>
                )}
                {it.genre === 'jalon' && <div className="qg-actions"><button className="lien" onClick={() => onAller?.('planning')}>Ouvrir le planning</button></div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="qg-fil" aria-label="Dernières entrées">
        <h3>Main courante</h3>
        {journal.length === 0 ? (
          <p className="moniteur-vide">Rien d'écrit encore.</p>
        ) : (
          <ul className="qg-chrono">
            {journal.map((l, i) => (
              <li key={i} className={`imp-${l.importance ?? 'normale'}`}>
                <span className="mono">{hhmm(l.horodatage)}</span>
                <span>{l.texte}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="qg-avenir" aria-label="À venir">
        <h3>À venir</h3>
        {aVenir.length === 0 ? (
          <p className="moniteur-vide">Rien de programmé dans les deux heures.</p>
        ) : (
          <ul className="qg-chrono">
            {aVenir.map((a) => (
              <li key={a.cle} className={`genre-${a.genre}`}>
                <span className="mono">{a.jour ? jjmm(a.quand) : hhmm(a.quand) || '—'}</span>
                <span>{a.texte}{a.ou ? <em> · {a.ou}</em> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
