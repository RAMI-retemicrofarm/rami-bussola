// Un giro del motore: a ogni risposta dei Moduli e ogni 10 minuti. Crea i codici dei gruppi che mancano, applica le
// risposte nuove ai cantieri, agli incontri e, da T6, agli impegni, rifà le due istantanee (la riservata e, da T7, quella del sito), le
// controlla ognuna sulla sua lista ammessa, pubblica quelle cambiate e scrive com'è andata in «Salute», con la lista
// di Access da allineare. Tutto entra come parametro: in Node il Foglio, i Moduli e KV sono finti, in Apps Script sono
// quelli veri (google.ts).
import { daysBetween, RESERVED_KEY, SITE_KEY, type CalendarDate } from '@bussola/condiviso'
import { accessHealth, accessList } from './access.ts'
import {
  applyCommitmentResponses,
  readCommitments,
  rowsToWrite,
  type CommitmentContext,
  type CommitmentOutcomeRow,
} from './commitments.ts'
import {
  columnOf,
  ContentError,
  readBudget,
  readDeadlines,
  readFirstDay,
  readGroups,
  readIssues,
  readLinks,
  readMeetings,
  readOptionalTable,
  readPeople,
  readProjects,
  readReferents,
  readResolutions,
  readSettings,
  readTable,
  rowValues,
  SHEETS,
  stageCell,
  text,
  type GroupRow,
  type PersonRow,
  type Table,
  type ToLocalTime,
  type Workbook,
} from './content.ts'
import type { CommitmentAnswer, FormResponse, MeetingAnswer, Prefilled, PrefillLinks, UpdateAnswer } from './form.ts'
import type { KvStore } from './kv.ts'
import { applyMeetingResponses, type MeetingOutcome } from './meetings.ts'
import {
  buildMembersSnapshot,
  LAST_RECORDING_DAYS,
  publishMembersSnapshot,
  readMembersSheets,
} from './members-snapshot.ts'
import { publish, type PublishResult, type PublishState } from './publish.ts'
import { buildSnapshots, findViolations, SITE_SHAPE } from './snapshots.ts'
import { applyUpdates, NOT_APPLIED, type ProjectChange, type ResponseOutcome } from './updates.ts'

export type FormSource<A = UpdateAnswer, P extends Prefilled = Prefilled> = {
  /** Le risposte arrivate da `since` in poi, o tutte. */
  responsesSince(since: Date | null): FormResponse<A>[]
  /** Il link di prova del Modulo, per trovare le domande precompilate. */
  prefill(): PrefillLinks<P>
}

export type MeetingFormSource = FormSource<MeetingAnswer, 'group' | 'code'>

/** Il Modulo «Proponi un impegno» (T6): niente link precompilato, ma l'elenco delle righe da scegliere. */
export type CommitmentFormSource = Pick<FormSource<CommitmentAnswer>, 'responsesSince'> & {
  /** Le righe «da scrivere» fra cui si sceglie: si riscrivono solo se sono cambiate. */
  setRowChoices(labels: string[]): void
  /** Il Modulo da aprire, per il tasto della Riservata. */
  url(): string
}

export type CycleDeps = {
  workbook: Workbook
  /** Il Foglio soci (da T4), per i numeri dei soci della Riservata: null, o assente, finché non è collegato. */
  soci?: Workbook | null
  /** Null finché il Modulo non è collegato. */
  form: FormSource | null
  /** Il Modulo «Prossimo incontro» (T7): null, o assente, finché non è collegato. */
  meetingForm?: MeetingFormSource | null
  /** Il Modulo «Proponi un impegno» (T6): null, o assente, finché non è collegato. */
  commitmentForm?: CommitmentFormSource | null
  kv: KvStore
  state: PublishState
  scope: string
  sha256Hex: (text: string) => string
  toCalendarDate: (instant: Date) => CalendarDate
  /** Giorno e ora di Roma, per la «data e ora» degli incontri scritta come data dal Foglio. */
  toLocalTime: ToLocalTime
  /** Un codice del gruppo nuovo, casuale. */
  randomKey: () => string
  now: Date
}

export type CycleReport = {
  warnings: string[]
  outcomes: ResponseOutcome[]
  meetingOutcomes: MeetingOutcome[]
  commitmentOutcomes: CommitmentOutcomeRow[]
  /** Quelle dell'istantanea riservata così come sono; quelle del sito con la chiave davanti. */
  violations: string[]
  published: PublishResult[]
}

