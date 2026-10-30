import { describe, expect, it } from 'vitest'
import {
  CALENDAR_NAME,
  calendarPlan,
  eventTitle,
  REMINDER_DAYS,
  syncDeadlineCalendar,
  type CalendarEvent,
  type DeadlineCalendar,
} from './calendar.ts'
import type { DeadlineRow } from './content.ts'

const deadline = (fields: Partial<DeadlineRow> & { id: string }): DeadlineRow => ({
  what: `Scadenza ${fields.id}`,
  kind: 'duty',
  dueOn: '2026-11-30',
  ownerRole: 'il tesoriere',
  doneOn: null,
  membersCanSee: false,
  ...fields,
})

describe('calendarPlan', () => {
  it('crea gli eventi delle scadenze aperte, aggiorna quelli cambiati, toglie le fatte e quelle sparite', () => {
    const deadlines = [
      deadline({ id: 'SCA-0001' }),
      deadline({ id: 'SCA-0002', what: 'Assemblea', kind: 'assembly', dueOn: '2027-03-20', ownerRole: '' }),
      deadline({ id: 'SCA-0003', doneOn: '2026-11-01' }),
    ]
    const events: CalendarEvent[] = [
      { id: 'ev-1', deadlineId: 'SCA-0001', title: 'Scadenza SCA-0001 · segue: il tesoriere', date: '2026-11-15' },
      { id: 'ev-3', deadlineId: 'SCA-0003', title: 'Scadenza SCA-0003 · segue: il tesoriere', date: '2026-11-01' },
      { id: 'ev-9', deadlineId: 'SCA-0009', title: 'Vecchia', date: '2026-10-01' },
    ]
    expect(calendarPlan(deadlines, events)).toEqual({
      create: [{ deadlineId: 'SCA-0002', title: 'Assemblea (Assemblea)', date: '2027-03-20' }],
      update: [{ id: 'ev-1', title: 'Scadenza SCA-0001 · segue: il tesoriere', date: '2026-11-30' }],
      remove: ['ev-3', 'ev-9'],
    })
  })

  it('un evento uguale non si tocca', () => {
    const deadlines = [deadline({ id: 'SCA-0001' })]
    const events = [
      { id: 'ev-1', deadlineId: 'SCA-0001', title: eventTitle(deadlines[0] as DeadlineRow), date: '2026-11-30' },
    ]
    expect(calendarPlan(deadlines, events)).toEqual({ create: [], update: [], remove: [] })
  })

  it('il titolo dice cosa, il tipo quando non è un adempimento, e chi segue', () => {
    expect(eventTitle(deadline({ id: 'a', what: 'Bilancio' }))).toBe('Bilancio · segue: il tesoriere')
    expect(eventTitle(deadline({ id: 'a', what: 'Bando X', kind: 'call', ownerRole: '' }))).toBe('Bando X (Bando)')
    expect(eventTitle(deadline({ id: 'a', what: 'Conta', kind: 'measure', ownerRole: 'il segretario' }))).toBe(
      'Conta (Misura) · segue: il segretario',
    )
  })
})

describe('syncDeadlineCalendar', () => {
  it('applica il piano sul calendario «Scadenze RAMI», con l’avviso 7 giorni prima', () => {
    const log: string[] = []
    const calendar: DeadlineCalendar = {
      events: () => [{ id: 'ev-1', deadlineId: 'SCA-0001', title: 'vecchio', date: '2026-11-15' }],
      create: (deadlineId, title, date) => void log.push(`crea ${deadlineId} «${title}» ${date}`),
      update: (id, title, date) => void log.push(`aggiorna ${id} «${title}» ${date}`),
      remove: (id) => void log.push(`togli ${id}`),
    }
    const deadlines = [deadline({ id: 'SCA-0001' }), deadline({ id: 'SCA-0002', what: 'Nuova', ownerRole: '' })]
    expect(syncDeadlineCalendar(deadlines, calendar)).toEqual({ created: 1, updated: 1, removed: 0 })
    expect(log).toEqual([
      'crea SCA-0002 «Nuova» 2026-11-30',
      'aggiorna ev-1 «Scadenza SCA-0001 · segue: il tesoriere» 2026-11-30',
    ])
    expect(CALENDAR_NAME).toBe('Scadenze RAMI')
    expect(REMINDER_DAYS).toBe(7)
  })
})
