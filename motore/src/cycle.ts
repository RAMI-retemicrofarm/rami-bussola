// Un giro del motore: a ogni risposta del Modulo e ogni 10 minuti. Crea i codici dei gruppi che mancano, applica le
// risposte nuove ai cantieri, rifà l'istantanea riservata, la controlla sulla lista ammessa, la pubblica se è
// cambiata e scrive com'è andata in «Salute», con la lista di Access da allineare. Tutto entra come parametro: in
// Node il Foglio, il Modulo e KV sono finti, in Apps Script sono quelli veri (google.ts).
import { RESERVED_KEY, type CalendarDate } from '@bussola/condiviso'
import { accessHealth, accessList } from './access.ts'
import {
  columnOf,
  ContentError,
  readBudget,
  readDeadlines,
  readGroups,
  readIssues,
  readPeople,
  readProjects,
  readResolutions,
  readSettings,
  readTable,
  rowValues,
  SHEETS,
  stageCell,
  text,
  type PersonRow,
  type Table,
  type Workbook,
} from './content.ts'
import type { FormResponse, PrefillLinks } from './form.ts'
import type { KvStore } from './kv.ts'
import { publish, type PublishResult, type PublishState } from './publish.ts'
import { buildReservedSnapshot, findViolations } from './snapshots.ts'
import { applyUpdates, NOT_APPLIED, type ProjectChange, type ResponseOutcome } from './updates.ts'

export type FormSource = {
  /** Le risposte arrivate da `since` in poi, o tutte. */
  responsesSince(since: Date | null): FormResponse[]
  /** Il link di prova del Modulo, per trovare le domande precompilate. */
  prefill(): PrefillLinks
}

export type CycleDeps = {
  workbook: Workbook
  /** Null finché il Modulo non è collegato. */
  form: FormSource | null
  kv: KvStore
  state: PublishState
  scope: string
  sha256Hex: (text: string) => string
  toCalendarDate: (instant: Date) => CalendarDate
  /** Un codice del gruppo nuovo, casuale. */
  randomKey: () => string
  now: Date
}

export type CycleReport = {
  warnings: string[]
  outcomes: ResponseOutcome[]
  violations: string[]
  published: PublishResult[]
}

/** Le righe di «Salute» che scrive la pubblicazione; le tappe dopo aggiungono le loro. */
export const HEALTH = {
  content: 'Foglio «Bussola · contenuti»',
  form: 'Modulo «Aggiorna il cantiere»',
  reserved: 'Istantanea riservata (v1/riservata.json)',
  access: 'Lista di Access (Persone della Riservata)',
} as const

type HealthRow = {
  piece: string
  status: 'a posto' | 'da guardare' | 'ferma' | 'da collegare'
  note: string
  updated?: boolean
}

/** Le risposte si rileggono da un'ora prima dell'ultima già scritta; l'id evita i doppioni. */
const OVERLAP = 3_600_000

export function runCycle(deps: CycleDeps): CycleReport {
  readTable(deps.workbook, SHEETS.health)
  try {
    return cycle(deps)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      writeHealth(deps, [
        error instanceof ContentError
          ? { piece: HEALTH.content, status: 'ferma', note: message }
          : { piece: HEALTH.reserved, status: 'ferma', note: `Giro interrotto: ${message}. Riprovo al giro dopo.` },
      ])
    } catch {
      // Se anche «Salute» non si scrive, l'errore resta nel registro delle esecuzioni di Apps Script.
    }
    throw error
  }
}

