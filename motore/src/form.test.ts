import { describe, expect, it } from 'vitest'
import { DEMO_MEETING_PREFILL_URL, DEMO_PREFILL_URL } from './demo.ts'
import {
  answerFrom,
  answerFromItems,
  COMMITMENT_FORM,
  commitmentIdIn,
  commitmentLabel,
  MEETING_FORM,
  missingQuestions,
  parsePrefilledUrl,
  prefilledUrl,
  PRIVACY_URL,
  projectIdIn,
  projectLabel,
  UPDATE_FORM,
} from './form.ts'

describe('il Modulo «Aggiorna il cantiere»', () => {
  it('raccoglie dati, quindi la descrizione ha il link all’informativa', () => {
    expect(PRIVACY_URL).toBe('https://bussola.retemicrofarm.it/privacy')
    expect(UPDATE_FORM.description).toContain(PRIVACY_URL)
  })

  it('ha già scritti gruppo, cantiere e codice del gruppo, nel campo che dice di non cambiarlo', () => {
    expect(UPDATE_FORM.questions.slice(0, 3).map((question) => question.title)).toEqual([
      'Gruppo',
      'Cantiere',
      'Codice del gruppo: non cambiarlo',
    ])
  })

  it('poi chiede chi sei, a che punto è, cosa è successo, il prossimo passo, per quando e, in fondo, l’aiuto', () => {
    expect(UPDATE_FORM.questions.slice(3).map((question) => question.title)).toEqual([
      'Chi sei?',
      'A che punto è?',
      "Cosa è successo dall'ultima volta?",
      'Qual è il prossimo passo?',
      'Per quando?',
      'Ti serve aiuto da qualcuno?',
    ])
  })

  it('a che punto è: avvio, in corso, in revisione, in chiusura, chiuso', () => {
    const stage = UPDATE_FORM.questions.find((question) => question.field === 'stage')
    expect(stage?.choices).toEqual(['Avvio', 'In corso', 'In revisione', 'In chiusura', 'Chiuso'])
  })

  it('solo l’aiuto è facoltativo', () => {
    const optional = UPDATE_FORM.questions.filter((question) => !question.required).map((question) => question.field)
    expect(optional).toEqual(['help'])
  })

  it('il messaggio finale dice che si vedrà entro 10 minuti, e riporta alla Bussola', () => {
    expect(UPDATE_FORM.confirmation).toContain(
      'Grazie! Il tuo aggiornamento è arrivato. Sulla Bussola lo vedrai entro 10 minuti.',
    )
    expect(UPDATE_FORM.confirmation).toContain('Torna alla Bussola: https://rami-bussola.pages.dev/cantieri')
  })
})

describe('answerFromItems', () => {
  it('riconosce le risposte dal titolo della domanda', () => {
    const answer = answerFromItems([
      { title: 'Gruppo', response: 'Orti e Suoli' },
      { title: 'Codice del gruppo: non cambiarlo', response: 'k1' },
      { title: 'A che punto è?', response: 'In corso' },
      { title: 'Per quando?', response: '2026-11-20' },
      { title: 'Una domanda aggiunta a mano', response: 'x' },
    ])
    expect(answer).toMatchObject({ group: 'Orti e Suoli', code: 'k1', stage: 'In corso', dueOn: '2026-11-20' })
    expect(answer.help).toBe('')
  })
})

describe('il link precompilato', () => {
  const links = parsePrefilledUrl(DEMO_PREFILL_URL)

  it('trova le domande precompilate nel link di prova che dà Google', () => {
    expect(links.entries).toEqual({ group: 'entry.1001', project: 'entry.1002', code: 'entry.1003' })
    expect(links.base).toBe('https://docs.google.com/forms/d/e/1FAIpQLSdemo/viewform?usp=pp_url')
  })

  it('se manca una domanda si ferma', () => {
    expect(() => parsePrefilledUrl('https://docs.google.com/forms/d/e/x/viewform?entry.1=BUSSOLAGRUPPO')).toThrow(
      'il link precompilato non ha la domanda «Cantiere»',
    )
  })

  it('scrive gruppo, cantiere e codice, codificati', () => {
    const url = prefilledUrl(links, { group: 'Semi e Biodiversità', project: 'Scambio (CAN-0002)', code: 'k1' })
    expect(url).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQLSdemo/viewform?usp=pp_url' +
        '&entry.1001=Semi%20e%20Biodiversit%C3%A0&entry.1002=Scambio%20(CAN-0002)&entry.1003=k1',
    )
  })

  it('senza cantiere lascia vuota quella domanda', () => {
    expect(prefilledUrl(links, { group: 'Orti', code: 'k1' })).not.toContain('entry.1002')
  })
})

