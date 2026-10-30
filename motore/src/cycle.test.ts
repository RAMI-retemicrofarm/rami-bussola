import {
  MEMBERS_KEY,
  normalizeEmail,
  parseMembersSnapshot,
  parseReservedSnapshot,
  parseSiteSnapshot,
  RESERVED_KEY,
  romeDate,
  romeDateTime,
  SITE_KEY,
} from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readTable, SHEETS, type Workbook } from './content.ts'
import { HEALTH, runCycle, type CycleDeps } from './cycle.ts'
import {
  DEMO_CODES,
  DEMO_COMMITMENT_ANSWER,
  DEMO_COMMITMENT_FORM_URL,
  DEMO_EMAILS,
  DEMO_MEETING_PREFILL_URL,
  DEMO_PREFILL_URL,
  DEMO_REFERENTS,
  demoSheets,
} from './demo.ts'
import { DEMO_SOCI_COUNTS, demoSociSheets } from './demo-soci.ts'
import {
  MEETING_FORM,
  type CommitmentAnswer,
  type FormResponse,
  type MeetingAnswer,
  type UpdateAnswer,
} from './form.ts'
import { MEMBERS_PUBLICATION_KEY } from './members-snapshot.ts'
import { memoryCommitmentForm, memoryForm, memoryKv, memoryState, memoryWorkbook } from './memory.ts'

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const start = new Date('2026-10-31T17:00:00Z')

const response = (fields: Partial<UpdateAnswer> = {}, id = 'r1', at = '2026-10-31T17:42:00Z'): FormResponse => ({
  id,
  submittedAt: new Date(at),
  answer: {
    group: 'Orti e Suoli',
    project: 'Rete dei mercati contadini (CAN-0001)',
    code: DEMO_CODES['GDL-orti'],
    who: 'Giulia Verdi',
    stage: 'In revisione',
    news: 'Fissate le date.',
    nextStep: 'mandare gli inviti',
    dueOn: '2026-11-20',
    help: '',
    ...fields,
  },
})

const meetingResponse = (fields: Partial<MeetingAnswer> = {}, id = 'm1'): FormResponse<MeetingAnswer> => ({
  id,
  submittedAt: new Date('2026-10-31T17:45:00Z'),
  answer: {
    group: 'Semi e Biodiversità',
    code: DEMO_CODES['GDL-semi'],
    day: '2026-11-03',
    time: '18:00',
    meet: 'https://meet.google.com/semi-dal-modulo',
    visible: 'Sì',
    ...fields,
  },
})

function setup(
  initial: FormResponse[] = [],
  sheets = demoSheets(start),
  soci: Record<string, unknown[][]> | null = null,
) {
  const responses = [...initial]
  const meetingResponses: FormResponse<MeetingAnswer>[] = []
  const commitmentResponses: FormResponse<CommitmentAnswer>[] = []
  const commitmentForm = memoryCommitmentForm(commitmentResponses, DEMO_COMMITMENT_FORM_URL)
  const workbook = memoryWorkbook(sheets)
  /** Le schede dove la prossima riga aggiunta fallisce, come quando il servizio dei Fogli non risponde. */
  const failNext = new Set<string>()
  const google: Workbook = {
    values: (sheet) => workbook.values(sheet),
    setCell: (sheet, row, column, value) => workbook.setCell(sheet, row, column, value),
    appendRow(sheet, values) {
      if (failNext.delete(sheet)) throw new Error('Service Spreadsheets failed while accessing document')
      workbook.appendRow(sheet, values)
    },
  }
  const kv = memoryKv()
  const state = memoryState()
  const keys = ['00112233445566778899aabbccddeeff', 'ffeeddccbbaa99887766554433221100']
  const deps = (now: Date): CycleDeps => ({
    workbook: google,
    soci: soci ? memoryWorkbook(soci) : null,
    form: memoryForm(responses, DEMO_PREFILL_URL),
    meetingForm: memoryForm(meetingResponses, DEMO_MEETING_PREFILL_URL, MEETING_FORM),
    commitmentForm,
    kv,
    state,
    scope: 'ns456',
    sha256Hex,
    toCalendarDate: romeDate,
    toLocalTime: romeDateTime,
    randomKey: () => keys.shift() ?? 'chiave-finita',
    now,
  })
  const run = (now = new Date('2026-10-31T17:50:00Z')) => runCycle(deps(now))
  const snapshot = () => parseReservedSnapshot(JSON.parse(kv.values.get(RESERVED_KEY) ?? 'null'))
  const site = () => parseSiteSnapshot(JSON.parse(kv.values.get(SITE_KEY) ?? 'null'))
  const table = (spec: (typeof SHEETS)[keyof typeof SHEETS]) => readTable(workbook, spec)
  const health = (piece: string) => {
    const row = table(SHEETS.health).rows.find((candidate) => candidate.get('pezzo') === piece)
    return { stato: row?.get('stato'), nota: row?.get('nota'), aggiornamento: row?.get('ultimo aggiornamento') }
  }
  return {
    workbook,
    kv,
    state,
    responses,
    meetingResponses,
    commitmentResponses,
    commitmentForm,
    failNext,
    run,
    snapshot,
    site,
    table,
    health,
  }
}