/** Le righe di «Salute» che scrive la pubblicazione; le tappe dopo aggiungono le loro. */
export const HEALTH = {
  content: 'Foglio «Bussola · contenuti»',
  form: 'Modulo «Aggiorna il cantiere»',
  meetingForm: 'Modulo «Prossimo incontro»',
  /** Da T6. */
  commitmentForm: 'Modulo «Proponi un impegno»',
  reserved: 'Istantanea riservata (v1/riservata.json)',
  site: 'Istantanea del sito (v1/sito.json)',
  access: 'Lista di Access (Persone della Riservata)',
  usage: 'Uso della Bussola (scheda «Uso»)',
  /** Da T4: i numeri dei soci e l'ultima registrazione di un pagamento, dal Foglio soci. */
  members: 'Istantanea dei soci (v1/soci.json)',
  lastPayment: 'Ultima registrazione di un pagamento (Foglio soci)',
} as const

export type HealthRow = {
  piece: string
  status: 'a posto' | 'da guardare' | 'ferma' | 'da collegare'
  note: string
  updated?: boolean
  /** «ultimo aggiornamento» a un'ora data, invece che a quella del giro: l'ultima registrazione. */
  updatedAt?: Date
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
  const groups = readGroups(readTable(workbook, SHEETS.groups), warnings)
  // Nel ruolo di chi segue una scadenza o una questione valgono i nomi dei gruppi (readRole).
  const groupNames = groups.map((group) => group.name)

  const outcomes = deps.form ? readResponses(deps, deps.form, groups) : []
  const meetingTable = readOptionalTable(workbook, SHEETS.meetings, warnings)
  const meetingOutcomes =
    deps.meetingForm && meetingTable ? readMeetingResponses(deps, deps.meetingForm, meetingTable, groups) : []

  // La lista di Access si dice a ogni giro, anche quando la pubblicazione è ferma: chi esce va tolto lo stesso.
  const people = readPeople(readTable(workbook, SHEETS.people), warnings)
  const { row: access, remember } = accessRow(deps, people)

  const { toCalendarDate } = deps
  const today = toCalendarDate(deps.now)
  const settings = readSettings(readTable(workbook, SHEETS.settings), warnings)
  const projects = readProjects(readTable(workbook, SHEETS.projects), toCalendarDate, warnings)
  // Gli impegni (T6): le risposte completano le righe «da scrivere», poi la scheda si rilegge.
  const commitmentTable = readOptionalTable(workbook, SHEETS.commitments, warnings)
  const commitmentLog = commitmentTable && readOptionalTable(workbook, SHEETS.commitmentResponses, warnings)
  const commitmentContext: CommitmentContext = {
    toCalendarDate,
    warnings,
    groups,
    projects,
    memberNumbers: people.flatMap((person) => (person.memberNumber ? [person.memberNumber] : [])),
    feeVisibleDefault: settings.feeVisibleDefault,
    today,
  }
  const commitmentOutcomes =
    deps.commitmentForm && commitmentTable && commitmentLog
      ? readCommitmentResponses(deps, deps.commitmentForm, commitmentTable, commitmentLog, commitmentContext)
      : []

  let prefill: PrefillLinks | null = null
  if (deps.form) {
    try {
      prefill = deps.form.prefill()
    } catch (error) {
      const note = `Pubblicazione ferma: ${error instanceof Error ? error.message : String(error)}`
      writeHealth(deps, [{ piece: HEALTH.form, status: 'ferma', note }, access])
      remember()
      return { warnings, outcomes, meetingOutcomes, commitmentOutcomes, violations: [], published: [] }
    }
  }
  // Senza il link precompilato degli incontri manca solo «Aggiungi un incontro»: il resto esce.
  let meetingPrefill: PrefillLinks<'group' | 'code'> | null = null
  let meetingPrefillError: string | null = null
  if (deps.meetingForm) {
    try {
      meetingPrefill = deps.meetingForm.prefill()
    } catch (error) {
      meetingPrefillError = error instanceof Error ? error.message : String(error)
    }
  }

  const commitments = commitmentTable ? readCommitments(readTable(workbook, SHEETS.commitments), commitmentContext) : []
  // Senza l'elenco aggiornato il Modulo offre le righe di prima: si dice in «Salute», e il resto esce.
  let commitmentFormUrl: string | null = null
  let commitmentFormError: string | null = null
  if (deps.commitmentForm) {
    try {
      if (commitmentTable) deps.commitmentForm.setRowChoices(rowsToWrite(commitments))
      commitmentFormUrl = deps.commitmentForm.url()
    } catch (error) {
      commitmentFormError = error instanceof Error ? error.message : String(error)
    }
  }
  const referents = readOptionalTable(workbook, SHEETS.referents, warnings)
  // «Incontri» si rilegge: le risposte del Modulo ci hanno appena scritto.
  const meetings = meetingTable && readTable(workbook, SHEETS.meetings)
  const links = readOptionalTable(workbook, SHEETS.links, warnings)
  const firstDay = readOptionalTable(workbook, SHEETS.firstDay, warnings)
  const { reserved, site } = buildSnapshots(
    {
      groups,
      projects,
      people,
      settings,
      prefill,
      meetingPrefill,
      fingerprint: deps.sha256Hex,
      deadlines: readDeadlines(readTable(workbook, SHEETS.deadlines), toCalendarDate, warnings, groupNames),
      resolutions: readResolutions(readTable(workbook, SHEETS.resolutions), toCalendarDate, warnings),
      issues: readIssues(readTable(workbook, SHEETS.issues), toCalendarDate, warnings, groupNames),
      budget: readBudget(readTable(workbook, SHEETS.budget), toCalendarDate, warnings),
      referents: referents ? readReferents(referents, toCalendarDate, warnings, groups) : [],
      meetings: meetings ? readMeetings(meetings, deps.toLocalTime, warnings, groups, NOT_APPLIED) : [],
      links: links ? readLinks(links, warnings, groups) : [],
      firstDay: firstDay ? readFirstDay(firstDay, warnings) : [],
      commitments,
      commitmentFormUrl,
    },
    today,
  )
  // Ogni istantanea si ferma da sola: una mail sul sito non ferma la Riservata, e viceversa.
  const violations = findViolations(reserved)
  const siteViolations = findViolations(site, SITE_SHAPE)
  const publishDeps = { kv: deps.kv, state: deps.state, sha256Hex: deps.sha256Hex, now: deps.now, scope: deps.scope }
  const published = publish(
    [
      ...(violations.length ? [] : [{ key: RESERVED_KEY, content: reserved }]),
      ...(siteViolations.length ? [] : [{ key: SITE_KEY, content: site }]),
    ],
    publishDeps,
  )
  const result = (key: string) => published.find((item) => item.key === key)
  const members = membersHealth(deps, { ...publishDeps, today }, published)

  writeHealth(deps, [
    warnings.length
      ? { piece: HEALTH.content, status: 'da guardare', note: warnings.join(' ') }
      : { piece: HEALTH.content, status: 'a posto', note: '' },
    formHealth(deps, outcomes),
    meetingFormHealth(deps, meetingOutcomes, meetingPrefillError, meetingTable !== null),
    commitmentFormHealth(deps, commitmentOutcomes, commitmentFormError, commitmentLog !== null),
    snapshotHealth(HEALTH.reserved, violations, result(RESERVED_KEY)),
    snapshotHealth(HEALTH.site, siteViolations, result(SITE_KEY)),
    ...members,
    access,
  ])
  remember()
  return {
    warnings,
    outcomes,
    meetingOutcomes,
    commitmentOutcomes,
    violations: [...violations, ...siteViolations.map((violation) => `${SITE_KEY}: ${violation}`)],
    published,
  }
}