describe('il cantiere nella risposta', () => {
  it('si scrive col titolo e l’id, e l’id si ritrova', () => {
    const label = projectLabel({ id: 'CAN-0012', title: 'Rete dei mercati' })
    expect(label).toBe('Rete dei mercati (CAN-0012)')
    expect(projectIdIn(label)).toBe('CAN-0012')
  })

  it('un nome senza id vuol dire un cantiere nuovo', () => {
    expect(projectIdIn('Corso di potatura')).toBeNull()
  })
})

describe('il Modulo «Prossimo incontro»', () => {
  it('ha già scritti gruppo e codice del gruppo, poi chiede giorno, ora, link di Meet e se è visibile ai soci', () => {
    expect(MEETING_FORM.questions.map((question) => question.title)).toEqual([
      'Gruppo',
      'Codice del gruppo: non cambiarlo',
      'Che giorno?',
      'A che ora comincia?',
      'Il link di Meet',
      'È visibile ai soci?',
    ])
    expect(MEETING_FORM.questions.every((question) => question.required)).toBe(true)
    expect(MEETING_FORM.questions.find((question) => question.field === 'visible')?.choices).toEqual(['Sì', 'No'])
    expect(MEETING_FORM.description).toContain(PRIVACY_URL)
    expect(MEETING_FORM.confirmation).toContain('Sulla Bussola lo vedrai entro 10 minuti.')
  })

  it('il link precompilato scrive gruppo e codice, senza cantiere', () => {
    const links = parsePrefilledUrl(DEMO_MEETING_PREFILL_URL, MEETING_FORM)
    expect(links.entries).toEqual({ group: 'entry.2001', code: 'entry.2002' })
    expect(prefilledUrl(links, { group: 'Orti e Suoli', code: 'k1' })).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQLSincontro/viewform?usp=pp_url&entry.2001=Orti%20e%20Suoli&entry.2002=k1',
    )
  })

  it('se il Modulo è cambiato, il messaggio dice quale', () => {
    expect(() =>
      parsePrefilledUrl('https://docs.google.com/forms/d/e/x/viewform?entry.1=BUSSOLAGRUPPO', MEETING_FORM),
    ).toThrow(
      'Il Modulo «Prossimo incontro» è cambiato: il link precompilato non ha la domanda «Codice del gruppo: non cambiarlo».',
    )
  })

  it('riconosce le risposte dal titolo della domanda', () => {
    const answer = answerFrom(MEETING_FORM, [
      { title: 'Che giorno?', response: '2026-11-05' },
      { title: 'A che ora comincia?', response: '18:30' },
      { title: 'È visibile ai soci?', response: 'No' },
    ])
    expect(answer).toEqual({ group: '', code: '', day: '2026-11-05', time: '18:30', meet: '', visible: 'No' })
  })
})

