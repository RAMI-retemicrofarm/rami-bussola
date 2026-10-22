import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { readGroups, readProjects, readTable, SHEETS } from './content.ts'
import { DEMO_CODES, demoSheets } from './demo.ts'
import type { FormResponse, UpdateAnswer } from './form.ts'
import { memoryWorkbook } from './memory.ts'
import { applyUpdates } from './updates.ts'

const now = new Date('2026-10-31T10:00:00Z')
const workbook = memoryWorkbook(demoSheets(now))
const groups = readGroups(readTable(workbook, SHEETS.groups))
const projects = readProjects(readTable(workbook, SHEETS.projects), romeDate, [])

const answer = (fields: Partial<UpdateAnswer>): UpdateAnswer => ({
  group: 'Orti e Suoli',
  project: 'Rete dei mercati contadini (CAN-0001)',
  code: DEMO_CODES['GDL-orti'],
  who: 'Marta',
  stage: 'In revisione',
  news: 'Fissate le date.',
  nextStep: 'mandare gli inviti',
  dueOn: '2026-11-20',
  help: '',
  ...fields,
})
const response = (fields: Partial<UpdateAnswer> = {}, id = 'r1'): FormResponse => ({
  id,
  submittedAt: new Date('2026-10-31T17:42:00Z'),
  answer: answer(fields),
})

describe('applyUpdates', () => {
  it('una risposta valida aggiorna il cantiere, con «aggiornato il» all’ora della risposta', () => {
    const { changes, outcomes } = applyUpdates([response()], groups, projects)
    expect(changes).toEqual([
      expect.objectContaining({
        id: 'CAN-0001',
        isNew: false,
        stage: 'review',
        lastNews: 'Fissate le date.',
        nextStep: 'mandare gli inviti',
        dueOn: '2026-11-20',
        helpWanted: '',
        updatedAt: new Date('2026-10-31T17:42:00Z'),
        closedAt: null,
      }),
    ])
    expect(outcomes[0]?.outcome).toBe('applicata a CAN-0001')
  })

  it('con il codice del gruppo sbagliato non cambia niente, e la risposta è da controllare', () => {
    const { changes, outcomes } = applyUpdates([response({ code: 'codice-vecchio' })], groups, projects)
    expect(changes).toEqual([])
    expect(outcomes[0]?.outcome).toBe('da controllare: codice del gruppo sbagliato')
  })

  it('senza codice del gruppo è da controllare', () => {
    const { outcomes } = applyUpdates([response({ code: '' })], groups, projects)
    expect(outcomes[0]?.outcome).toBe('da controllare: codice del gruppo sbagliato')
  })

  it('senza cantiere scelto nasce un cantiere nuovo, nel gruppo del codice', () => {
    const { changes, outcomes } = applyUpdates(
      [response({ project: 'Corso di potatura', code: DEMO_CODES['GDL-formazione'] })],
      groups,
      projects,
    )
    expect(changes).toEqual([
      expect.objectContaining({ id: 'CAN-0006', isNew: true, groupId: 'GDL-formazione', title: 'Corso di potatura' }),
    ])
    expect(outcomes[0]?.outcome).toBe('nuovo cantiere CAN-0006')
  })

  it('un cantiere nuovo senza nome ne prende uno di ripiego', () => {
    const { changes } = applyUpdates([response({ project: '  ' })], groups, projects)
    expect(changes[0]?.title).toBe('Cantiere senza nome')
  })

  it('due cantieri nuovi nella stessa volta hanno id diversi', () => {
    const { changes } = applyUpdates(
      [response({ project: 'Uno' }, 'r1'), response({ project: 'Due' }, 'r2')],
      groups,
      projects,
    )
    expect(changes.map((change) => change.id)).toEqual(['CAN-0006', 'CAN-0007'])
  })

  it('il numero del cantiere nuovo viene dopo ogni id del Foglio, anche delle righe che non si pubblicano', () => {
    const { changes } = applyUpdates([response({ project: 'Siepi' })], groups, projects, ['CAN-0001', 'CAN-0009', ''])
    expect(changes[0]?.id).toBe('CAN-0010')
  })

  it('un cantiere nuovo col titolo di uno aperto del gruppo aggiorna quello: un invio doppio non fa due cantieri', () => {
    const { changes, outcomes } = applyUpdates(
      [response({ project: ' rete dei mercati  Contadini ' })],
      groups,
      projects,
    )
    expect(changes).toEqual([expect.objectContaining({ id: 'CAN-0001', isNew: false })])
    expect(outcomes[0]?.outcome).toBe('applicata a CAN-0001')
  })

  it('due risposte per lo stesso cantiere nuovo nella stessa volta fanno un cantiere solo, con l’ultima', () => {
    const { changes, outcomes } = applyUpdates(
      [response({ project: 'Siepi', news: 'prima' }, 'r1'), response({ project: 'Siepi', news: 'dopo' }, 'r2')],
      groups,
      projects,
    )
    expect(changes).toEqual([
      expect.objectContaining({ id: 'CAN-0006', isNew: true, title: 'Siepi', lastNews: 'dopo' }),
    ])
    expect(outcomes.map((item) => item.outcome)).toEqual(['nuovo cantiere CAN-0006', 'applicata a CAN-0006'])
  })

  it('col titolo di un cantiere chiuso, o di un altro gruppo, nasce un cantiere nuovo', () => {
    const { changes } = applyUpdates(
      [response({ project: 'Orto didattico' }, 'r1'), response({ project: 'Corso sui suoli vivi' }, 'r2')],
      groups,
      projects,
    )
    expect(changes.map((change) => [change.id, change.isNew])).toEqual([
      ['CAN-0006', true],
      ['CAN-0007', true],
    ])
  })

  it('un codice che hanno due gruppi è da controllare', () => {
    const twins = groups.map((group) =>
      group.id === 'GDL-semi' ? { ...group, formKey: DEMO_CODES['GDL-orti'] } : group,
    )
    const { changes, outcomes } = applyUpdates([response()], twins, projects)
    expect(changes).toEqual([])
    expect(outcomes[0]?.outcome).toBe('da controllare: il codice del gruppo è di più gruppi')
  })

  it('il cantiere di un altro gruppo è da controllare', () => {
    const { changes, outcomes } = applyUpdates(
      [response({ project: 'Scambio di semi autunnale (CAN-0002)' })],
      groups,
      projects,
    )
    expect(changes).toEqual([])
    expect(outcomes[0]?.outcome).toBe('da controllare: il cantiere CAN-0002 non è di questo gruppo')
  })

  it('uno stato che non conosce è da controllare', () => {
    const { outcomes } = applyUpdates([response({ stage: 'Fermo' })], groups, projects)
    expect(outcomes[0]?.outcome).toBe('da controllare: lo stato «Fermo» non lo conosco')
  })

  it('«chiuso» segna anche il giorno della chiusura', () => {
    const { changes } = applyUpdates([response({ stage: 'Chiuso' })], groups, projects)
    expect(changes[0]).toMatchObject({ stage: 'closed', closedAt: new Date('2026-10-31T17:42:00Z') })
  })

  it('la richiesta di aiuto passa nel cantiere', () => {
    const { changes } = applyUpdates([response({ help: ' Da Struttura, per la sala. ' })], groups, projects)
    expect(changes[0]?.helpWanted).toBe('Da Struttura, per la sala.')
  })
})
