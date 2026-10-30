import { describe, expect, it } from 'vitest'
import { DEMO_CODES } from './demo.ts'
import type { FormResponse, MeetingAnswer } from './form.ts'
import { applyMeetingResponses } from './meetings.ts'

const groups = [
  { id: 'GDL-orti', name: 'Orti e Suoli', formKey: DEMO_CODES['GDL-orti'] },
  { id: 'GDL-semi', name: 'Semi e Biodiversità', formKey: DEMO_CODES['GDL-semi'] },
]

const response = (fields: Partial<MeetingAnswer> = {}, id = 'm1'): FormResponse<MeetingAnswer> => ({
  id,
  submittedAt: new Date('2026-10-31T17:42:00Z'),
  answer: {
    group: 'Orti e Suoli',
    code: DEMO_CODES['GDL-orti'],
    day: '2026-11-05',
    time: '18:30',
    meet: 'https://meet.google.com/abc-defg-hij',
    visible: 'Sì',
    ...fields,
  },
})

describe('le risposte del Modulo «Prossimo incontro»', () => {
  it('una risposta valida diventa una riga di «Incontri», col GdL dal codice del gruppo', () => {
    expect(applyMeetingResponses([response()], groups)).toEqual([
      {
        response: response(),
        cells: {
          GdL: 'GDL-orti',
          'data e ora': '2026-11-05 18:30',
          'link Meet': 'https://meet.google.com/abc-defg-hij',
          'visibile ai soci': 'sì',
        },
        outcome: 'aggiunto',
      },
    ])
  })

  it('«No» vuol dire non visibile ai soci', () => {
    const [row] = applyMeetingResponses([response({ visible: 'No' })], groups)
    expect(row?.cells['visibile ai soci']).toBe('no')
  })

  it.each([
    ['il codice del gruppo è sbagliato', { code: 'sbagliato' }, 'codice del gruppo sbagliato'],
    ['il giorno non si legge', { day: '5 novembre' }, 'il giorno «5 novembre» non lo leggo'],
    ['l’ora non si legge', { time: 'sera' }, 'l’ora «sera» non la leggo'],
    ['il link non è di Meet', { meet: 'https://zoom.us/j/1' }, 'il link non è di Meet'],
  ])('se %s, la riga resta «da controllare» e non esce', (_, fields, reason) => {
    const [row] = applyMeetingResponses([response(fields)], groups)
    expect(row?.outcome).toBe(`da controllare: ${reason}`)
  })

  it('con un codice di due gruppi non sceglie', () => {
    const twins = [...groups, { id: 'GDL-copia', name: 'Copia', formKey: DEMO_CODES['GDL-orti'] }]
    expect(applyMeetingResponses([response()], twins)[0]?.outcome).toBe(
      'da controllare: il codice del gruppo è di più gruppi',
    )
  })
})