describe('un giro del motore', () => {
  it('una risposta valida aggiorna il cantiere nel Foglio e nell’istantanea, con «aggiornato il» di oggi', () => {
    const { run, snapshot, table } = setup([response()])
    run()
    const row = table(SHEETS.projects).rows.find((candidate) => candidate.get('id') === 'CAN-0001')
    expect(row?.get('stato')).toBe('in revisione')
    expect(row?.get('aggiornato il')).toEqual(new Date('2026-10-31T17:42:00Z'))
    const project = snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0001')
    expect(project).toMatchObject({ stage: 'review', updatedOn: '2026-10-31', nextStep: 'mandare gli inviti' })
  })

  it('la risposta resta in «Aggiornamenti», con l’esito del controllo', () => {
    const { run, table } = setup([response()])
    run()
    const [row] = table(SHEETS.updates).rows
    expect(row?.get('id risposta')).toBe('r1')
    expect(row?.get('chi sei')).toBe('Giulia Verdi')
    expect(row?.get('esito del controllo')).toBe('applicata a CAN-0001')
  })

  it('una risposta già letta non si applica due volte', () => {
    const { run, table } = setup([response()])
    run()
    run(new Date('2026-10-31T18:00:00Z'))
    expect(table(SHEETS.updates).rows).toHaveLength(1)
  })

  it('con il codice del gruppo sbagliato il cantiere non cambia, e la risposta va in «Da controllare»', () => {
    const { run, snapshot, table, health } = setup([response({ code: 'vecchio' })])
    run()
    const row = table(SHEETS.projects).rows.find((candidate) => candidate.get('id') === 'CAN-0001')
    expect(row?.get('stato')).toBe('in corso')
    expect(snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0001')?.stage).toBe('ongoing')
    expect(table(SHEETS.updates).rows[0]?.get('esito del controllo')).toBe(
      'da controllare: codice del gruppo sbagliato',
    )
    expect(health(HEALTH.form)).toMatchObject({ stato: 'da guardare', nota: '1 risposta letta, 1 da controllare.' })
  })

  it('senza cantiere scelto nasce un cantiere nuovo nel gruppo giusto, e si vede nell’istantanea', () => {
    const { run, snapshot, table } = setup([response({ project: 'Corso di potatura' })])
    run()
    const row = table(SHEETS.projects).rows.find((candidate) => candidate.get('id') === 'CAN-0006')
    expect(row?.get('GdL')).toBe('GDL-orti')
    expect(row?.get('titolo')).toBe('Corso di potatura')
    expect(snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0006')?.groupId).toBe('GDL-orti')
  })

  it('se il giro si ferma dopo il cantiere nuovo, «Salute» lo dice e il giro dopo non ne fa un secondo', () => {
    const { run, failNext, table, health } = setup([response({ project: 'Siepi' })])
    failNext.add(SHEETS.updates.name)
    expect(() => run()).toThrow('Service Spreadsheets failed')
    expect(health(HEALTH.reserved)).toMatchObject({
      stato: 'ferma',
      nota: 'Giro interrotto: Service Spreadsheets failed while accessing document. Riprovo al giro dopo.',
    })

    run(new Date('2026-10-31T18:00:00Z'))
    const titles = table(SHEETS.projects).rows.map((row) => row.get('titolo'))
    expect(titles.filter((title) => title === 'Siepi')).toHaveLength(1)
    expect(table(SHEETS.updates).rows.map((row) => row.get('esito del controllo'))).toEqual(['applicata a CAN-0006'])
    expect(health(HEALTH.reserved).stato).toBe('a posto')
  })

  it('un cantiere nuovo non prende l’id di una riga che non si pubblica', () => {
    const { run, workbook, table } = setup([response({ project: 'Siepi' })])
    const projects = table(SHEETS.projects)
    const last = projects.rows.find((row) => row.get('id') === 'CAN-0005')
    workbook.setCell('Cantieri', last?.index ?? 0, projects.header.get('stato') ?? 0, 'sospeso')
    run()
    const ids = table(SHEETS.projects).rows.map((row) => row.get('id'))
    expect(ids).toEqual(['CAN-0001', 'CAN-0002', 'CAN-0003', 'CAN-0004', 'CAN-0005', 'CAN-0006'])
  })

  it('se due gruppi hanno lo stesso codice, il secondo ne prende uno nuovo e «Salute» lo dice', () => {
    const { run, workbook, table, health } = setup()
    const groups = table(SHEETS.groups)
    const code = groups.header.get('codice del gruppo') ?? 0
    workbook.setCell('GdL', groups.rows[1]?.index ?? 0, code, DEMO_CODES['GDL-orti'])
    run()
    const codes = table(SHEETS.groups).rows.map((row) => row.get('codice del gruppo'))
    expect(codes.slice(0, 2)).toEqual([DEMO_CODES['GDL-orti'], '00112233445566778899aabbccddeeff'])
    expect(health(HEALTH.content)).toMatchObject({
      stato: 'da guardare',
      nota: expect.stringContaining(
        '«GdL», riga 3: il codice del gruppo era uguale a quello di «Orti e Suoli»: ne ho fatto uno nuovo',
      ),
    })
  })

  it('svuotando il codice del gruppo, il motore ne crea uno nuovo e il link precompilato cambia', () => {
    const { run, snapshot, table, workbook } = setup()
    run()
    const before = snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0001')?.updateUrl
    const groups = table(SHEETS.groups)
    workbook.setCell('GdL', groups.rows[0]?.index ?? 0, groups.header.get('codice del gruppo') ?? 0, '')
    run(new Date('2026-10-31T18:00:00Z'))
    expect(table(SHEETS.groups).rows[0]?.get('codice del gruppo')).toBe('00112233445566778899aabbccddeeff')
    const after = snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0001')?.updateUrl
    expect(after).not.toBe(before)
    expect(after).toContain('00112233445566778899aabbccddeeff')
  })

  it('un giro senza cambiamenti non scrive niente su KV', () => {
    const { run, kv, health } = setup()
    run()
    run(new Date('2026-10-31T18:00:00Z'))
    expect(kv.writes).toEqual([RESERVED_KEY, SITE_KEY])
    expect(health(HEALTH.reserved)).toMatchObject({ stato: 'a posto', nota: 'Uguale all’ultima: nessuna scrittura.' })
    expect(health(HEALTH.site)).toMatchObject({ stato: 'a posto', nota: 'Uguale all’ultima: nessuna scrittura.' })
  })

  it('un campo fuori dalla lista ammessa ferma la pubblicazione, e «Salute» dice quale', () => {
    const { run, kv, workbook, table, health } = setup()
    const projects = table(SHEETS.projects)
    const nextStep = projects.header.get('prossimo passo') ?? 0
    workbook.setCell('Cantieri', projects.rows[2]?.index ?? 0, nextStep, 'scrivere a mario.rossi@example.org')
    const report = run()
    // Ferma solo la riservata: il sito non ha i cantieri, ed esce.
    expect(kv.writes).toEqual([SITE_KEY])
    expect(report.violations).toEqual(['projects[CAN-0003].nextStep: c’è una mail'])
    expect(health(HEALTH.reserved)).toMatchObject({
      stato: 'ferma',
      nota: 'Pubblicazione ferma, niente è uscito: projects[CAN-0003].nextStep: c’è una mail',
    })
    expect(health(HEALTH.access).nota).toContain('Prima lista, da copiare in Access')
  })

  it('se Cloudflare non risponde, «Salute» lo dice, il motore riprova al giro dopo e KV tiene l’ultima', () => {
    const { run, kv, snapshot, health, responses } = setup()
    run(new Date('2026-10-31T17:30:00Z'))
    const first = snapshot()?.publishedAt
    responses.push(response())
    kv.down = true
    run()
    expect(health(HEALTH.reserved).stato).toBe('da guardare')
    expect(health(HEALTH.reserved).nota).toContain('Cloudflare non risponde: riprovo al giro dopo.')
    expect(snapshot()?.publishedAt).toBe(first)
    expect(snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0001')?.stage).toBe('ongoing')
    kv.down = false
    run(new Date('2026-10-31T18:00:00Z'))
    expect(snapshot()?.projects.find((candidate) => candidate.id === 'CAN-0001')?.stage).toBe('review')
    expect(health(HEALTH.reserved).stato).toBe('a posto')
  })

  it('«Salute» ha le righe della pubblicazione, con l’ora del controllo e dell’ultimo aggiornamento', () => {
    const { run, table } = setup()
    const now = new Date('2026-10-31T17:50:00Z')
    run(now)
    const rows = table(SHEETS.health).rows
    expect(rows.map((row) => row.get('pezzo'))).toEqual([
      HEALTH.content,
      HEALTH.form,
      HEALTH.meetingForm,
      HEALTH.commitmentForm,
      HEALTH.reserved,
      HEALTH.site,
      HEALTH.members,
      HEALTH.access,
    ])
    for (const row of rows) expect(row.get('ultimo controllo')).toEqual(now)
    expect(rows[4]?.get('ultimo aggiornamento')).toEqual(now)
    expect(rows[5]?.get('ultimo aggiornamento')).toEqual(now)
  })

  it('sul Foglio finto non ha né avvisi né violazioni, e pubblica le sezioni di T2', () => {
    const { run, snapshot, health } = setup()
    const report = run()
    expect(report.warnings).toEqual([])
    expect(report.violations).toEqual([])
    expect(health(HEALTH.content).stato).toBe('a posto')
    expect(snapshot()?.resolutions).toHaveLength(7)
    expect(snapshot()?.issues).toHaveLength(3)
    expect(snapshot()?.budget.lines).toHaveLength(5)
    expect(snapshot()?.deadlines.map((deadline) => deadline.id)).toContain('SCA-0005')
  })

  it('le delibere e le scadenze si contano da oggi, nel fuso di Roma', () => {
    const { run, snapshot } = setup()
    // Un anno e un giorno dopo DEL-02 (40 giorni prima di `start`): esce dai 12 mesi.
    run(new Date(start.getTime() + 326 * 86_400_000))
    expect(snapshot()?.resolutions.map((resolution) => resolution.subject)).not.toContain(
      'Via alla prima versione della Bussola',
    )
    // L'anno nuovo: la scadenza fatta del 2026 esce, quelle aperte restano.
    const ids = snapshot()?.deadlines.map((deadline) => deadline.id)
    expect(ids).not.toContain('SCA-0006')
    expect(ids).toContain('SCA-0001')
  })

  it('senza il Modulo collegato pubblica lo stesso, e «Salute» dice che manca', () => {
    const { workbook, kv } = setup()
    const deps: CycleDeps = {
      workbook,
      form: null,
      kv,
      state: memoryState(),
      scope: 'ns456',
      sha256Hex,
      toCalendarDate: romeDate,
      toLocalTime: romeDateTime,
      randomKey: () => 'k',
      now: start,
    }
    runCycle(deps)
    expect(kv.writes).toEqual([RESERVED_KEY, SITE_KEY])
    const health = readTable(workbook, SHEETS.health).rows.find((row) => row.get('pezzo') === HEALTH.form)
    expect(health?.get('stato')).toBe('da collegare')
  })
})

describe('la lista di Access in «Salute»', () => {
  const people = (workbook: ReturnType<typeof memoryWorkbook>) => workbook.sheets[SHEETS.people.name] ?? []

  it('la prima volta dà la lista da copiare, con chi cura la Bussola, e la segna come aggiornata', () => {
    const { run, health } = setup()
    const now = new Date('2026-10-31T17:50:00Z')
    run(now)
    expect(health(HEALTH.access)).toEqual({
      stato: 'a posto',
      nota:
        'Prima lista, da copiare in Access: direttivo@example.org, rappresentante.orti@example.org, ' +
        'segreteria@example.org, esterno.semi@example.org, cura@example.org. In tutto 5 persone.',
      aggiornamento: now,
    })
  })

  it('una riga senza ruoli non entra nella lista', () => {
    const { run, workbook, health } = setup()
    people(workbook).push(['PER-09', 'senza.ruoli@example.org', '', '', ''])
    run()
    expect(health(HEALTH.access).nota).not.toContain('senza.ruoli@example.org')
  })

  it('togliendo una persona dal Foglio la nota dice chi esce, e l’istantanea non ha più la sua impronta', () => {
    const { run, workbook, snapshot, health } = setup()
    const first = new Date('2026-10-31T17:50:00Z')
    run(first)
    const rep = people(workbook).findIndex((row) => row[1] === DEMO_EMAILS.rep)
    people(workbook).splice(rep, 1)
    const second = new Date('2026-10-31T18:00:00Z')
    run(second)
    expect(health(HEALTH.access)).toEqual({
      stato: 'a posto',
      nota: 'Cambiata: esce rappresentante.orti@example.org. In tutto 4 persone.',
      aggiornamento: second,
    })
    const fingerprints = snapshot()?.people.map((person) => person.fingerprint)
    expect(fingerprints).not.toContain(sha256Hex(normalizeEmail(DEMO_EMAILS.rep)))
    expect(fingerprints).toContain(sha256Hex(normalizeEmail(DEMO_EMAILS.keeper)))

    // Il giro dopo, senza cambi, la nota resta quella del cambio, con la sua ora: è lì che si allinea Access.
    run(new Date('2026-10-31T18:10:00Z'))
    expect(health(HEALTH.access)).toMatchObject({
      nota: 'Cambiata: esce rappresentante.orti@example.org. In tutto 4 persone.',
      aggiornamento: second,
    })
  })

  it('se il giro si ferma prima di scrivere «Salute», il cambio non si perde: lo segna il giro dopo', () => {
    const { run, workbook, health } = setup()
    run(new Date('2026-10-31T17:50:00Z'))
    const rep = people(workbook).findIndex((row) => row[1] === DEMO_EMAILS.rep)
    people(workbook).splice(rep, 1)
    // Come un Foglio di T1 a cui manca ancora una scheda nuova: il giro si ferma.
    const deadlines = workbook.sheets[SHEETS.deadlines.name]
    delete workbook.sheets[SHEETS.deadlines.name]
    expect(() => run(new Date('2026-10-31T18:00:00Z'))).toThrow('Manca la scheda «Scadenze».')
    if (deadlines) workbook.sheets[SHEETS.deadlines.name] = deadlines
    const after = new Date('2026-10-31T18:10:00Z')
    run(after)
    expect(health(HEALTH.access)).toMatchObject({
      nota: 'Cambiata: esce rappresentante.orti@example.org. In tutto 4 persone.',
      aggiornamento: after,
    })
  })

  it('ricorda la lista e la nota nelle proprietà dello script, con lo scope come la pubblicazione', () => {
    const { run, state } = setup()
    run()
    expect(JSON.parse(state.values.get('access:ns456:lista') ?? '[]')).toContain(DEMO_EMAILS.keeper)
    expect(state.values.get('access:ns456:nota')).toContain('Prima lista')
  })

  it('con più di 50 persone è da guardare', () => {
    const { run, workbook, health } = setup()
    for (let i = 0; i < 46; i++) people(workbook).push([`PER-${i + 10}`, `socio${i}@example.org`, '', 'Direttivo', ''])
    run()
    expect(health(HEALTH.access).stato).toBe('da guardare')
    expect(health(HEALTH.access).nota).toMatch(/In tutto 51 persone\. Sono più di 50: Access gratis ne tiene 50\.$/)
  })
})

describe('l’istantanea del sito nel giro', () => {
  it('si pubblica con quella riservata, e «Salute» ha la sua riga', () => {
    const { run, site, health } = setup()
    run()
    expect(site()?.groups).toHaveLength(4)
    expect(health(HEALTH.site)).toMatchObject({ stato: 'a posto', nota: 'Pubblicata: era cambiata.' })
  })

  it('tolto il consenso, il giro dopo toglie il nome dal sito: al più 10 minuti col trigger', () => {
    const { run, workbook, site, kv } = setup()
    run(new Date('2026-10-31T17:50:00Z'))
    expect(JSON.stringify(site())).toContain('Lia Prova')
    // La segreteria svuota «consenso dal» di Lia Prova alle 17:51; il trigger dei 10 minuti gira alle 18:00.
    const referents = workbook.sheets[SHEETS.referents.name] ?? []
    const row = referents.findIndex((cells) => cells.includes('Lia Prova'))
    workbook.setCell(SHEETS.referents.name, row, SHEETS.referents.columns.indexOf('consenso dal'), '')
    run(new Date('2026-10-31T18:00:00Z'))
    expect(JSON.stringify(site())).not.toContain('Lia Prova')
    expect(site()?.publishedAt).toBe('2026-10-31T18:00:00.000Z')
    expect(kv.writes.filter((key) => key === SITE_KEY)).toHaveLength(2)
    for (const name of DEMO_REFERENTS.withoutConsent) expect(kv.values.get(SITE_KEY)).not.toContain(name)
  })

  it('una mail in un testo del sito ferma solo il sito: la riservata esce lo stesso', () => {
    const { run, workbook, kv, health } = setup()
    workbook.setCell(SHEETS.groups.name, 1, SHEETS.groups.columns.indexOf('missione'), 'Scrivi a x@example.org')
    run()
    expect(kv.writes).toEqual([RESERVED_KEY])
    expect(health(HEALTH.site)).toMatchObject({ stato: 'ferma' })
    expect(health(HEALTH.site).nota).toContain('groups[GDL-orti].mission: c’è una mail')
  })

  it('senza le schede di T7 la riservata esce lo stesso, e «Salute» dice quale manca', () => {
    const sheets = demoSheets(start)
    delete sheets[SHEETS.referents.name]
    delete sheets[SHEETS.meetings.name]
    const { run, kv, health, site } = setup([], sheets)
    run()
    expect(kv.writes).toEqual([RESERVED_KEY, SITE_KEY])
    expect(site()?.groups.every((group) => group.referents.length === 0)).toBe(true)
    expect(health(HEALTH.content).stato).toBe('da guardare')
    expect(health(HEALTH.content).nota).toContain('Manca la scheda «Referenti»')
  })
})

describe('una scheda del sito scritta male', () => {
  it('una colonna che manca in «Referenti» non ferma la Riservata, e dal sito non esce nessun nome', () => {
    const sheets = demoSheets(start)
    const referents = sheets[SHEETS.referents.name] ?? []
    const at = SHEETS.referents.columns.indexOf('consenso dal')
    sheets[SHEETS.referents.name] = referents.map((cells) => cells.filter((_, i) => i !== at))
    const { run, kv, site, health } = setup([], sheets)
    run()
    expect(kv.writes).toEqual([RESERVED_KEY, SITE_KEY])
    expect(JSON.stringify(site())).not.toContain('Lia Prova')
    expect(health(HEALTH.content).nota).toContain('«Referenti»: manca la colonna «consenso dal».')
  })
})

describe('il Modulo «Prossimo incontro» nel giro', () => {
  it('una risposta valida diventa una riga di «Incontri», e l’incontro va sul sito', () => {
    const { run, meetingResponses, table, site, health } = setup()
    meetingResponses.push(meetingResponse())
    run()
    const row = table(SHEETS.meetings).rows.find((candidate) => candidate.get('id risposta') === 'm1')
    expect(row?.get('GdL')).toBe('GDL-semi')
    expect(row?.get('data e ora')).toBe('2026-11-03 18:00')
    expect(row?.get('esito del controllo')).toBe('aggiunto')
    expect(site()?.meetings.map((meeting) => meeting.meetUrl)).toContain('https://meet.google.com/semi-dal-modulo')
    expect(health(HEALTH.meetingForm).stato).toBe('a posto')
  })

  it('non visibile ai soci: nella riservata sì, sul sito no', () => {
    const { run, meetingResponses, site, snapshot } = setup()
    meetingResponses.push(meetingResponse({ visible: 'No' }))
    run()
    const url = 'https://meet.google.com/semi-dal-modulo'
    expect(site()?.meetings.map((meeting) => meeting.meetUrl)).not.toContain(url)
    expect(snapshot()?.meetings.find((meeting) => meeting.meetUrl === url)?.membersCanSee).toBe(false)
  })

  it('con il codice sbagliato la riga resta «da controllare», non esce, e «Salute» lo dice', () => {
    const { run, meetingResponses, table, site, health } = setup()
    meetingResponses.push(meetingResponse({ code: 'sbagliato' }))
    run()
    const row = table(SHEETS.meetings).rows.find((candidate) => candidate.get('id risposta') === 'm1')
    expect(row?.get('esito del controllo')).toBe('da controllare: codice del gruppo sbagliato')
    expect(JSON.stringify(site())).not.toContain('semi-dal-modulo')
    expect(health(HEALTH.meetingForm)).toMatchObject({
      stato: 'da guardare',
      nota: '1 risposta letta, 1 da controllare.',
    })
  })

  it('una risposta già letta non si scrive due volte', () => {
    const { run, meetingResponses, table } = setup()
    meetingResponses.push(meetingResponse())
    run()
    run(new Date('2026-10-31T18:00:00Z'))
    expect(table(SHEETS.meetings).rows.filter((row) => row.get('id risposta') === 'm1')).toHaveLength(1)
  })

  it('senza la scheda «Incontri» le risposte aspettano, e «Salute» lo dice', () => {
    const sheets = demoSheets(start)
    delete sheets[SHEETS.meetings.name]
    const { run, meetingResponses, health } = setup([], sheets)
    meetingResponses.push(meetingResponse())
    run()
    expect(health(HEALTH.meetingForm)).toMatchObject({ stato: 'da guardare' })
    expect(health(HEALTH.meetingForm).nota).toContain('Manca la scheda «Incontri»')
  })

  it('il gruppo riservato ha il link «Aggiungi un incontro»', () => {
    const { run, snapshot } = setup()
    run()
    const url = snapshot()?.groups.find((group) => group.id === 'GDL-semi')?.newMeetingUrl ?? ''
    expect(new URL(url).searchParams.get('entry.2002')).toBe(DEMO_CODES['GDL-semi'])
  })

  it('senza il Modulo collegato, «Salute» dice che manca e il resto esce', () => {
    const { workbook, kv } = setup()
    runCycle({
      workbook,
      form: null,
      kv,
      state: memoryState(),
      scope: 'ns456',
      sha256Hex,
      toCalendarDate: romeDate,
      toLocalTime: romeDateTime,
      randomKey: () => 'k',
      now: start,
    })
    const health = readTable(workbook, SHEETS.health).rows.find((row) => row.get('pezzo') === HEALTH.meetingForm)
    expect(health?.get('stato')).toBe('da collegare')
    expect(kv.writes).toEqual([RESERVED_KEY, SITE_KEY])
  })
})

describe('i numeri dei soci nel giro', () => {
  const soci = () => setup([], demoSheets(start), demoSociSheets())
  const members = (kv: ReturnType<typeof memoryKv>) =>
    parseMembersSnapshot(JSON.parse(kv.values.get(MEMBERS_KEY) ?? 'null'))

  it('col Foglio soci collegato pubblica v1/soci.json, solo numeri, e «Salute» ha le sue due righe', () => {
    const { run, kv, health, table } = soci()
    const now = new Date('2026-11-05T09:00:00Z')
    const report = run(now)
    expect(report.published.map((item) => item.key)).toContain(MEMBERS_KEY)
    expect(members(kv)).toMatchObject({ asOf: '2026-11-05', counts: DEMO_SOCI_COUNTS, renewals: null })
    expect(kv.values.get(MEMBERS_KEY)).not.toContain('@')
    expect(kv.values.get(MEMBERS_KEY)).not.toContain('Abate')
    expect(health(HEALTH.members)).toMatchObject({ stato: 'a posto', nota: 'Pubblicata: era cambiata.' })
    expect(health(HEALTH.lastPayment)).toEqual({
      stato: 'a posto',
      nota: 'P-2026-0007, registrato il 30/10/2026 da Paola Ricci: 6 giorni fa.',
      aggiornamento: new Date('2026-10-30T12:00:00Z'),
    })
    const pieces = table(SHEETS.health).rows.map((row) => row.get('pezzo'))
    expect(pieces).toContain(HEALTH.members)
    expect(pieces).toContain(HEALTH.lastPayment)
  })

  it('oltre 7 giorni dall’ultima registrazione la riga è da guardare', () => {
    const { run, health } = soci()
    run(new Date('2026-11-10T09:00:00Z'))
    expect(health(HEALTH.lastPayment)).toMatchObject({
      stato: 'da guardare',
      nota: expect.stringContaining('11 giorni fa'),
    })
  })

  it('con KV irraggiungibile la pubblicazione dei numeri riprova al giro dopo, e lo stato lo ricorda per «Oggi»', () => {
    const { run, kv, state, health } = soci()
    kv.down = true
    expect(() => run(new Date('2026-11-05T09:00:00Z'))).not.toThrow()
    expect(health(HEALTH.members).stato).toBe('da guardare')
    expect(JSON.parse(state.get(MEMBERS_PUBLICATION_KEY) ?? '{}')).toMatchObject({ pendingSince: '2026-11-05' })
    kv.down = false
    run(new Date('2026-11-05T09:10:00Z'))
    expect(members(kv)).not.toBeNull()
    expect(health(HEALTH.members).stato).toBe('a posto')
    expect(state.get(MEMBERS_PUBLICATION_KEY) ?? '').toBe('')
  })

  it('senza il Foglio soci la riga dice che manca, e il resto esce', () => {
    const { run, kv, health } = setup()
    run()
    expect(kv.values.has(MEMBERS_KEY)).toBe(false)
    expect(health(HEALTH.members)).toMatchObject({ stato: 'da collegare' })
    expect(kv.values.has(RESERVED_KEY)).toBe(true)
  })

  it('un Foglio soci scritto male ferma solo i numeri dei soci', () => {
    const sociSheets = demoSociSheets()
    delete sociSheets['Pagamenti']
    const { run, kv, health } = setup([], demoSheets(start), sociSheets)
    run()
    expect(health(HEALTH.members)).toMatchObject({
      stato: 'ferma',
      nota: 'Il Foglio soci non si legge: Manca la scheda «Pagamenti».',
    })
    expect(kv.values.has(RESERVED_KEY)).toBe(true)
    expect(kv.values.has(MEMBERS_KEY)).toBe(false)
  })
})

const commitmentResponse = (
  fields: Partial<CommitmentAnswer> = {},
  id = 'p1',
  at = '2026-10-31T17:42:00Z',
): FormResponse<CommitmentAnswer> => ({
  id,
  submittedAt: new Date(at),
  answer: { ...DEMO_COMMITMENT_ANSWER, ...fields },
})

describe('gli impegni nel giro', () => {
  const commitmentRows = (table: ReturnType<typeof setup>['table']) => table(SHEETS.commitments).rows
  const commitmentRow = (table: ReturnType<typeof setup>['table'], id: string) =>
    commitmentRows(table).find((row) => row.get('id') === id)

  it('dato un impegno «da scrivere», la risposta che sceglie la sua riga la completa, e non nasce un doppione', () => {
    const { run, table, commitmentResponses } = setup()
    commitmentResponses.push(commitmentResponse())
    const before = commitmentRows(table).length
    run()
    expect(commitmentRows(table)).toHaveLength(before)
    expect(commitmentRows(table).filter((row) => row.get('titolo') === 'La cura della Bussola')).toHaveLength(1)
    const row = commitmentRow(table, 'IMP-0001')
    expect(row?.get('stato')).toBe('proposto')
    expect(row?.get('giornate')).toBe(12)
    expect(row?.get('chi verifica (numero socio)')).toBe('12')
    expect(row?.get('proposto il')).toEqual(new Date('2026-10-31T17:42:00Z'))
    // Le note della segreteria restano.
    expect(row?.get('note')).toBe('Sentire Ugo Fittizio')
    const [log] = table(SHEETS.commitmentResponses).rows
    expect(log?.get('id risposta')).toBe('p1')
    expect(log?.get('esito del controllo')).toBe('applicata a IMP-0001')
  })

  it('dopo la risposta, la scheda è in «Da approvare» entro 10 minuti: la porta il giro dei 10 minuti', () => {
    const { run, snapshot, site, commitmentResponses, health } = setup()
    // Il giro delle 17:40 è passato; la risposta arriva alle 17:42, e il trigger del Modulo non gira (il lucchetto è
    // preso, o Google lo perde). Il trigger dei 10 minuti gira alle 17:50.
    run(new Date('2026-10-31T17:40:00Z'))
    expect(snapshot()?.commitments.find((item) => item.id === 'IMP-0001')?.status).toBe('toWrite')
    commitmentResponses.push(commitmentResponse())
    run(new Date('2026-10-31T17:50:00Z'))
    const published = snapshot()
    expect(published?.publishedAt).toBe('2026-10-31T17:50:00.000Z')
    expect(published?.commitments.find((item) => item.id === 'IMP-0001')).toMatchObject({
      status: 'proposed',
      proposedOn: '2026-10-31',
      verifierNumber: '12',
      proposedBy: '34',
      fee: 1200,
      feeVisible: false,
    })
    // Senza la ratifica, sul sito non c'è.
    expect(site()?.commitments.map((item) => item.id)).not.toContain('IMP-0001')
    expect(health(HEALTH.commitmentForm)).toMatchObject({
      stato: 'a posto',
      nota: '1 risposta letta, 0 da controllare.',
    })
  })

  it('nome, cognome e mail di chi propone restano nel Foglio: nel KV, per Cloudflare, c’è solo il numero socio', () => {
    const { run, kv, snapshot, table, commitmentResponses } = setup()
    const PROPOSER = ['Zelinda', 'Provalunga', 'zelinda.provalunga@example.org']
    commitmentResponses.push(
      commitmentResponse({ proposerFirstName: 'Zelinda', proposerLastName: 'Provalunga', proposerEmail: PROPOSER[2] }),
    )
    run()
    const row = commitmentRow(table, 'IMP-0001')
    expect([row?.get('proposto da (nome)'), row?.get('proposto da (cognome)'), row?.get('proposto da (mail)')]).toEqual(
      PROPOSER,
    )
    const [log] = table(SHEETS.commitmentResponses).rows
    expect([log?.get('proposto da (nome)'), log?.get('proposto da (cognome)'), log?.get('proposto da (mail)')]).toEqual(
      PROPOSER,
    )
    expect(snapshot()?.commitments.find((item) => item.id === 'IMP-0001')?.proposedBy).toBe('34')
    expect(kv.values.size).toBeGreaterThan(0)
    for (const [key, value] of kv.values)
      for (const word of PROPOSER) expect(value.toLowerCase(), `${key}: ${word}`).not.toContain(word.toLowerCase())
  })

  it('una risposta già letta non si applica due volte, e l’elenco del Modulo perde la riga completata', () => {
    const { run, table, commitmentResponses, commitmentForm } = setup()
    run()
    expect(commitmentForm.choices).toEqual(['La cura della Bussola (IMP-0001)', 'La newsletter del mese (IMP-0002)'])
    commitmentResponses.push(commitmentResponse())
    run(new Date('2026-10-31T17:50:00Z'))
    run(new Date('2026-10-31T18:00:00Z'))
    expect(table(SHEETS.commitmentResponses).rows).toHaveLength(1)
    expect(commitmentForm.choices).toEqual(['La newsletter del mese (IMP-0002)'])
    expect(commitmentForm.writes).toBe(2)
  })

  it('con chi verifica fuori dalle Persone della Riservata la riga non cambia, e la risposta va in «Da controllare»', () => {
    const { run, table, commitmentResponses, health } = setup()
    commitmentResponses.push(commitmentResponse({ verifier: '99' }))
    run()
    expect(commitmentRow(table, 'IMP-0001')?.get('stato')).toBe('da scrivere')
    expect(table(SHEETS.commitmentResponses).rows[0]?.get('esito del controllo')).toBe(
      'da controllare: chi verifica (99) non è fra le Persone della Riservata',
    )
    expect(health(HEALTH.commitmentForm)).toMatchObject({
      stato: 'da guardare',
      nota: '1 risposta letta, 1 da controllare.',
    })
  })

  it('una risposta da una scheda rimasta aperta non riscrive la riga già proposta: va in «Da controllare»', () => {
    const { run, table, commitmentResponses, health } = setup()
    commitmentResponses.push(commitmentResponse())
    run(new Date('2026-10-31T17:50:00Z'))
    commitmentResponses.push(
      commitmentResponse({ what: 'Un’altra proposta', proposer: '12' }, 'p2', '2026-10-31T18:05:00Z'),
    )
    run(new Date('2026-10-31T18:10:00Z'))
    expect(commitmentRow(table, 'IMP-0001')?.get('cosa si fa')).toBe(DEMO_COMMITMENT_ANSWER.what)
    expect(commitmentRow(table, 'IMP-0001')?.get('proposto il')).toEqual(new Date('2026-10-31T17:42:00Z'))
    expect(table(SHEETS.commitmentResponses).rows.map((row) => row.get('esito del controllo'))).toEqual([
      'applicata a IMP-0001',
      'da controllare: l’impegno IMP-0001 è già stato proposto da un’altra risposta',
    ])
    expect(health(HEALTH.commitmentForm)).toMatchObject({ stato: 'da guardare' })
  })

  it('se il giro si ferma dopo la riga, il giro dopo la riscrive uguale e scrive la risposta una volta', () => {
    const { run, failNext, table, commitmentResponses } = setup()
    commitmentResponses.push(commitmentResponse())
    failNext.add(SHEETS.commitmentResponses.name)
    expect(() => run()).toThrow('Service Spreadsheets failed')
    run(new Date('2026-10-31T18:00:00Z'))
    expect(table(SHEETS.commitmentResponses).rows.map((row) => row.get('esito del controllo'))).toEqual([
      'applicata a IMP-0001',
    ])
    expect(commitmentRow(table, 'IMP-0001')?.get('stato')).toBe('proposto')
  })

  it('senza le schede degli impegni la riservata esce lo stesso, e «Salute» dice cosa manca', () => {
    const sheets = demoSheets(start)
    delete sheets[SHEETS.commitments.name]
    delete sheets[SHEETS.commitmentResponses.name]
    const { run, snapshot, health, commitmentResponses } = setup([], sheets)
    commitmentResponses.push(commitmentResponse())
    const report = run()
    expect(snapshot()?.commitments).toEqual([])
    expect(report.warnings).toContain('Manca la scheda «Impegni»: la crea setupBussola, dall’editor.')
    expect(health(HEALTH.commitmentForm).stato).toBe('da guardare')
  })

  it('la Riservata ha il Modulo; sul Foglio finto gli impegni non danno avvisi', () => {
    const { run, snapshot } = setup()
    const report = run()
    expect(report.warnings).toEqual([])
    expect(snapshot()?.commitmentFormUrl).toBe(DEMO_COMMITMENT_FORM_URL)
    expect(snapshot()?.commitments).toHaveLength(10)
  })
})
