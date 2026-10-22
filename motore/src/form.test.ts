import { describe, expect, it } from 'vitest'
import { DEMO_PREFILL_URL } from './demo.ts'
import {
  answerFromItems,
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