function cycle(deps: CycleDeps): CycleReport {
  const { workbook } = deps
  const warnings: string[] = []

  // Un codice vuoto, o uguale a quello di un gruppo più in alto (una riga copiata), ne prende uno nuovo: le risposte
  // di un gruppo non devono finire in un altro.
  const groupsTable = readTable(workbook, SHEETS.groups)
  const owners = new Map<string, string>()
  for (const group of readGroups(groupsTable)) {
    const owner = group.formKey ? owners.get(group.formKey) : undefined
    if (group.formKey && owner === undefined) {
      owners.set(group.formKey, group.name)
      continue
    }
    workbook.setCell(SHEETS.groups.name, group.index, columnOf(groupsTable, 'codice del gruppo'), deps.randomKey())
    if (owner !== undefined)
      warnings.push(
        `«${SHEETS.groups.name}», riga ${group.index + 1}: il codice del gruppo era uguale a quello di «${owner}»: ` +
          'ne ho fatto uno nuovo, e i link di questo gruppo cambiano.',
      )
  }
  const groups = readGroups(readTable(workbook, SHEETS.groups))
  // Nel ruolo di chi segue una scadenza o una questione valgono i nomi dei gruppi (readRole).
  const groupNames = groups.map((group) => group.name)

  const outcomes = deps.form ? readResponses(deps, deps.form, groups) : []

  // La lista di Access si dice a ogni giro, anche quando la pubblicazione è ferma: chi esce va tolto lo stesso.
  const people = readPeople(readTable(workbook, SHEETS.people), warnings)
  const { row: access, remember } = accessRow(deps, people)

  let prefill: PrefillLinks | null = null
  if (deps.form) {
    try {
      prefill = deps.form.prefill()
    } catch (error) {
      const note = `Pubblicazione ferma: ${error instanceof Error ? error.message : String(error)}`
      writeHealth(deps, [{ piece: HEALTH.form, status: 'ferma', note }, access])
      remember()
      return { warnings, outcomes, violations: [], published: [] }
    }
  }

  const { toCalendarDate } = deps
  const content = buildReservedSnapshot({
    groups,
    projects: readProjects(readTable(workbook, SHEETS.projects), toCalendarDate, warnings),
    people,
    settings: readSettings(readTable(workbook, SHEETS.settings), warnings),
    prefill,
    fingerprint: deps.sha256Hex,
    deadlines: readDeadlines(readTable(workbook, SHEETS.deadlines), toCalendarDate, warnings, groupNames),
    resolutions: readResolutions(readTable(workbook, SHEETS.resolutions), toCalendarDate, warnings),
    issues: readIssues(readTable(workbook, SHEETS.issues), toCalendarDate, warnings, groupNames),
    budget: readBudget(readTable(workbook, SHEETS.budget), toCalendarDate, warnings),
    today: toCalendarDate(deps.now),
  })
  const violations = findViolations(content)
  const published = violations.length
    ? []
    : publish([{ key: RESERVED_KEY, content }], {
        kv: deps.kv,
        state: deps.state,
        sha256Hex: deps.sha256Hex,
        now: deps.now,
        scope: deps.scope,
      })

  writeHealth(deps, [
    warnings.length
      ? { piece: HEALTH.content, status: 'da guardare', note: warnings.join(' ') }
      : { piece: HEALTH.content, status: 'a posto', note: '' },
    formHealth(deps, outcomes),
    reservedHealth(violations, published),
    access,
  ])
  remember()
  return { warnings, outcomes, violations, published }
}

function readResponses(deps: CycleDeps, form: FormSource, groups: ReturnType<typeof readGroups>): ResponseOutcome[] {
  const { workbook } = deps
  const updates = readTable(workbook, SHEETS.updates)
  const seen = new Set(updates.rows.map((row) => text(row.get('id risposta'))))
  const times = updates.rows.map((row) => row.get('ora')).filter((value): value is Date => value instanceof Date)
  const since = times.length ? new Date(Math.max(...times.map((time) => time.getTime())) - OVERLAP) : null
  const fresh = form
    .responsesSince(since)
    .filter((response) => !seen.has(response.id))
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
  if (!fresh.length) return []

  const projects = readTable(workbook, SHEETS.projects)
  const taken = projects.rows.map((row) => text(row.get('id')))
  const { outcomes, changes } = applyUpdates(fresh, groups, readProjects(projects, deps.toCalendarDate, []), taken)
  writeProjects(workbook, projects, changes)
  for (const { response, outcome } of outcomes) {
    const { answer } = response
    workbook.appendRow(
      SHEETS.updates.name,
      rowValues(updates, {
        'id risposta': response.id,
        ora: response.submittedAt,
        gruppo: answer.group,
        cantiere: answer.project,
        'codice del gruppo': answer.code,
        'chi sei': answer.who,
        'a che punto è': answer.stage,
        'cosa è successo': answer.news,
        'prossimo passo': answer.nextStep,
        'per quando': answer.dueOn,
        'serve aiuto': answer.help,
        'esito del controllo': outcome,
      }),
    )
  }
  return outcomes
}