/**
 * Le risposte del Modulo non ancora scritte nella scheda che le tiene, dalla più vecchia: si chiedono da un'ora prima
 * dell'ultima scritta (`timeColumn`), e l'«id risposta» toglie quelle già lette.
 */
function freshResponses<A>(
  form: Pick<FormSource<A>, 'responsesSince'>,
  table: Table,
  timeColumn: string,
): FormResponse<A>[] {
  const seen = new Set(table.rows.map((row) => text(row.get('id risposta'))))
  const times = table.rows.map((row) => row.get(timeColumn)).filter((value): value is Date => value instanceof Date)
  const since = times.length ? new Date(Math.max(...times.map((time) => time.getTime())) - OVERLAP) : null
  return form
    .responsesSince(since)
    .filter((response) => !seen.has(response.id))
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
}

/** Le risposte nuove del Modulo «Prossimo incontro», scritte in «Incontri» con l'esito; come per i cantieri. */
function readMeetingResponses(
  deps: CycleDeps,
  form: MeetingFormSource,
  table: Table,
  groups: GroupRow[],
): MeetingOutcome[] {
  const outcomes = applyMeetingResponses(freshResponses(form, table, 'ora della risposta'), groups)
  for (const { response, cells, outcome } of outcomes)
    deps.workbook.appendRow(
      SHEETS.meetings.name,
      rowValues(table, {
        ...cells,
        'ora della risposta': response.submittedAt,
        'id risposta': response.id,
        'esito del controllo': outcome,
      }),
    )
  return outcomes
}

