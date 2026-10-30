import { describe, expect, it } from 'vitest'
import { parseReservedSnapshot, recentResolutions, type ReservedSnapshot } from './reserved.ts'

const FORM = 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url'

const snapshot: ReservedSnapshot = {
  version: 1,
  publishedAt: '2026-10-18T19:00:00.000Z',
  staleDays: 30,
  groups: [
    {
      id: 'GDL-orti',
      name: 'Orti e Suoli',
      newProjectUrl: `${FORM}&entry.1=Orti`,
      newMeetingUrl: `${FORM.replace('abc', 'inc')}&entry.1=Orti`,
    },
  ],
  projects: [
    {
      id: 'CAN-0001',
      groupId: 'GDL-orti',
      title: 'Rete dei mercati contadini',
      stage: 'ongoing',
      lastNews: 'Fissata la sala.',
      nextStep: 'Mandare l’invito',
      dueOn: '2026-11-30',
      updatedOn: '2026-10-15',
      helpWanted: '',
      updateUrl: `${FORM}&entry.2=CAN-0001`,
    },
  ],
  people: [
    {
      fingerprint: '070fe12ea53b8b0fd3527700f2ff8122aaeb6860151ce291595ec753d4a311d1',
      memberNumber: '12',
      roles: ['board', 'rep'],
      groupId: 'GDL-orti',
    },
  ],
  deadlines: [
    {
      id: 'SCA-0001',
      what: 'Bilancio 2026 al Direttivo',
      kind: 'duty',
      dueOn: '2026-11-15',
      ownerRole: 'il tesoriere',
      doneOn: null,
    },
  ],
  resolutions: [
    {
      date: '2026-06-12',
      body: 'Direttivo',
      subject: 'Incarichi a solo rimborso spese',
      minutesUrl: 'https://drive.google.com/file/d/abc/view',
      ratifiedOn: null,
    },
  ],
  issues: [{ what: 'Diritti dei soci sostenitori', since: '2026-04-27', ownerRole: 'il Direttivo' }],
  budget: {
    updatedOn: '2026-10-10',
    lines: [{ label: 'Ciclo webinar e corsi', planned: 5000, spent: 1200.5 }],
  },
  meetings: [
    {
      groupId: 'GDL-orti',
      startsAt: '2026-11-05T18:30',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      membersCanSee: false,
    },
  ],
  commitments: [],
  commitmentFormUrl: `${FORM.replace('abc', 'imp')}`,
}

describe('parseReservedSnapshot', () => {
  it('accetta l’istantanea che scrive il motore', () => {
    expect(parseReservedSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it.each([
    ['niente', null],
    ['un testo', 'ciao'],
    ['una versione nuova', { ...snapshot, version: 2 }],
    ['una data di pubblicazione che non è una data', { ...snapshot, publishedAt: 'ieri' }],
    ['i cantieri che non sono un elenco', { ...snapshot, projects: {} }],
  ])('rifiuta %s', (_, value) => {
    expect(parseReservedSnapshot(value)).toBeNull()
  })

  it('scarta un cantiere con uno stato che non conosce, e tiene gli altri', () => {
    const value = { ...snapshot, projects: [...snapshot.projects, { ...snapshot.projects[0], stage: 'chissà' }] }
    expect(parseReservedSnapshot(value)?.projects).toHaveLength(1)
  })

  it('un link che non porta ai Moduli di Google non passa', () => {
    const project = { ...snapshot.projects[0], updateUrl: 'javascript:alert(1)' }
    expect(parseReservedSnapshot({ ...snapshot, projects: [project] })?.projects[0]?.updateUrl).toBeNull()
  })

  it('un’istantanea di T1, senza scadenze, delibere, questioni, budget e incontri, si legge con le sezioni vuote', () => {
    const { version, publishedAt, staleDays, projects, people } = snapshot
    const groups = snapshot.groups.map(({ id, name, newProjectUrl }) => ({ id, name, newProjectUrl }))
    const t1 = { version, publishedAt, staleDays, groups, projects, people }
    expect(parseReservedSnapshot(t1)).toEqual({
      ...t1,
      groups: groups.map((group) => ({ ...group, newMeetingUrl: null })),
      deadlines: [],
      resolutions: [],
      issues: [],
      budget: { updatedOn: null, lines: [] },
      meetings: [],
      commitments: [],
      commitmentFormUrl: null,
    })
  })

  it('un incontro senza il link di Meet, o senza dire se è visibile ai soci, non passa', () => {
    const [meeting] = snapshot.meetings
    const meetings = [meeting, { ...meeting, meetUrl: 'https://zoom.us/j/1' }, { ...meeting, membersCanSee: 'sì' }]
    expect(parseReservedSnapshot({ ...snapshot, meetings })?.meetings).toEqual([meeting])
  })

  it.each([
    ['le scadenze', { deadlines: {} }],
    ['le delibere', { resolutions: 'no' }],
    ['le questioni', { issues: 3 }],
    ['il budget', { budget: { lines: {} } }],
  ])('rifiuta %s che non sono un elenco', (_, fields) => {
    expect(parseReservedSnapshot({ ...snapshot, ...fields })).toBeNull()
  })

  it('scarta una scadenza con un tipo che non conosce o senza data, e tiene le altre', () => {
    const [first] = snapshot.deadlines
    const deadlines = [first, { ...first, id: 'x', kind: 'chissà' }, { ...first, id: 'y', dueOn: 'presto' }]
    expect(parseReservedSnapshot({ ...snapshot, deadlines })?.deadlines.map((item) => item.id)).toEqual(['SCA-0001'])
  })

  it('il link al verbale che non porta al Drive non passa', () => {
    const resolution = { ...snapshot.resolutions[0], minutesUrl: 'https://example.org/verbale.pdf' }
    expect(parseReservedSnapshot({ ...snapshot, resolutions: [resolution] })?.resolutions[0]?.minutesUrl).toBeNull()
  })

  it('un importo che non è un numero diventa vuoto, non zero', () => {
    const line = { label: 'Sito web', planned: '500', spent: Number.NaN }
    const budget = { updatedOn: '2026-10-10', lines: [line] }
    expect(parseReservedSnapshot({ ...snapshot, budget })?.budget.lines[0]).toEqual({
      label: 'Sito web',
      planned: null,
      spent: null,
    })
  })

  it('di una persona tiene solo i ruoli che conosce', () => {
    const person = { ...snapshot.people[0], roles: ['board', 're'] }
    expect(parseReservedSnapshot({ ...snapshot, people: [person] })?.people[0]?.roles).toEqual(['board'])
  })
})

describe('recentResolutions', () => {
  const resolution = (date: string) => ({ date, body: 'Direttivo', subject: date, minutesUrl: null, ratifiedOn: null })

  it('tiene le delibere degli ultimi 12 mesi, dalla più recente', () => {
    const list = ['2025-10-18', '2026-06-12', '2025-10-19', '2026-10-19', '2026-02-15'].map(resolution)
    expect(recentResolutions(list, '2026-10-19').map((item) => item.date)).toEqual([
      '2026-10-19',
      '2026-06-12',
      '2026-02-15',
      '2025-10-19',
    ])
  })
})