function writeProjects(workbook: Workbook, table: Table, changes: ProjectChange[]) {
  const rows = new Map(table.rows.map((row) => [text(row.get('id')), row.index]))
  for (const change of changes) {
    const cells: Record<string, unknown> = {
      stato: stageCell(change.stage),
      'ultima novità': change.lastNews,
      'prossimo passo': change.nextStep,
      scadenza: change.dueOn ?? '',
      'serve aiuto': change.helpWanted,
      'aggiornato il': change.updatedAt,
      'chiuso il': change.closedAt ?? '',
    }
    const index = rows.get(change.id)
    if (change.isNew || index === undefined) {
      const values = { id: change.id, GdL: change.groupId, titolo: change.title, ...cells }
      workbook.appendRow(SHEETS.projects.name, rowValues(table, values))
    } else {
      for (const [column, value] of Object.entries(cells))
        workbook.setCell(SHEETS.projects.name, index, columnOf(table, column), value)
    }
  }
}

function formHealth(deps: CycleDeps, outcomes: ResponseOutcome[]): HealthRow {
  if (!deps.form)
    return {
      piece: HEALTH.form,
      status: 'da collegare',
      note: 'Il Modulo non è collegato: si lancia setupBussola dall’editor.',
    }
  const pending = readTable(deps.workbook, SHEETS.updates).rows.filter((row) =>
    text(row.get('esito del controllo')).startsWith(NOT_APPLIED),
  ).length
  const read = outcomes.length
  return {
    piece: HEALTH.form,
    status: pending ? 'da guardare' : 'a posto',
    note: `${read} ${read === 1 ? 'risposta letta' : 'risposte lette'}, ${pending} da controllare.`,
    updated: read > 0,
  }
}

function reservedHealth(violations: string[], published: PublishResult[]): HealthRow {
  const piece = HEALTH.reserved
  if (violations.length)
    return { piece, status: 'ferma', note: `Pubblicazione ferma, niente è uscito: ${violations.join('; ')}` }
  const [result] = published
  if (result?.status === 'failed')
    return { piece, status: 'da guardare', note: `Cloudflare non risponde: riprovo al giro dopo. ${result.error}` }
  if (result?.status === 'written')
    return { piece, status: 'a posto', note: 'Pubblicata: era cambiata.', updated: true }
  return { piece, status: 'a posto', note: 'Uguale all’ultima: nessuna scrittura.' }
}

/** Una lista ricordata che non si legge vale come nessuna: la nota ridà la lista intera. */
function savedList(value: string | null): string[] | null {
  if (!value) return null
  try {
    const list: unknown = JSON.parse(value)
    return Array.isArray(list) && list.every((item) => typeof item === 'string') ? list : null
  } catch {
    return null
  }
}

/**
 * La riga della lista di Access. Lista e nota dell'ultimo cambio si ricordano nelle proprietà dello script, come la
 * pubblicazione; quando la lista cambia, «ultimo aggiornamento» dice da quando Access è da allineare. Si ricordano
 * con `remember`, dopo aver scritto «Salute»: se il giro si ferma prima, il cambio lo segna il giro dopo.
 */
function accessRow(deps: CycleDeps, people: PersonRow[]): { row: HealthRow; remember: () => void } {
  const listName = `access:${deps.scope}:lista`
  const noteName = `access:${deps.scope}:nota`
  const list = accessList(people)
  const health = accessHealth(list, savedList(deps.state.get(listName)), deps.state.get(noteName))
  return {
    row: { piece: HEALTH.access, status: health.status, note: health.note, updated: health.changed },
    remember() {
      if (!health.changed) return
      deps.state.set(listName, JSON.stringify(list))
      deps.state.set(noteName, health.note)
    },
  }
}

function writeHealth(deps: CycleDeps, rows: HealthRow[]) {
  const table = readTable(deps.workbook, SHEETS.health)
  for (const row of rows) {
    const values: Record<string, unknown> = { stato: row.status, 'ultimo controllo': deps.now, nota: row.note }
    if (row.updated) values['ultimo aggiornamento'] = deps.now
    const existing = table.rows.find((candidate) => text(candidate.get('pezzo')) === row.piece)
    if (existing)
      for (const [column, value] of Object.entries(values))
        deps.workbook.setCell(SHEETS.health.name, existing.index, columnOf(table, column), value)
    else deps.workbook.appendRow(SHEETS.health.name, rowValues(table, { pezzo: row.piece, ...values }))
  }
}
