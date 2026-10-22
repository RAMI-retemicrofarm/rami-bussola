import { normalizeEmail, parseReservedSnapshot, RESERVED_KEY, romeDate } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readTable, SHEETS, type Workbook } from './content.ts'
import { HEALTH, runCycle, type CycleDeps } from './cycle.ts'
import { DEMO_CODES, DEMO_EMAILS, DEMO_PREFILL_URL, demoSheets } from './demo.ts'
import type { FormResponse, UpdateAnswer } from './form.ts'
import { memoryForm, memoryKv, memoryState, memoryWorkbook } from './memory.ts'

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

function setup(initial: FormResponse[] = []) {
  const responses = [...initial]
  const workbook = memoryWorkbook(demoSheets(start))
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
    form: memoryForm(responses, DEMO_PREFILL_URL),
    kv,
    state,
    scope: 'ns456',
    sha256Hex,
    toCalendarDate: romeDate,
    randomKey: () => keys.shift() ?? 'chiave-finita',
    now,
  })
  const run = (now = new Date('2026-10-31T17:50:00Z')) => runCycle(deps(now))
  const snapshot = () => parseReservedSnapshot(JSON.parse(kv.values.get(RESERVED_KEY) ?? 'null'))
  const table = (spec: (typeof SHEETS)[keyof typeof SHEETS]) => readTable(workbook, spec)
  const health = (piece: string) => {
    const row = table(SHEETS.health).rows.find((candidate) => candidate.get('pezzo') === piece)
    return { stato: row?.get('stato'), nota: row?.get('nota'), aggiornamento: row?.get('ultimo aggiornamento') }
  }
  return { workbook, kv, state, responses, failNext, run, snapshot, table, health }
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
    expect(kv.writes).toEqual([RESERVED_KEY])
    expect(health(HEALTH.reserved)).toMatchObject({ stato: 'a posto', nota: 'Uguale all’ultima: nessuna scrittura.' })
  })

  it('un campo fuori dalla lista ammessa ferma la pubblicazione, e «Salute» dice quale', () => {
    const { run, kv, workbook, table, health } = setup()
    const projects = table(SHEETS.projects)
    const nextStep = projects.header.get('prossimo passo') ?? 0
    workbook.setCell('Cantieri', projects.rows[2]?.index ?? 0, nextStep, 'scrivere a mario.rossi@example.org')
    const report = run()
    expect(kv.writes).toEqual([])
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
    expect(rows.map((row) => row.get('pezzo'))).toEqual([HEALTH.content, HEALTH.form, HEALTH.reserved, HEALTH.access])
    for (const row of rows) expect(row.get('ultimo controllo')).toEqual(now)
    expect(rows[2]?.get('ultimo aggiornamento')).toEqual(now)
  })

  it('sul Foglio finto non ha né avvisi né violazioni, e pubblica le sezioni di T2', () => {
    const { run, snapshot, health } = setup()
    const report = run()
    expect(report.warnings).toEqual([])
    expect(report.violations).toEqual([])
    expect(health(HEALTH.content).stato).toBe('a posto')
    expect(snapshot()?.resolutions).toHaveLength(7)
    expect(snapshot()?.issues).toHaveLength(3)
    expect(snapshot()?.budget.lines).toHaveLength(3)
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
      randomKey: () => 'k',
      now: start,
    }
    runCycle(deps)
    expect(kv.writes).toEqual([RESERVED_KEY])
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
