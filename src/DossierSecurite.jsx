import { useState } from 'react'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType
} from 'docx'
import { supabase } from './supabaseClient'

/*
 * Dossier de sécurité — généré depuis les données structurées
 * d'Eventware, pas rédigé à la main chaque année.
 *
 * Fidèle à l'analyse de faisabilité menée sur l'ébauche BFMF 2026 :
 * cinq sections se remplissent directement (programme, radio,
 * implantation, contacts, objet), plusieurs se complètent avec les
 * champs ajoutés depuis (fréquentation, encadrement, segments,
 * moyens de secours, conformité), et ce qui reste purement narratif
 * (§2, §7) s'affiche comme un paragraphe « à compléter » plutôt que
 * comme un vide silencieux — personne ne doit signer un dossier
 * incomplet sans le savoir.
 */

const CRITERE_LIBELLE_CAT = {
  prv: 'PRV', voie_secours: 'Voie de secours', point_eau: "Point d'eau",
  dea: 'DEA', extincteur: 'Extincteur', parking: 'Parking', foodtruck: 'Foodtruck',
  zone_technique: 'Zone technique'
}

export default function DossierSecurite({ evenement, setMessage }) {
  const [enCours, setEnCours] = useState(false)

  async function genererEtTelecharger() {
    setEnCours(true)
    try {
      const doc = await construireDocument(evenement)
      const blob = await Packer.toBlob(doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Dossier-securite-${evenement.nom.replace(/[^a-z0-9]+/gi, '-')}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMessage({ type: 'erreur', texte: `Génération impossible : ${e.message}` })
    }
    setEnCours(false)
  }

  return (
    <div className="formulaire">
      <p className="aide" style={{ marginTop: 0 }}>
        Assemble un dossier de sécurité `.docx` à partir des données déjà encodées —
        programme, radio, implantation, segments, fréquentation, moyens de secours,
        conformité, contacts. Ce que l'événement n'a pas encore renseigné s'affiche comme
        « à compléter », jamais comme une case vide qu'on pourrait croire volontairement
        laissée de côté.
      </p>
      <button disabled={enCours} onClick={genererEtTelecharger}>
        {enCours ? 'Génération…' : 'Générer le dossier de sécurité'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

async function construireDocument(evenement) {
  const [
    { data: programme },
    { data: canaux },
    { data: elementsPlan },
    { data: segments },
    { data: moyens },
    { data: contacts },
    { data: groupes },
    { data: referentielItems },
    { data: reponsesConformite }
  ] = await Promise.all([
    supabase.from('programme').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('debut'),
    supabase.from('canaux_radio').select('*').eq('evenement_id', evenement.id).eq('actif', true).order('ordre'),
    supabase.from('elements_plan').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('categorie'),
    supabase.from('segments_parcours').select('*, depart:depart_lieu_id(code,nom), arrivee:arrivee_lieu_id(code,nom)').eq('evenement_id', evenement.id),
    supabase.from('moyens_premiers_secours').select('*').eq('evenement_id', evenement.id),
    supabase.from('contacts').select('*').eq('evenement_id', evenement.id).is('deleted_at', null).order('categorie'),
    supabase.from('groupes').select('*').eq('evenement_id', evenement.id).is('deleted_at', null),
    supabase.from('referentiel_items').select('*, referentiels(nom, organisation_id, zone_nom)'),
    supabase.from('conformite_reponses').select('reponses').eq('evenement_id', evenement.id).maybeSingle()
  ])

  const reponses = reponsesConformite?.reponses ?? {}
  const dispositionsApplicables = (referentielItems ?? []).filter((it) => {
    const ref = it.referentiels
    const appartient = ref.organisation_id === evenement.organisation_id || !ref.organisation_id
    if (!appartient) return false
    if (it.toujours_applicable) return true
    if (!it.condition_cle) return false
    const [groupe, critere] = it.condition_cle.split('.')
    return !!reponses[groupe]?.[critere]
  })

  const titre = (texte) => new Paragraph({ text: texte, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } })
  const sousTitre = (texte) => new Paragraph({ text: texte, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } })
  const texte = (t) => new Paragraph({ children: [new TextRun(t)], spacing: { after: 80 } })
  const aCompleter = (t) => new Paragraph({
    children: [new TextRun({ text: `À compléter — ${t}`, italics: true, color: '996600' })],
    spacing: { after: 100 }
  })

  function tableau(entetes, lignes) {
    const ligneEntete = new TableRow({
      children: entetes.map((e) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: e, bold: true })] })],
        width: { size: Math.floor(100 / entetes.length), type: WidthType.PERCENTAGE }
      }))
    })
    const lignesDonnees = lignes.map((l) => new TableRow({
      children: l.map((v) => new TableCell({ children: [new Paragraph(String(v ?? '—'))] }))
    }))
    return new Table({ rows: [ligneEntete, ...lignesDonnees], width: { size: 100, type: WidthType.PERCENTAGE } })
  }

  const enfants = []

  // Page de titre
  enfants.push(
    new Paragraph({
      children: [new TextRun({ text: 'Dossier de sécurité', bold: true, size: 48 })],
      alignment: AlignmentType.CENTER, spacing: { after: 100 }
    }),
    new Paragraph({
      children: [new TextRun({ text: evenement.nom, size: 32 })],
      alignment: AlignmentType.CENTER, spacing: { after: 60 }
    }),
    new Paragraph({
      children: [new TextRun({
        text: `Généré depuis Eventware le ${new Date().toLocaleDateString('fr-BE')}`,
        italics: true, color: '888888'
      })],
      alignment: AlignmentType.CENTER, spacing: { after: 400 }
    })
  )

  // §1 Objet
  enfants.push(titre('1. Objet du dossier'))
  enfants.push(texte(
    `Le présent dossier décrit les dispositions de sécurité prévues pour ${evenement.nom}, ` +
    `en vue de l'autorisation communale et de la validation par les services de secours et de police.`
  ))

  // §2 Concept — narratif, non modélisé
  enfants.push(titre('2. Concept de l\'événement'))
  enfants.push(aCompleter('description narrative du concept, du format et des dates — à rédiger à la main.'))

  // §3 Programme
  enfants.push(titre('3. Programme opérationnel'))
  if (!programme?.length) {
    enfants.push(aCompleter('aucun créneau encodé dans Planning.'))
  } else {
    enfants.push(tableau(
      ['Heure', 'Titre', 'Catégorie', 'Lieu'],
      programme.map((p) => [
        new Date(p.debut).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        p.titre, p.categorie, p.lieu_libre ?? '—'
      ])
    ))
  }

  // §4 Fréquentation et encadrement
  enfants.push(titre('4. Fréquentation et encadrement'))
  sousTitre('4.1 Fréquentation')
  if (evenement.frequentation_min == null && evenement.frequentation_max == null) {
    enfants.push(aCompleter('fréquentation attendue non renseignée — Plan → Effectifs.'))
  } else {
    enfants.push(texte(`Site principal : ${evenement.frequentation_min ?? '?'} à ${evenement.frequentation_max ?? '?'} personnes.`))
  }
  sousTitre('4.2 Encadrement des groupes')
  if (!groupes?.length) {
    enfants.push(aCompleter('aucun groupe encodé dans Parcours.'))
  } else {
    enfants.push(tableau(
      ['Groupe', 'Effectif prévu', 'Encadrants visés', 'Accompagnateur'],
      groupes.map((g) => [g.nom, g.effectif_prevu, g.ratio_encadrement ?? '—', g.accompagnateur_libre ?? '—'])
    ))
  }

  // §5 Radio
  enfants.push(titre('5. Moyens de communication interne'))
  if (!canaux?.length) {
    enfants.push(aCompleter('aucun canal radio encodé dans Logistique → Matrice radio.'))
  } else {
    enfants.push(tableau(
      ['Canal', 'Bande', 'Sous-ton', 'Usage prévu', "Canal d'urgence"],
      canaux.map((c) => [c.numero, `${c.bande ?? ''} ${c.frequence_mhz ?? ''}`.trim(), c.sous_ton ?? '—', c.usage_prevu ?? '—', c.canal_urgence ? 'Oui' : ''])
    ))
  }

  // §6 Implantation générale
  enfants.push(titre('6. Implantation générale'))
  if (!elementsPlan?.length) {
    enfants.push(aCompleter('aucun élément encodé dans Plan → Ajouter.'))
  } else {
    const parCategorie = {}
    for (const e of elementsPlan) {
      (parCategorie[e.categorie] ??= []).push(e)
    }
    for (const [cat, items] of Object.entries(parCategorie)) {
      enfants.push(sousTitre(CRITERE_LIBELLE_CAT[cat] ?? cat))
      enfants.push(tableau(
        ['Code', 'Nom', 'Confirmé'],
        items.map((e) => [e.code, e.nom, e.confirme ? 'Oui' : 'Non'])
      ))
    }
  }

  // §9 Découpage opérationnel et distance de brancardage
  enfants.push(titre('9. Découpage opérationnel et distance de brancardage'))
  if (!segments?.length) {
    enfants.push(aCompleter('aucun segment encodé dans Parcours → Segments.'))
  } else {
    enfants.push(tableau(
      ['Segment', 'Distance totale', 'Brancardage max', 'Composition'],
      segments.map((s) => [
        s.libelle || `${s.depart?.code ?? '?'} → ${s.arrivee?.code ?? '?'}`,
        s.distance_totale_m ? `${s.distance_totale_m} m` : '—',
        s.brancardage_max_m ? `${s.brancardage_max_m} m` : '—',
        (s.composition ?? []).map((c) => `${c.type} : ${c.distance_m} m`).join(', ') || '—'
      ])
    ))
  }

  // §10 Moyens de première intervention
  enfants.push(titre('10. Moyens de première intervention'))
  if (!moyens?.length) {
    enfants.push(aCompleter('aucun moyen dénombré dans Plan → Effectifs.'))
  } else {
    enfants.push(tableau(['Type', 'Quantité'], moyens.map((m) => [m.type, m.quantite])))
  }

  // §11 Contrôles préalables — exigences applicables du référentiel
  enfants.push(titre('11. Contrôles préalables'))
  const obligatoires = dispositionsApplicables.filter((d) => d.caractere === 'obligatoire')
  if (!obligatoires.length) {
    enfants.push(aCompleter('aucune exigence résolue — vérifie Sécurité → Conformité → Questionnaire.'))
  } else {
    enfants.push(texte(
      `${obligatoires.length} exigence(s) applicable(s), résolues depuis le questionnaire de conformité :`
    ))
    for (const d of obligatoires) {
      enfants.push(new Paragraph({
        children: [
          new TextRun({ text: `${d.code} — ${d.titre}`, bold: true })
        ], spacing: { before: 100 }
      }))
      enfants.push(texte(d.dispositions))
    }
  }

  // §12 Contacts
  enfants.push(titre('12. Points de contact opérationnels'))
  if (!contacts?.length) {
    enfants.push(aCompleter('aucun contact encodé dans Mémento → Contacts.'))
  } else {
    enfants.push(tableau(
      ['Nom', 'Fonction', 'Organisation', 'Téléphone'],
      contacts.map((c) => [c.nom, c.fonction ?? '—', c.organisation ?? '—', c.telephone ?? '—'])
    ))
  }

  return new Document({ sections: [{ children: enfants }] })
}
