import {
  FINGERPRINT_VECTOR,
  normalizeEmail,
  parseReservedSnapshot,
  parseSiteSnapshot,
  romeDate,
  romeDateTime,
} from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  readBudget,
  readDeadlines,
  readFirstDay,
  readGroups,
  readIssues,
  readLinks,
  readMeetings,
  readPeople,
  readProjects,
  readReferents,
  readResolutions,
  readSettings,
  readTable,
  SHEETS,
} from './content.ts'
import {
  DEMO_CODES,
  DEMO_COMMITMENT_FORM_URL,
  DEMO_EMAILS,
  DEMO_MEET,
  DEMO_MEETING_PREFILL_URL,
  DEMO_OFFICE_URL,
  DEMO_PREFILL_URL,
  DEMO_REFERENTS,
  demoSheets,
} from './demo.ts'
import { readCommitments } from './commitments.ts'
import { MEETING_FORM, parsePrefilledUrl } from './form.ts'
import { memoryWorkbook } from './memory.ts'
import { buildReservedSnapshot, buildSnapshots, findViolations, SITE_SHAPE, type SnapshotSheets } from './snapshots.ts'
import { NOT_APPLIED } from './updates.ts'

const now = new Date('2026-10-31T10:00:00Z')
const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const fingerprint = (email: string) => sha256Hex(normalizeEmail(email))

const today = romeDate(now)

/** Le sezioni di T2 lette dal Foglio, come le legge il giro. */
function sections(workbook: ReturnType<typeof memoryWorkbook>) {
  const groupNames = readGroups(readTable(workbook, SHEETS.groups)).map((group) => group.name)
  return {
    deadlines: readDeadlines(readTable(workbook, SHEETS.deadlines), romeDate, [], groupNames),
    resolutions: readResolutions(readTable(workbook, SHEETS.resolutions), romeDate, []),
    issues: readIssues(readTable(workbook, SHEETS.issues), romeDate, [], groupNames),
    budget: readBudget(readTable(workbook, SHEETS.budget), romeDate, []),
    today,
  }
}

function build(sheets = demoSheets(now), day = today) {
  const workbook = memoryWorkbook(sheets)
  return buildReservedSnapshot({
    groups: readGroups(readTable(workbook, SHEETS.groups)),
    projects: readProjects(readTable(workbook, SHEETS.projects), romeDate, []),
    people: readPeople(readTable(workbook, SHEETS.people), []),
    settings: readSettings(readTable(workbook, SHEETS.settings), []),
    prefill: parsePrefilledUrl(DEMO_PREFILL_URL),
    fingerprint,
    ...sections(workbook),
    today: day,
  })
}

/** Aggiunge una riga a una scheda del Foglio finto, coi valori per nome. */
function addRow(
  sheets: Record<string, unknown[][]>,
  spec: { name: string; columns: readonly string[] },
  values: Record<string, unknown>,
) {
  sheets[spec.name]?.push(spec.columns.map((name) => values[name] ?? ''))
}

/** Cambia una cella di una scheda del Foglio finto: la riga conta da 1, dopo l'intestazione. */
function setCell(
  sheets: Record<string, unknown[][]>,
  spec: { name: string; columns: readonly string[] },
  row: number,
  column: string,
  value: unknown,
) {
  const cells = sheets[spec.name]?.[row]
  if (cells) cells[spec.columns.indexOf(column)] = value
}

describe('l’impronta delle mail nel motore', () => {
  it('torna col vettore di prova condiviso con la vetrina', () => {
    expect(fingerprint(FINGERPRINT_VECTOR.email)).toBe(FINGERPRINT_VECTOR.fingerprint)
  })
})

