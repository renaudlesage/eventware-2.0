import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import { supabase } from './supabaseClient'
import { texteErreur } from './erreurs'
import { libelleStatut } from './libelles'
import { RESSOURCES, validerLigne, modeleCsv, normaliserEntete, colonnesManquantes } from './colonnesImport'

const MODES = [
  ['ajouter', 'Ajouter seulement', "Les codes déjà présents sont laissés intacts."],
  ['mettre_a_jour', 'Mettre à jour', "Les codes déjà présents sont modifiés avec les valeurs du fichier."],
  ['ignorer', 'Simulation', "Rien n'est écrit. Sert à vérifier le fichier avant de l'appliquer."]
]

export default function ImportCsv({ evenementId, phase, peut, toutPouvoir, onFait }) {
  const [clef, setClef] = useState('lieux')
  const [mode, setMode] = useState('ajouter')
  const [analyse, setAnalyse] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [bilan, setBilan] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [nomFichier, setNomFichier] = useState(null)

  /*
   * Les droits dépendent du rôle ET de la phase : un coordinateur écrit
   * les référentiels jusqu'au démontage, plus en clôture. L'import doit
   * le dire avant de lancer l'opération — sinon RLS refuse en silence
   * et le bilan annonce des lignes modifiées qui ne le sont pas.
   */
  const ressource = RESSOURCES[clef]
  const peutCreer = toutPouvoir || peut?.(ressource.permission, 'creer')
  const peutModifier = toutPouvoir || peut?.(ressource.permission, 'modifier')
  const lectureSeule = !peutCreer && !peutModifier

  useEffect(() => {
    if (lectureSeule) setMode('ignorer')
  }, [lectureSeule, clef])

  const modeImpossible =
    (mode === 'ajouter' && !peutCreer) ||
    (mode === 'mettre_a_jour' && !peutModifier)

  function reinitialiser() {
    setAnalyse(null)
    setBilan(null)
    setErreur(null)
  }

  /* ---------------- Analyse du fichier ---------------- */

  async function analyser(fichier) {
    reinitialiser()
    setNomFichier(fichier.name)
    setOccupe(true)

    Papa.parse(fichier, {
      header: true,
      skipEmptyLines: true,
      delimiter: '',
      // Les en-têtes sont ramenées aux noms attendus : sans BOM, sans
      // accent, sans majuscule, synonymes compris (« Lat » → latitude).
      transformHeader: normaliserEntete,
      complete: async (res) => {
        const entetes = res.meta.fields ?? []
        const manquantes = colonnesManquantes(clef, entetes)
        if (manquantes.length) {
          // Un problème d'en-tête se dit une fois, au niveau du fichier —
          // pas « code manquant » répété sur chaque ligne, qui fait
          // chercher l'erreur dans les données.
          setErreur(
            `Colonne(s) obligatoire(s) absente(s) du fichier : ${manquantes.join(', ')}. ` +
              `En-têtes lues : ${entetes.join(' ; ') || 'aucune'}. ` +
              `Attendu : ${RESSOURCES[clef].colonnes.map((c) => c.champ).join(' ; ')}.`
          )
          setOccupe(false)
          return
        }

        const lignes = res.data.map((brute, i) => {
          const { valeurs, erreurs } = validerLigne(clef, brute)
          return { numero: i + 2, valeurs, erreurs }
        })

        const codes = lignes.filter((l) => l.valeurs.code).map((l) => l.valeurs.code)

        // Codes déjà présents en base, pour cet événement uniquement.
        // Depuis la 110, l'unicité ne porte que sur les lignes vivantes :
        // un code dont la ligne a été supprimée est libre, et le
        // réimporter crée une nouvelle ligne (la supprimée reste en base
        // comme trace). RLS cache de toute façon les lignes supprimées,
        // si bien que `supprime` ne se présente plus en pratique.
        let existants = new Map()
        if (codes.length) {
          const { data, error } = await supabase
            .from(RESSOURCES[clef].table)
            .select('code, deleted_at')
            .eq('evenement_id', evenementId)
            .in('code', codes)
          if (error) {
            setErreur(texteErreur(error))
            setOccupe(false)
            return
          }
          existants = new Map((data ?? []).map((d) => [d.code, !!d.deleted_at]))
        }

        // Doublons internes au fichier lui-même
        const vus = new Set()
        for (const l of lignes) {
          if (!l.valeurs.code) continue
          if (vus.has(l.valeurs.code)) l.erreurs.push('code en double dans le fichier')
          vus.add(l.valeurs.code)
        }

        for (const l of lignes) {
          l.existant = existants.has(l.valeurs.code)
          l.supprime = existants.get(l.valeurs.code) === true
          l.statut = l.erreurs.length ? 'rejete' : l.existant ? 'existant' : 'nouveau'
          if (l.supprime) {
            l.note =
              'code occupé par une entrée supprimée — « Mettre à jour » la réactive'
          }
        }

        setAnalyse({
          lignes,
          colonnesFichier: entetes,
          ignorees: entetes.filter((e) => !RESSOURCES[clef].colonnes.some((c) => c.champ === e))
        })
        setOccupe(false)
      },
      error: (e) => {
        setErreur(texteErreur(e))
        setOccupe(false)
      }
    })
  }

  /* ---------------- Application ---------------- */

  async function appliquer() {
    setOccupe(true)
    setErreur(null)

    const valides = analyse.lignes.filter((l) => l.statut !== 'rejete')
    const nouveaux = valides.filter((l) => !l.existant)
    const existants = valides.filter((l) => l.existant)

    let creees = 0
    let modifiees = 0
    let refusees = 0

    try {
      if (mode !== 'ignorer' && nouveaux.length) {
        const { error } = await supabase
          .from(RESSOURCES[clef].table)
          .insert(
            nouveaux.map((l) => ({ ...l.valeurs, evenement_id: evenementId, origine: 'import' }))
          )
        if (error) throw error
        creees = nouveaux.length
      }

      if (mode === 'mettre_a_jour') {
        for (const l of existants) {
          const { code, ...reste } = l.valeurs
          // Une entrée supprimée que le fichier réaffirme est réactivée
          // plutôt que dupliquée : le code lui appartient toujours.
          const champs = l.supprime ? { ...reste, deleted_at: null } : reste
          const { error, count } = await supabase
            .from(RESSOURCES[clef].table)
            .update(champs, { count: 'exact' })
            .eq('evenement_id', evenementId)
            .eq('code', code)
          if (error) throw error
          // count === 0 : RLS a refusé la ligne sans lever d'erreur.
          // Sans ce test, le bilan annonçait des modifications qui
          // n'avaient pas eu lieu.
          if (count === 0) refusees++
          else modifiees++
        }
      }

      const resultat = {
        lues: analyse.lignes.length,
        creees,
        modifiees,
        ignorees: mode === 'ajouter' ? existants.length : mode === 'ignorer' ? valides.length : 0,
        rejetees: analyse.lignes.length - valides.length
      }

      // Journal — trace de l'opération, quel que soit le mode
      await supabase.from('journal_imports').insert({
        evenement_id: evenementId,
        ressource: RESSOURCES[clef].table,
        fichier: nomFichier,
        mode,
        lignes_lues: resultat.lues,
        lignes_creees: resultat.creees,
        lignes_modifiees: resultat.modifiees,
        lignes_ignorees: resultat.ignorees,
        lignes_rejetees: resultat.rejetees,
        detail: {
          rejets: analyse.lignes
            .filter((l) => l.statut === 'rejete')
            .map((l) => ({ ligne: l.numero, erreurs: l.erreurs }))
        }
      })

      setBilan(resultat)
      if (refusees) {
        setErreur(
          `${refusees} ligne(s) refusée(s) : vos droits ne permettent pas de modifier ce référentiel en phase ${phase ?? 'courante'}.`
        )
      }
      setAnalyse(null)
      onFait?.()
    } catch (e) {
      setErreur(texteErreur(e))
    }
    setOccupe(false)
  }

  /* ---------------- Rendu ---------------- */

  const compte = analyse
    ? {
        nouveau: analyse.lignes.filter((l) => l.statut === 'nouveau').length,
        existant: analyse.lignes.filter((l) => l.statut === 'existant').length,
        rejete: analyse.lignes.filter((l) => l.statut === 'rejete').length
      }
    : null

  return (
    <div className="import">
      <h2>Importer un référentiel</h2>

      {erreur && <div className="message erreur">{erreur}</div>}

      {lectureSeule && (
        <div className="message">
          En phase {phase ?? 'courante'}, ce référentiel est en lecture seule pour vous.
          La simulation reste possible : elle vérifie le fichier sans rien écrire.
        </div>
      )}

      {bilan && (
        <div className="message">
          {bilan.lues} ligne(s) lue(s) · {bilan.creees} créée(s) · {bilan.modifiees} mise(s) à
          jour · {bilan.ignorees} ignorée(s) · {bilan.rejetees} rejetée(s)
        </div>
      )}

      <label htmlFor="ressource">Référentiel</label>
      <select
        id="ressource"
        value={clef}
        onChange={(e) => {
          setClef(e.target.value)
          reinitialiser()
        }}
      >
        {Object.entries(RESSOURCES).map(([k, r]) => (
          <option key={k} value={k}>
            {r.libelle}
          </option>
        ))}
      </select>

      <p className="aide">
        Colonnes attendues :{' '}
        <span className="mono">
          {RESSOURCES[clef].colonnes.map((c) => c.champ).join(' ; ')}
        </span>
        <br />
        Séparateur point-virgule ou virgule, première ligne = en-têtes.{' '}
        <button className="lien" onClick={() => telechargerModele(clef)}>
          Télécharger un modèle vide
        </button>
      </p>

      <label htmlFor="fichier">Fichier CSV</label>
      <input
        id="fichier"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && analyser(e.target.files[0])}
      />

      {analyse && (
        <>
          <div className="resume">
            <span className="jeton nouveau">{compte.nouveau} nouveau(x)</span>
            <span className="jeton existant">{compte.existant} déjà présent(s)</span>
            <span className="jeton rejete">{compte.rejete} rejeté(s)</span>
          </div>
          <p className="aide">
            Colonnes lues : <span className="mono">{analyse.colonnesFichier.join(' ; ')}</span>
            {analyse.ignorees.length > 0 && (
              <>
                {' '}— ignorée(s) : <span className="mono">{analyse.ignorees.join(' ; ')}</span>
              </>
            )}
          </p>

          <table className="apercu">
            <thead>
              <tr>
                <th>L.</th>
                <th>Code</th>
                <th>État</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {analyse.lignes.slice(0, 25).map((l) => (
                <tr key={l.numero} className={l.statut}>
                  <td>{l.numero}</td>
                  <td className="mono">{l.valeurs.code ?? '—'}</td>
                  <td>{libelleStatut(l.statut)}</td>
                  <td>{l.erreurs.length ? l.erreurs.join(' · ') : (l.note ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {analyse.lignes.length > 25 && (
            <p className="aide">… {analyse.lignes.length - 25} ligne(s) supplémentaire(s)</p>
          )}

          <label htmlFor="mode">Que faire des codes déjà présents ?</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.filter(
              ([v]) =>
                v === 'ignorer' ||
                (v === 'ajouter' && peutCreer) ||
                (v === 'mettre_a_jour' && peutModifier)
            ).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <p className="aide">
            {MODES.find((m) => m[0] === mode)[2]}
            {' '}Un import n&rsquo;efface jamais ce qui existe : les entrées absentes du
            fichier sont laissées telles quelles.
          </p>

          <div className="ligne-boutons">
            <button disabled={occupe || modeImpossible} onClick={appliquer}>
              {mode === 'ignorer' ? 'Lancer la simulation' : "Appliquer l'import"}
            </button>
            <button className="discret" disabled={occupe} onClick={reinitialiser}>
              Annuler
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function telechargerModele(clef) {
  const blob = new Blob([modeleCsv(clef)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `modele-${clef}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
