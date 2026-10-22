import { FINGERPRINT_VECTOR, normalizeEmail, parseReservedSnapshot, romeDate } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  readBudget,
  readDeadlines,
  readGroups,
  readIssues,
  readPeople,
  readProjects,
  readResolutions,
  readSettings,
  readTable,
  SHEETS,
} from './content.ts'
import { DEMO_CODES, DEMO_EMAILS, DEMO_PREFILL_URL, demoSheets } from './demo.ts'
import { parsePrefilledUrl } from './form.ts'
import { memoryWorkbook } from './memory.ts'
import { buildReservedSnapshot, findViolations } from './snapshots.ts'

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
      settings: { staleDays: 30 },
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
