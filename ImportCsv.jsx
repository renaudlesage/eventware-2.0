import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from './supabaseClient'
import { RESSOURCES, validerLigne, modeleCsv } from './colonnesImport'

const MODES = [
  ['ajouter', 'Ajouter seulement', "Les codes déjà présents sont laissés intacts."],
  ['mettre_a_jour', 'Mettre à jour', "Les codes déjà présents sont modifiés avec les valeurs du fichier."],
  ['ignorer', 'Simulation', "Rien n'est écrit. Sert à vérifier le fichier avant de l'appliquer."]
]

export default function ImportCsv({ evenementId, onFait }) {
  const [clef, setClef] = useState('lieux')
  const [mode, setMode] = useState('ajouter')
  const [analyse, setAnalyse] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [bilan, setBilan] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [nomFichier, setNomFichier] = useState(null)

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
      complete: async (res) => {
        const lignes = res.data.map((brute, i) => {
          const { valeurs, erreurs } = validerLigne(clef, brute)
          return { numero: i + 2, valeurs, erreurs }
        })

        const codes = lignes.filter((l) => l.valeurs.code).map((l) => l.valeurs.code)

        // Codes déjà présents en base, pour cet événement uniquement
        let existants = new Set()
        if (codes.length) {
          const { data, error } = await supabase
            .from(RESSOURCES[clef].table)
            .select('code')
            .eq('evenement_id', evenementId)
            .in('code', codes)
          if (error) {
            setErreur(error.message)
            setOccupe(false)
            return
          }
          existants = new Set((data ?? []).map((d) => d.code))
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
          l.statut = l.erreurs.length ? 'rejete' : l.existant ? 'existant' : 'nouveau'
        }

        setAnalyse({ lignes, colonnesFichier: res.meta.fields ?? [] })
        setOccupe(false)
      },
      error: (e) => {
        setErreur(e.message)
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
          const { error } = await supabase
            .from(RESSOURCES[clef].table)
            .update(reste)
            .eq('evenement_id', evenementId)
            .eq('code', code)
          if (error) throw error
          modifiees++
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
      setAnalyse(null)
      onFait?.()
    } catch (e) {
      setErreur(e.message ?? String(e))
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
                  <td>{l.statut}</td>
                  <td>{l.erreurs.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {analyse.lignes.length > 25 && (
            <p className="aide">… {analyse.lignes.length - 25} ligne(s) supplémentaire(s)</p>
          )}

          <label htmlFor="mode">Que faire des codes déjà présents ?</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <p className="aide">{MODES.find((m) => m[0] === mode)[2]}</p>

          <div className="ligne-boutons">
            <button disabled={occupe} onClick={appliquer}>
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