function readResponses(deps: CycleDeps, form: FormSource, groups: ReturnType<typeof readGroups>): ResponseOutcome[] {
  const { workbook } = deps
  const updates = readTable(workbook, SHEETS.updates)
  const fresh = freshResponses(form, updates, 'ora')
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

/**
 * Le risposte nuove del Modulo «Proponi un impegno» (T6): ognuna completa la riga scelta di «Impegni», senza mai
 * aggiungerne una, e resta in «Proposte di impegno» con l'esito. Prima si scrive la riga, poi la risposta: se il
 * giro si ferma in mezzo, il giro dopo riscrive la stessa riga con gli stessi valori.
 */
function readCommitmentResponses(
  deps: CycleDeps,
  form: CommitmentFormSource,
  table: Table,
  log: Table,
  context: CommitmentContext,
): CommitmentOutcomeRow[] {
  const fresh = freshResponses(form, log, 'ora')
  if (!fresh.length) return []
  // Gli avvisi della scheda li dà la lettura dopo le risposte: qui si leggerebbero due volte.
  const rows = readCommitments(table, { ...context, warnings: [] })
  const { outcomes, changes } = applyCommitmentResponses(fresh, rows, context)
  for (const change of changes)
    for (const [column, value] of Object.entries(change.cells))
      deps.workbook.setCell(SHEETS.commitments.name, change.index, columnOf(table, column), value)
  for (const { response, outcome } of outcomes) {
    const { answer } = response
    deps.workbook.appendRow(
      SHEETS.commitmentResponses.name,
      rowValues(log, {
        'id risposta': response.id,
        ora: response.submittedAt,
        impegno: answer.row,
        'cosa si fa': answer.what,
        'cantiere o GdL': answer.for,
        giornate: answer.days,
        'fino a quando': answer.until,
        tipo: answer.term,
        consegne: answer.deliverables,
        'chi verifica': answer.verifier,
        retribuzione: answer.pay,
        compenso: answer.fee,
        'compenso visibile ai soci': answer.feeVisible,
        'proposto da': answer.proposer,
        'proposto da (nome)': answer.proposerFirstName,
        'proposto da (cognome)': answer.proposerLastName,
        'proposto da (mail)': answer.proposerEmail,
        'come si lascia': answer.leave,
        'come si revoca': answer.revoke,
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

/** `tableRead`: la scheda «Incontri» c'è e si legge; se no, le risposte restano nel Modulo e aspettano. */
function meetingFormHealth(
  deps: CycleDeps,
  outcomes: MeetingOutcome[],
  prefillError: string | null,
  tableRead: boolean,
): HealthRow {
  const piece = HEALTH.meetingForm
  if (!deps.meetingForm)
    return { piece, status: 'da collegare', note: 'Il Modulo non è collegato: si lancia setupBussola dall’editor.' }
  if (prefillError) return { piece, status: 'ferma', note: `Manca «Aggiungi un incontro»: ${prefillError}` }
  if (!tableRead)
    return {
      piece,
      status: 'da guardare',
      note: `Manca la scheda «${SHEETS.meetings.name}», o non si legge: le risposte aspettano nel Modulo. Vedi la riga del Foglio.`,
    }
  const rows = readTable(deps.workbook, SHEETS.meetings).rows
  const pending = rows.filter((row) => text(row.get('esito del controllo')).startsWith(NOT_APPLIED)).length
  const read = outcomes.length
  return {
    piece,
    status: pending ? 'da guardare' : 'a posto',
    note: `${read} ${read === 1 ? 'risposta letta' : 'risposte lette'}, ${pending} da controllare.`,
    updated: read > 0,
  }
}

/** Come per «Prossimo incontro»: `logRead` dice che le schede «Impegni» e «Proposte di impegno» ci sono. */
function commitmentFormHealth(
  deps: CycleDeps,
  outcomes: CommitmentOutcomeRow[],
  error: string | null,
  logRead: boolean,
): HealthRow {
  const piece = HEALTH.commitmentForm
  if (!deps.commitmentForm)
    return { piece, status: 'da collegare', note: 'Il Modulo non è collegato: si lancia setupBussola dall’editor.' }
  if (error) return { piece, status: 'da guardare', note: `L’elenco delle righe da scrivere non si aggiorna: ${error}` }
  if (!logRead)
    return {
      piece,
      status: 'da guardare',
      note:
        `Mancano le schede «${SHEETS.commitments.name}» o «${SHEETS.commitmentResponses.name}», o non si leggono: ` +
        'le risposte aspettano nel Modulo. Vedi la riga del Foglio.',
    }
  const rows = readTable(deps.workbook, SHEETS.commitmentResponses).rows
  const pending = rows.filter((row) => text(row.get('esito del controllo')).startsWith(NOT_APPLIED)).length
  const read = outcomes.length
  return {
    piece,
    status: pending ? 'da guardare' : 'a posto',
    note: `${read} ${read === 1 ? 'risposta letta' : 'risposte lette'}, ${pending} da controllare.`,
    updated: read > 0,
  }
}

/**
 * I numeri dei soci (da T4): dal Foglio soci, se è collegato, l'istantanea `v1/soci.json` con la sua riga di
 * «Salute», e la riga dell'ultima registrazione di un pagamento, da guardare oltre i 7 giorni. Un Foglio soci che non
 * si legge ferma solo questa parte.
 */
function membersHealth(
  deps: CycleDeps,
  publishDeps: Parameters<typeof publishMembersSnapshot>[0],
  published: PublishResult[],
): HealthRow[] {
  if (!deps.soci)
    return [
      {
        piece: HEALTH.members,
        status: 'da collegare',
        note: 'Il Foglio soci non è collegato: manca la proprietà SOCI_SHEET_ID.',
      },
    ]
  try {
    const sheets = readMembersSheets(deps.soci, deps.toCalendarDate)
    const content = buildMembersSnapshot(sheets.members, sheets.payments, sheets.settings.dues, publishDeps.today)
    const result = publishMembersSnapshot(publishDeps, content)
    published.push(result)
    const recorded = sheets.payments
      .filter((payment) => payment.method !== 'register' && payment.recordedOn)
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn) || a.id.localeCompare(b.id))
    const last = recorded[recorded.length - 1]
    const daysAgo = last ? daysBetween(last.recordedOn, publishDeps.today) : null
    const lastRow: HealthRow = last
      ? {
          piece: HEALTH.lastPayment,
          status: daysAgo !== null && daysAgo > LAST_RECORDING_DAYS ? 'da guardare' : 'a posto',
          note: `${last.id}, registrato il ${last.recordedOn.split('-').reverse().join('/')} da ${last.recordedBy || 'non si sa chi'}: ${daysAgo === 0 ? 'oggi' : daysAgo === 1 ? '1 giorno fa' : `${daysAgo} giorni fa`}.`,
          updatedAt: new Date(`${last.recordedOn}T12:00:00Z`),
        }
      : { piece: HEALTH.lastPayment, status: 'da guardare', note: 'Nessun pagamento registrato dalla segreteria.' }
    return [snapshotHealth(HEALTH.members, [], result), lastRow]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [{ piece: HEALTH.members, status: 'ferma', note: `Il Foglio soci non si legge: ${message}` }]
  }
}

function snapshotHealth(piece: string, violations: string[], result: PublishResult | undefined): HealthRow {
  if (violations.length)
    return { piece, status: 'ferma', note: `Pubblicazione ferma, niente è uscito: ${violations.join('; ')}` }
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

export function writeHealth(deps: Pick<CycleDeps, 'workbook' | 'now'>, rows: HealthRow[]) {
  const table = readTable(deps.workbook, SHEETS.health)
  for (const row of rows) {
    const values: Record<string, unknown> = { stato: row.status, 'ultimo controllo': deps.now, nota: row.note }
    if (row.updated) values['ultimo aggiornamento'] = deps.now
    if (row.updatedAt) values['ultimo aggiornamento'] = row.updatedAt
    const existing = table.rows.find((candidate) => text(candidate.get('pezzo')) === row.piece)
    if (existing)
      for (const [column, value] of Object.entries(values))
        deps.workbook.setCell(SHEETS.health.name, existing.index, columnOf(table, column), value)
    else deps.workbook.appendRow(SHEETS.health.name, rowValues(table, { pezzo: row.piece, ...values }))
  }
}