describe('il Modulo «Proponi un impegno»', () => {
  const titles = (fields: string[]) =>
    COMMITMENT_FORM.questions.filter((question) => fields.includes(question.field)).map((question) => question.title)

  it('ha i campi dei sette blocchi, nell’ordine della scheda, dopo la scelta della riga', () => {
    expect(COMMITMENT_FORM.questions.map((question) => question.title)).toEqual([
      'Quale impegno scrivi?',
      // 1. cosa si fa
      'Cosa si fa?',
      // 2. per quale cantiere o GdL
      'Per quale cantiere o GdL?',
      // 3. quanto tempo, fino a quando, il tipo
      'Quante giornate?',
      'Fino a quando?',
      'Di che tipo è?',
      // 4. cosa consegni e chi verifica
      'Cosa consegni?',
      'Chi verifica? Il numero socio',
      // 5. come vieni pagato
      'Come vieni pagato o rimborsato?',
      'Quanto è il compenso, in euro?',
      'Il compenso si vede ai soci?',
      // 6. chi l'ha approvato: chi lo propone
      'Chi lo propone? Il tuo nome',
      'Il tuo cognome',
      'Il tuo numero socio',
      'La tua mail',
      // 7. se serve smettere
      'Se serve smettere: come si lascia?',
      'E come si revoca?',
    ])
  })

  it('ogni campo ha un aiuto sotto', () => {
    for (const question of COMMITMENT_FORM.questions) expect(question.help.length, question.title).toBeGreaterThan(20)
  })

  it('i testi liberi chiedono di non scrivere nomi, mail o telefoni; «Cosa si fa?» dice che va anche sul sito', () => {
    const PRIVACY =
      'Non scrivere nomi, mail o telefoni di soci: questa scheda la leggono il Direttivo e il Coordinamento'
    const help = (field: string) => COMMITMENT_FORM.questions.find((question) => question.field === field)?.help
    for (const field of ['deliverables', 'leave', 'revoke']) expect(help(field), field).toContain(`${PRIVACY}.`)
    expect(help('what')).toContain(`${PRIVACY}, e dopo la ratifica si vede anche sul sito dei soci.`)
  })

  it('obbligatori: la riga, cosa, cantiere, tipo, retribuzione, giornate, fino a quando, consegne, chi verifica, chi propone, come si smette', () => {
    const required = COMMITMENT_FORM.questions.filter((question) => question.required).map((question) => question.field)
    expect(required.sort()).toEqual(
      [
        'row',
        'what',
        'for',
        'term',
        'pay',
        'days',
        'until',
        'deliverables',
        'verifier',
        'proposerFirstName',
        'proposerLastName',
        'proposer',
        'proposerEmail',
        'leave',
        'revoke',
      ].sort(),
    )
    const optional = COMMITMENT_FORM.questions
      .filter((question) => !question.required)
      .map((question) => question.field)
    expect(titles(optional)).toEqual(['Quanto è il compenso, in euro?', 'Il compenso si vede ai soci?'])
  })

  it('chi propone scrive nome, cognome, numero socio e mail; la mail la controlla Google, e l’aiuto dice dove restano', () => {
    const field = (name: string) => COMMITMENT_FORM.questions.find((question) => question.field === name)
    expect(field('proposerEmail')?.kind).toBe('email')
    expect(field('proposerFirstName')?.help).toContain(
      'Nome, cognome e mail restano nel Foglio della Bussola, che leggono la segreteria e chi cura la Bussola',
    )
    expect(field('proposerFirstName')?.help).toContain('sul sito e nella Riservata non escono')
    expect(field('proposer')?.help).toContain('fra le Persone della Riservata')
  })

  it('la riga si sceglie da un elenco; tipo e retribuzione hanno le loro parole', () => {
    const field = (name: string) => COMMITMENT_FORM.questions.find((question) => question.field === name)
    expect(field('row')?.kind).toBe('list')
    expect(field('term')?.choices).toEqual(['Continuativo', 'A progetto'])
    expect(field('pay')?.choices).toEqual(['Volontario', 'Rimborso spese', 'Compenso'])
    expect(field('feeVisible')?.choices).toEqual(['Sì', 'No'])
  })

  it('raccoglie dati: c’è il link all’informativa; il messaggio finale dice «Da approvare» entro 10 minuti', () => {
    expect(COMMITMENT_FORM.description).toContain(PRIVACY_URL)
    expect(COMMITMENT_FORM.confirmation).toContain('in «Da approvare», la vedrai entro 10 minuti.')
  })

  it('la riga si scrive col titolo e l’id, e dall’id si ritrova', () => {
    const label = commitmentLabel({ id: 'IMP-0001', title: 'La cura della Bussola' })
    expect(label).toBe('La cura della Bussola (IMP-0001)')
    expect(commitmentIdIn(label)).toBe('IMP-0001')
    expect(commitmentIdIn('La cura della Bussola')).toBeNull()
  })

  it('un Modulo creato prima delle domande nuove: la preparazione dice quali mancano, coi titoli', () => {
    const before = COMMITMENT_FORM.questions
      .filter((question) => !['proposerFirstName', 'proposerLastName', 'proposerEmail'].includes(question.field))
      .map((question) => ` ${question.title.toUpperCase()}`)
    expect(missingQuestions(COMMITMENT_FORM, before).map((question) => question.title)).toEqual([
      'Chi lo propone? Il tuo nome',
      'Il tuo cognome',
      'La tua mail',
    ])
    const all = COMMITMENT_FORM.questions.map((question) => question.title)
    expect(missingQuestions(COMMITMENT_FORM, all)).toEqual([])
  })

  it('le risposte si leggono dai titoli', () => {
    const answer = answerFrom(COMMITMENT_FORM, [
      { title: 'Quale impegno scrivi?', response: 'La cura della Bussola (IMP-0001) ' },
      { title: 'Quante giornate?', response: '12' },
    ])
    expect(answer.row).toBe('La cura della Bussola (IMP-0001)')
    expect(answer.days).toBe('12')
    expect(answer.fee).toBe('')
  })
})