describe('buildReservedSnapshot', () => {
  it('scrive un’istantanea che la vetrina accetta', () => {
    const snapshot = { ...build(), publishedAt: now.toISOString() }
    expect(parseReservedSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('ha i cantieri aperti, non quelli chiusi', () => {
    expect(build().projects.map((project) => project.id)).toEqual(['CAN-0001', 'CAN-0002', 'CAN-0003', 'CAN-0004'])
  })

  it('ogni cantiere ha il link al Modulo con gruppo, cantiere e codice del gruppo', () => {
    const url = new URL(build().projects[1]?.updateUrl ?? '')
    expect(url.searchParams.get('entry.1001')).toBe('Semi e Biodiversità')
    expect(url.searchParams.get('entry.1002')).toBe('Scambio di semi autunnale (CAN-0002)')
    expect(url.searchParams.get('entry.1003')).toBe(DEMO_CODES['GDL-semi'])
  })

  it('ogni gruppo ha il link per un cantiere nuovo, senza cantiere', () => {
    const url = new URL(build().groups.find((group) => group.id === 'GDL-orti')?.newProjectUrl ?? '')
    expect(url.searchParams.get('entry.1003')).toBe(DEMO_CODES['GDL-orti'])
    expect(url.searchParams.has('entry.1002')).toBe(false)
  })

  it('senza il Modulo collegato, i link mancano', () => {
    const workbook = memoryWorkbook(demoSheets(now))
    const snapshot = buildReservedSnapshot({
      groups: readGroups(readTable(workbook, SHEETS.groups)),
      projects: readProjects(readTable(workbook, SHEETS.projects), romeDate, []),
      people: [],
      settings: { staleDays: 30, officeUrl: null, feeVisibleDefault: false },
      prefill: null,
      fingerprint,
      ...sections(workbook),
    })
    expect(snapshot.projects[0]?.updateUrl).toBeNull()
    expect(snapshot.groups[0]?.newProjectUrl).toBeNull()
  })

  it('le Persone della Riservata ci sono solo come impronte, con numero socio, ruoli e GdL', () => {
    const rep = build().people.find((person) => person.fingerprint === fingerprint(DEMO_EMAILS.rep))
    expect(rep).toEqual({
      fingerprint: fingerprint(DEMO_EMAILS.rep),
      memberNumber: '34',
      roles: ['rep'],
      groupId: 'GDL-orti',
    })
  })

  it('i giorni per «fermo» vengono dalle impostazioni', () => {
    expect(build().staleDays).toBe(30)
  })

  it('l’ordine delle righe nel Foglio non cambia l’istantanea, salvo il budget', () => {
    const sheets = demoSheets(now)
    for (const name of ['Cantieri', 'Scadenze', 'Delibere', 'Questioni']) {
      const [header, ...rows] = sheets[name] ?? []
      sheets[name] = [header ?? [], ...rows.reverse()]
    }
    expect(build(sheets)).toEqual(build())
  })
})

describe('le sezioni di T2 nell’istantanea riservata', () => {
  it('le scadenze sono le aperte e le fatte di quest’anno, per data, coi campi della Riservata', () => {
    const { deadlines } = build()
    expect(deadlines.map((deadline) => deadline.id)).toEqual([
      'SCA-0006',
      'SCA-0001',
      'SCA-0007',
      'SCA-0008',
      'SCA-0002',
      'SCA-0003',
      'SCA-0004',
      'SCA-0005',
      'SCA-0009',
      'SCA-0010',
    ])
    expect(deadlines[0]).toEqual({
      id: 'SCA-0006',
      what: "Dichiarazione annuale dell'ente",
      kind: 'tax',
      dueOn: '2026-09-21',
      ownerRole: 'il tesoriere',
      doneOn: '2026-09-23',
    })
  })

  it('una scadenza fatta l’anno prima non c’è; una aperta dell’anno prima sì', () => {
    const sheets = demoSheets(now)
    const base = { tipo: 'adempimento', 'chi segue (ruolo)': 'il tesoriere' }
    addRow(sheets, SHEETS.deadlines, {
      ...base,
      id: 'SCA-0101',
      cosa: 'Rendiconto',
      data: '2025-12-20',
      'fatta il': '2025-12-18',
    })
    addRow(sheets, SHEETS.deadlines, { ...base, id: 'SCA-0102', cosa: 'RUNTS', data: '2025-12-30' })
    const ids = build(sheets).deadlines.map((deadline) => deadline.id)
    expect(ids).not.toContain('SCA-0101')
    expect(ids).toContain('SCA-0102')
  })

  it('a gennaio restano anche le fatte dell’anno prima: O7 dell’anno chiuso si legge fino al 31/1', () => {
    const sheets = demoSheets(now)
    addRow(sheets, SHEETS.deadlines, {
      tipo: 'adempimento',
      'chi segue (ruolo)': 'il tesoriere',
      id: 'SCA-0101',
      cosa: 'Rendiconto',
      data: '2026-12-20',
      'fatta il': '2027-01-05',
    })
    const ids = (day: string) => build(sheets, day).deadlines.map((deadline) => deadline.id)
    expect(ids('2027-01-31')).toContain('SCA-0101')
    expect(ids('2027-02-01')).not.toContain('SCA-0101')
  })

  it('una scadenza fra 31 giorni c’è: la finestra dei 30 giorni la fa la pagina, e l’istantanea non cambia a mezzanotte', () => {
    expect(build().deadlines.find((deadline) => deadline.id === 'SCA-0005')?.dueOn).toBe('2026-12-01')
  })

  it('un nome in «chi segue» non arriva mai nell’istantanea', () => {
    const sheets = demoSheets(now)
    setCell(sheets, SHEETS.deadlines, 1, 'chi segue (ruolo)', 'Mario Rossi')
    setCell(sheets, SHEETS.issues, 1, 'chi (ruolo)', 'Lucia')
    const snapshot = build(sheets)
    expect(JSON.stringify(snapshot)).not.toContain('Mario Rossi')
    expect(JSON.stringify(snapshot)).not.toContain('Lucia')
    expect(snapshot.deadlines.find((deadline) => deadline.id === 'SCA-0001')?.ownerRole).toBe('')
  })

  it('le delibere sono quelle degli ultimi 12 mesi, dalla più recente', () => {
    const { resolutions } = build()
    expect(resolutions.map((resolution) => resolution.subject)).toEqual([
      'Calendario dei mercati di primavera',
      'Via alla prima versione della Bussola',
      'Spesa per il webinar sui suoli',
      "Bilancio dell'anno passato",
      'Incarichi a solo rimborso spese',
      'Fondo per i viaggi dei rappresentanti',
      'Ammissione dei nuovi soci',
    ])
    expect(resolutions[0]).toEqual({
      date: '2026-10-21',
      body: 'Coordinamento',
      subject: 'Calendario dei mercati di primavera',
      minutesUrl: 'https://drive.google.com/file/d/demo-verbale-01/view',
      ratifiedOn: '2026-10-28',
    })
    expect(resolutions[2]?.minutesUrl).toBeNull()
  })

  it('le questioni sono le aperte, dalla più vecchia, quelle senza data in fondo', () => {
    const sheets = demoSheets(now)
    addRow(sheets, SHEETS.issues, { cosa: 'Assicurazione dei volontari', 'chi (ruolo)': 'il segretario' })
    expect(build(sheets).issues).toEqual([
      { what: 'Doppio tesseramento con altre associazioni', since: '2026-08-02', ownerRole: 'il tesoriere' },
      { what: 'Diritti dei soci sostenitori', since: '2026-09-01', ownerRole: 'il Direttivo' },
      { what: 'Codice etico per sponsorizzazioni e donazioni', since: '2026-10-01', ownerRole: '' },
      { what: 'Assicurazione dei volontari', since: null, ownerRole: 'il segretario' },
    ])
  })

  it('il budget ha le righe nell’ordine del Foglio e l’ultima data del tesoriere', () => {
    expect(build().budget).toEqual({
      updatedOn: '2026-10-22',
      lines: [
        { label: 'Ciclo webinar e corsi', planned: 5000, spent: 1200 },
        { label: 'Sito web', planned: 500, spent: 500 },
        { label: 'Raduno di Cervia', planned: 4771.5, spent: 4210 },
        { label: 'Tesseramento online (IMP-0003)', planned: 800, spent: 200 },
        { label: 'Verbali del Coordinamento', planned: 600, spent: 300 },
      ],
    })
  })

  it('il budget non ancora arrivato è vuoto, senza zeri', () => {
    const sheets = demoSheets(now)
    sheets.Budget = [[...SHEETS.budget.columns], ['Sito web', '', '', '']]
    expect(build(sheets).budget).toEqual({ updatedOn: null, lines: [] })
  })
})

describe('la lista ammessa dell’istantanea riservata', () => {
  it('l’istantanea costruita dal Foglio la rispetta', () => {
    expect(findViolations(build())).toEqual([])
  })

  it('nessuna mail e nessun nome di persona: né referenti, né chi ha risposto, né le mail della Riservata', () => {
    const sheets = demoSheets(now)
    sheets.Aggiornamenti?.push(['r1', now, 'Orti e Suoli', '', 'k', 'Giulia Verdi', 'In corso', 'x', 'y', '', '', ''])
    const json = JSON.stringify(build(sheets))
    for (const name of ['Marta Bellini', 'Davide Russo', 'Anna Ferri', 'Giulia Verdi']) expect(json).not.toContain(name)
    for (const email of Object.values(DEMO_EMAILS)) expect(json).not.toContain(email)
    expect(json).not.toMatch(/@/)
  })

  it('un campo fuori dalla lista, come la mail di un socio, è una violazione', () => {
    const snapshot = build()
    const people = snapshot.people.map((person, i) => (i === 0 ? { ...person, mail: 'socio@example.org' } : person))
    expect(findViolations({ ...snapshot, people })).toEqual(['people[0].mail: campo fuori dalla lista ammessa'])
  })

  it('una mail scritta in un testo è una violazione', () => {
    const snapshot = build()
    const projects = snapshot.projects.map((project, i) =>
      i === 2 ? { ...project, nextStep: 'scrivere a mario.rossi@example.org' } : project,
    )
    expect(findViolations({ ...snapshot, projects })).toEqual(['projects[CAN-0003].nextStep: c’è una mail'])
  })

  it('un numero di telefono scritto in un testo è una violazione', () => {
    const snapshot = build()
    const projects = snapshot.projects.map((project, i) =>
      i === 0 ? { ...project, helpWanted: 'chiamare il 333 123 4567' } : project,
    )
    expect(findViolations({ ...snapshot, projects })).toEqual([
      'projects[CAN-0001].helpWanted: c’è un numero di telefono',
    ])
  })

  it('un telefono scritto in altri modi è una violazione', () => {
    const snapshot = build()
    for (const phone of ['+39 333 1234567', '(+39) 06/1234567', '333.123.4567', '0039-02-12345678', '3331234567']) {
      const projects = snapshot.projects.map((project, i) =>
        i === 1 ? { ...project, lastNews: `Per i semi: ${phone}, dopo le 18:30` } : project,
      )
      expect(findViolations({ ...snapshot, projects }), phone).toEqual([
        'projects[CAN-0002].lastNews: c’è un numero di telefono',
      ])
    }
  })

  it('una data con l’ora o con un importo non sembra un telefono', () => {
    const snapshot = build()
    for (const text of [
      'Riunione il 12/11/2026 18:30 in videochiamata',
      'Il 15/10/2026 1.200 € per le sementi',
      'Dal 2026-10-18 09:00 al 2026-10-19 18.30',
      'Il 12/11 alle 18:30, il 13/11 alle 9.15',
      'Il 3.11.2026 1.500 piantine',
    ]) {
      const projects = snapshot.projects.map((project, i) => (i === 0 ? { ...project, nextStep: text } : project))
      expect(findViolations({ ...snapshot, projects }), text).toEqual([])
    }
  })

  it('le date e gli importi non sembrano numeri di telefono', () => {
    const snapshot = build()
    const projects = snapshot.projects.map((project, i) =>
      i === 0 ? { ...project, lastNews: 'Il 15/10/2026 spesi 1.200 €, il 2026-10-18 altri 300.' } : project,
    )
    expect(findViolations({ ...snapshot, projects })).toEqual([])
  })

  it('una mail nell’oggetto di una delibera e un telefono in una questione fermano la pubblicazione', () => {
    const sheets = demoSheets(now)
    setCell(sheets, SHEETS.resolutions, 1, 'oggetto', 'Scrivere a tesoriere@example.org')
    setCell(sheets, SHEETS.issues, 2, 'cosa', 'Richiamare lo sponsor al 333 123 4567')
    expect(findViolations(build(sheets))).toEqual([
      'resolutions[0].subject: c’è una mail',
      'issues[2].what: c’è un numero di telefono',
    ])
  })

  it('un verbale che non porta al Drive è una violazione', () => {
    const snapshot = build()
    const resolutions = snapshot.resolutions.map((resolution, i) =>
      i === 0 ? { ...resolution, minutesUrl: 'https://example.org/verbale.pdf' } : resolution,
    )
    expect(findViolations({ ...snapshot, resolutions })).toEqual(['resolutions[0].minutesUrl: non è un link al Drive'])
  })

  it('un campo in più nelle scadenze o nel budget è una violazione', () => {
    const snapshot = build()
    const deadlines = snapshot.deadlines.map((deadline, i) => (i === 0 ? { ...deadline, owner: 'Mario' } : deadline))
    const budget = { ...snapshot.budget, note: 'x' }
    expect(findViolations({ ...snapshot, deadlines, budget })).toEqual([
      'deadlines[SCA-0006].owner: campo fuori dalla lista ammessa',
      'budget.note: campo fuori dalla lista ammessa',
    ])
  })

  it('un link che non porta ai Moduli di Google è una violazione', () => {
    const snapshot = build()
    const groups = snapshot.groups.map((group, i) =>
      i === 0 ? { ...group, newProjectUrl: 'https://example.org' } : group,
    )
    expect(findViolations({ ...snapshot, groups })).toEqual([
      'groups[GDL-comunicazione].newProjectUrl: non è un link ai Moduli',
    ])
  })
})

/** Le schede lette come le legge il giro, per buildSnapshots; `warnings` raccoglie quelli degli impegni. */
function readSheets(sheets = demoSheets(now), warnings: string[] = []): SnapshotSheets {
  const workbook = memoryWorkbook(sheets)
  const groups = readGroups(readTable(workbook, SHEETS.groups))
  const groupNames = groups.map((group) => group.name)
  const projects = readProjects(readTable(workbook, SHEETS.projects), romeDate, [])
  const people = readPeople(readTable(workbook, SHEETS.people), [])
  return {
    groups,
    projects,
    people,
    settings: readSettings(readTable(workbook, SHEETS.settings), []),
    prefill: parsePrefilledUrl(DEMO_PREFILL_URL),
    meetingPrefill: parsePrefilledUrl(DEMO_MEETING_PREFILL_URL, MEETING_FORM),
    fingerprint,
    deadlines: readDeadlines(readTable(workbook, SHEETS.deadlines), romeDate, [], groupNames),
    resolutions: readResolutions(readTable(workbook, SHEETS.resolutions), romeDate, []),
    issues: readIssues(readTable(workbook, SHEETS.issues), romeDate, [], groupNames),
    budget: readBudget(readTable(workbook, SHEETS.budget), romeDate, []),
    referents: readReferents(readTable(workbook, SHEETS.referents), romeDate, [], groups),
    meetings: readMeetings(readTable(workbook, SHEETS.meetings), romeDateTime, [], groups, NOT_APPLIED),
    links: readLinks(readTable(workbook, SHEETS.links), [], groups),
    firstDay: readFirstDay(readTable(workbook, SHEETS.firstDay), []),
    commitments: readCommitments(readTable(workbook, SHEETS.commitments), {
      toCalendarDate: romeDate,
      warnings,
      groups,
      projects,
      memberNumbers: people.flatMap((person) => (person.memberNumber ? [person.memberNumber] : [])),
      feeVisibleDefault: false,
      today,
    }),
    commitmentFormUrl: DEMO_COMMITMENT_FORM_URL,
  }
}

describe('buildSnapshots: l’istantanea del sito', () => {
  const site = (sheets = demoSheets(now)) => buildSnapshots(readSheets(sheets), today).site
  /** Il giorno di Roma fra `days` giorni, dal giorno delle prove. */
  const inDays = (days: number) => romeDate(new Date(now.getTime() + days * 86_400_000))

  it('scrive un’istantanea che la vetrina accetta, dentro la lista ammessa', () => {
    const snapshot = { ...site(), publishedAt: now.toISOString() }
    expect(findViolations(snapshot, SITE_SHAPE)).toEqual([])
    expect(parseSiteSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('i GdL con missione, come si partecipa, dove e quando; la chat solo se è aperta ai soci', () => {
    const groups = site().groups
    expect(groups.map((group) => group.name)).toEqual([
      'Comunicazione',
      'Formazione',
      'Orti e Suoli',
      'Semi e Biodiversità',
    ])
    const orti = groups.find((group) => group.id === 'GDL-orti')
    expect(orti).toMatchObject({
      mission: 'Mettere in rete gli orti dei soci e imparare insieme a curare il suolo.',
      howToJoin: 'Vieni a un incontro online: non serve iscriversi.',
      whereWhen: 'Online, un giovedì al mese alle 18:30.',
      chatUrl: 'https://chat.example.org/orti-e-suoli',
    })
    expect(groups.find((group) => group.id === 'GDL-semi')?.chatUrl).toBeNull()
    expect(JSON.stringify(groups)).not.toContain('semi-solo-partecipanti')
  })

  it('un referente col consenso ha nome e ruolo; senza, solo il ruolo, e il suo nome non è nell’istantanea', () => {
    const snapshot = site()
    expect(snapshot.groups.find((group) => group.id === 'GDL-orti')?.referents).toEqual([
      { name: 'Lia Prova', role: 'referente' },
      { name: null, role: 'co-referente' },
    ])
    const json = JSON.stringify(snapshot)
    for (const name of DEMO_REFERENTS.withConsent) expect(json).toContain(name)
    for (const name of DEMO_REFERENTS.withoutConsent) expect(json).not.toContain(name)
  })

  it('niente mail: né quelle dei referenti, né altre', () => {
    const json = JSON.stringify(site())
    for (const email of DEMO_REFERENTS.emails) expect(json).not.toContain(email)
    expect(json).not.toMatch(/[^\s@"]+@[^\s@"]+\.[a-z]+/)
  })

  it('un consenso con la data di domani non vale ancora', () => {
    const sheets = demoSheets(now)
    setCell(sheets, SHEETS.referents, 1, 'consenso dal', inDays(1))
    expect(JSON.stringify(site(sheets))).not.toContain('Lia Prova')
  })

  it('tolto il consenso, il nome sparisce dall’istantanea dopo', () => {
    const sheets = demoSheets(now)
    expect(JSON.stringify(site(sheets))).toContain('Lia Prova')
    setCell(sheets, SHEETS.referents, 1, 'consenso dal', '')
    const snapshot = site(sheets)
    expect(JSON.stringify(snapshot)).not.toContain('Lia Prova')
    expect(snapshot.groups.find((group) => group.id === 'GDL-orti')?.referents[0]).toEqual({
      name: null,
      role: 'referente',
    })
  })

  it('gli incontri visibili ai soci dei prossimi 60 giorni; quelli non visibili, come del Coordinamento, no', () => {
    const { meetings } = site()
    expect(meetings.map((meeting) => meeting.meetUrl)).toEqual([DEMO_MEET.orti, DEMO_MEET.semi])
    const json = JSON.stringify(site())
    expect(json).not.toContain(DEMO_MEET.coordination)
    expect(json).not.toContain(DEMO_MEET.ortiInternal)
    expect(json).not.toContain(DEMO_MEET.later)
  })

  it('un incontro a 60 giorni c’è; a 61 no; uno passato no', () => {
    const sheets = demoSheets(now)
    const add = (days: number, meet: string) =>
      addRow(sheets, SHEETS.meetings, {
        GdL: 'GDL-orti',
        'data e ora': `${inDays(days)} 10:00`,
        'link Meet': meet,
        'visibile ai soci': 'sì',
      })
    add(60, 'https://meet.google.com/a-60')
    add(61, 'https://meet.google.com/a-61')
    add(-1, 'https://meet.google.com/ieri')
    const urls = site(sheets).meetings.map((meeting) => meeting.meetUrl)
    expect(urls).toContain('https://meet.google.com/a-60')
    expect(urls).not.toContain('https://meet.google.com/a-61')
    expect(urls).not.toContain('https://meet.google.com/ieri')
  })

  it('i link, ognuno con chi lo può aprire', () => {
    expect(site().links.map(({ title, audience, groupId }) => [title, audience, groupId])).toEqual([
      ['Calendario degli incontri', 'all', null],
      ['Modulo per proporre un evento', 'members', null],
      ['Cartella dei semenzai', 'group', 'GDL-orti'],
      ['Verbali del Coordinamento', 'coordination', null],
    ])
  })

  it('le scadenze visibili ai soci e non fatte, senza chi le segue', () => {
    expect(site().deadlines).toEqual([
      { id: 'SCA-0002', what: "Convocazione dell'Assemblea", kind: 'assembly', dueOn: inDays(12) },
      { id: 'SCA-0005', what: 'Save the date del Raduno', kind: 'event', dueOn: inDays(31) },
      { id: 'SCA-0009', what: 'Raduno di primavera', kind: 'event', dueOn: inDays(90) },
      { id: 'SCA-0010', what: 'Assemblea dei soci di primavera', kind: 'assembly', dueOn: inDays(91) },
    ])
  })

  it('il primo giorno e il link della segreteria', () => {
    const snapshot = site()
    expect(snapshot.firstDay.map((step) => step.title)).toEqual([
      'Scegli un gruppo',
      'Vieni a un incontro',
      'Entra nella chat',
      'Scegli un cantiere',
    ])
    expect(snapshot.officeUrl).toBe(DEMO_OFFICE_URL)
  })

  it('una mail in un testo ferma l’istantanea del sito, e dice dove', () => {
    const sheets = demoSheets(now)
    setCell(sheets, SHEETS.groups, 1, 'come si partecipa', 'Scrivi a lia.prova@example.org')
    expect(findViolations({ ...site(sheets), publishedAt: now.toISOString() }, SITE_SHAPE)).toEqual([
      'groups[GDL-orti].howToJoin: c’è una mail',
    ])
  })

  it('un campo fuori lista ferma l’istantanea del sito', () => {
    const snapshot = { ...site(), publishedAt: now.toISOString(), referentsEmails: ['x'] }
    expect(findViolations(snapshot, SITE_SHAPE)).toEqual(['referentsEmails: campo fuori dalla lista ammessa'])
  })
})

describe('buildSnapshots: l’istantanea riservata in T7', () => {
  const reserved = () => buildSnapshots(readSheets(), today).reserved

  it('è la stessa di buildReservedSnapshot, con gli incontri e il link «Aggiungi un incontro»', () => {
    expect(findViolations({ ...reserved(), publishedAt: now.toISOString() })).toEqual([])
    const url = new URL(reserved().groups.find((group) => group.id === 'GDL-orti')?.newMeetingUrl ?? '')
    expect(url.searchParams.get('entry.2001')).toBe('Orti e Suoli')
    expect(url.searchParams.get('entry.2002')).toBe(DEMO_CODES['GDL-orti'])
  })

  it('ha tutti gli incontri dei prossimi 60 giorni, anche quelli non visibili ai soci', () => {
    expect(reserved().meetings.map((meeting) => [meeting.meetUrl, meeting.membersCanSee])).toEqual([
      [DEMO_MEET.coordination, false],
      [DEMO_MEET.ortiInternal, false],
      [DEMO_MEET.orti, true],
      [DEMO_MEET.semi, true],
    ])
  })
})

describe('gli impegni nelle istantanee', () => {
  function commitmentsOf(sheets = demoSheets(now)) {
    const warnings: string[] = []
    const { reserved, site } = buildSnapshots(readSheets(sheets, warnings), today)
    return { reserved, site, warnings }
  }

  it('il Foglio di prova non ha avvisi, e le due istantanee restano nelle loro liste ammesse', () => {
    const { reserved, site, warnings } = commitmentsOf()
    expect(warnings).toEqual([])
    expect(findViolations({ ...reserved, publishedAt: now.toISOString() })).toEqual([])
    expect(findViolations({ ...site, publishedAt: now.toISOString() }, SITE_SHAPE)).toEqual([])
    expect(parseReservedSnapshot(JSON.parse(JSON.stringify({ ...reserved, publishedAt: now.toISOString() })))).toEqual({
      ...reserved,
      publishedAt: now.toISOString(),
    })
  })

  it('nella Riservata ci sono tutti gli impegni dell’anno, col link del Modulo', () => {
    const { reserved } = commitmentsOf()
    expect(reserved.commitments.map((commitment) => commitment.id)).toHaveLength(10)
    expect(reserved.commitmentFormUrl).toBe(DEMO_COMMITMENT_FORM_URL)
  })

  it('ogni impegno ha previsto e speso dalla scheda «Budget», come i cantieri', () => {
    const { reserved } = commitmentsOf()
    const byId = (id: string) => reserved.commitments.find((commitment) => commitment.id === id)
    expect(byId('IMP-0003')).toMatchObject({ planned: 800, spent: 200 })
    expect(byId('IMP-0008')).toMatchObject({ planned: 600, spent: 300 })
    expect(byId('IMP-0006')).toMatchObject({ planned: null, spent: null })
    for (const commitment of reserved.commitments) {
      expect(commitment).toHaveProperty('planned')
      expect(commitment).toHaveProperty('spent')
    }
  })

  it('nella Riservata gli impegni degli anni prima solo se ancora aperti; il budget per impegno', () => {
    const sheets = demoSheets(now)
    const ratified = { 'ratifica del Direttivo il': '2025-02-01', 'cantiere o GdL': 'Comunicazione' }
    addRow(sheets, SHEETS.commitments, {
      id: 'IMP-0011',
      anno: 2025,
      titolo: 'Vecchio, preso',
      stato: 'preso',
      ...ratified,
      'ruolo di chi lo prende': 'una persona della segreteria',
    })
    addRow(sheets, SHEETS.commitments, {
      id: 'IMP-0012',
      anno: 2025,
      titolo: 'Vecchio, chiuso',
      stato: 'chiuso',
      esito: 'completato',
      ...ratified,
    })
    addRow(sheets, SHEETS.commitments, {
      id: 'IMP-0013',
      anno: 2025,
      titolo: 'Vecchio, respinto',
      stato: 'respinto',
      'motivo del respingimento': 'Non serve più',
      ...ratified,
    })
    addRow(sheets, SHEETS.budget, { voce: 'Vecchio, preso (IMP-0011)', previsto: 400, speso: 150 })
    const { reserved, warnings } = commitmentsOf(sheets)
    expect(warnings).toEqual([])
    const ids = reserved.commitments.map((commitment) => commitment.id)
    expect(ids).toContain('IMP-0011')
    expect(ids).not.toContain('IMP-0012')
    expect(ids).not.toContain('IMP-0013')
    expect(reserved.commitments.find((commitment) => commitment.id === 'IMP-0011')).toMatchObject({
      year: 2025,
      status: 'taken',
      planned: 400,
      spent: 150,
    })
  })

  it('sul sito solo gli impegni ratificati e non chiusi; il numero dell’incaricato solo per chi l’ha preso', () => {
    const { site } = commitmentsOf()
    expect(site.commitments.map((commitment) => commitment.id)).toEqual(['IMP-0006', 'IMP-0007', 'IMP-0008'])
    // Un chiuso, con qualunque esito, resta nella Riservata: un «revocato» non resta legato a un numero socio.
    const sheets = demoSheets(now)
    const rows = sheets[SHEETS.commitments.name] ?? []
    const closed = rows.findIndex((cells) => cells.includes('IMP-0009'))
    setCell(sheets, SHEETS.commitments, closed, 'esito', 'revocato')
    // Un aperto con l'incaricato già scritto: il numero non esce finché l'impegno non è preso.
    const open = rows.findIndex((cells) => cells.includes('IMP-0006'))
    setCell(sheets, SHEETS.commitments, open, 'incaricato (numero socio)', 77)
    const changed = commitmentsOf(sheets).site.commitments
    expect(changed.map((commitment) => commitment.id)).not.toContain('IMP-0009')
    expect(JSON.stringify(changed)).not.toContain('revoked')
    expect(changed.find((commitment) => commitment.id === 'IMP-0006')?.assigneeNumber).toBeNull()
    expect(changed.find((commitment) => commitment.id === 'IMP-0008')?.assigneeNumber).toBe('56')
  })

  it('un impegno senza la data di ratifica non compare nell’istantanea del sito', () => {
    const { site } = commitmentsOf()
    expect(site.commitments.map((commitment) => commitment.id)).toEqual(['IMP-0006', 'IMP-0007', 'IMP-0008'])
    // «Preso» scritto nel Foglio, ma senza la ratifica: nella Riservata sì, sul sito no.
    const sheets = demoSheets(now)
    const rows = sheets[SHEETS.commitments.name] ?? []
    const taken = rows.findIndex((cells) => cells.includes('IMP-0007'))
    setCell(sheets, SHEETS.commitments, taken, 'ratifica del Direttivo il', '')
    const unratified = commitmentsOf(sheets)
    expect(unratified.site.commitments.map((commitment) => commitment.id)).not.toContain('IMP-0007')
    expect(unratified.reserved.commitments.find((commitment) => commitment.id === 'IMP-0007')?.status).toBe('taken')
  })

  it('sul sito nessun nome di incaricato o di chi propone e nessun compenso nascosto: c’è solo il numero socio', () => {
    const { site } = commitmentsOf()
    const json = JSON.stringify(site.commitments)
    expect(json).not.toMatch(/fittizi/i)
    // «Verbali del Coordinamento» è pagato 600 €, con «compenso visibile ai soci» no.
    const minutes = site.commitments.find((commitment) => commitment.id === 'IMP-0008')
    expect(minutes).toMatchObject({ pay: 'paid', fee: null, days: 10, assigneeNumber: '56' })
    expect(json).not.toContain('600')
    expect(site.commitments.find((commitment) => commitment.id === 'IMP-0007')).toMatchObject({
      status: 'taken',
      assigneeNumber: '34',
      assigneeRole: 'una persona di Semi e Biodiversità',
    })
  })

  it('con «compenso visibile ai soci» sì la cifra esce', () => {
    const sheets = demoSheets(now)
    const rows = sheets[SHEETS.commitments.name] ?? []
    setCell(
      sheets,
      SHEETS.commitments,
      rows.findIndex((cells) => cells.includes('IMP-0008')),
      'compenso visibile ai soci',
      'sì',
    )
    expect(commitmentsOf(sheets).site.commitments.find((commitment) => commitment.id === 'IMP-0008')?.fee).toBe(600)
  })

  it('un nome nel campo dell’incaricato, o un campo in più, fermano la lista ammessa', () => {
    const { site, reserved } = commitmentsOf()
    const named = { ...site, publishedAt: now.toISOString() }
    named.commitments = named.commitments.map((commitment) => ({ ...commitment, assigneeNumber: 'mario@example.org' }))
    expect(findViolations(named, SITE_SHAPE)[0]).toBe('commitments[IMP-0006].assigneeNumber: non è un identificativo')
    const extra = { ...site, publishedAt: now.toISOString() }
    extra.commitments = [{ ...extra.commitments[0], feeVisible: false } as never]
    expect(findViolations(extra, SITE_SHAPE)).toEqual([
      'commitments[IMP-0006].feeVisible: campo fuori dalla lista ammessa',
    ])
    // L'esito non ha posto sul sito: i chiusi non ci vanno.
    const outcome = { ...site, publishedAt: now.toISOString() }
    outcome.commitments = [{ ...outcome.commitments[0], outcome: 'revoked' } as never]
    expect(findViolations(outcome, SITE_SHAPE)).toEqual([
      'commitments[IMP-0006].outcome: campo fuori dalla lista ammessa',
    ])
    // Né il nome nelle note, né nome, cognome e mail di chi ha proposto IMP-0003.
    expect(JSON.stringify(reserved)).not.toMatch(/fittizi/i)
  })
})
