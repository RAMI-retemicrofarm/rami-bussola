// La colla con Google: il Foglio, il Modulo, le proprietà dello script e il lucchetto, dietro le interfacce che il
// giro del motore usa (cycle.ts). Si prova girando il file unito in una vm di Node coi servizi finti (build.test.ts);
// con gli account veri, la prima volta si lancia `setupBussola` dall'editor.
import { bytesToHex, normalizeEmail, type CalendarDate } from '@bussola/condiviso'
import { logAccessEdit } from './access-log.ts'
import { CALENDAR_NAME, EVENT_TAG, REMINDER_DAYS, syncDeadlineCalendar, type DeadlineCalendar } from './calendar.ts'
import {
  AUDIENCE_CHOICES,
  ContentError,
  readDeadlines,
  readGroups,
  readTable,
  SHEETS,
  type SheetSpec,
  type Workbook,
} from './content.ts'
import { COMMITMENT_CHOICES } from './commitments.ts'
import {
  runCycle,
  writeHealth,
  type CommitmentFormSource,
  type CycleDeps,
  type CycleReport,
  type FormSource,
} from './cycle.ts'
import {
  answerFrom,
  COMMITMENT_FORM,
  MEETING_FORM,
  missingQuestions,
  NO_COMMITMENT_ROW,
  parsePrefilledUrl,
  PREFILL_MARKERS,
  UPDATE_FORM,
  type FormResponse,
  type FormSpec,
  type Prefilled,
} from './form.ts'
import { cloudflareKv, type KvStore } from './kv.ts'
import { CHANGE_FORMULAS, measureCells, MEASURES } from './measures.ts'
import {
  ACCESS_ROLES,
  MEMBER_TYPE_WORDS,
  OFFICE_SETTINGS,
  PAYMENT_METHOD_WORDS,
  PAYMENT_STATUS_WORDS,
  PRIVACY_KINDS,
  SOCI_SHEETS,
} from './members.ts'
import { MIGRATION_SHEETS, runMigration } from './migration-run.ts'
import { runMonthly } from './monthly.ts'
import type { OfficeDeps } from './office.ts'
import { requiredProperty } from './properties.ts'
import type { PublishState } from './publish.ts'
import type { RegisterStore } from './register.ts'
import { runSharingCheck, SHARING_PLACES, type SharedItem, type SharingReport } from './sharing.ts'
import { closeUsageMonth } from './usage.ts'

const TIME_ZONE = 'Europe/Rome'
export const HANDLERS = {
  everyTenMinutes: 'everyTenMinutes',
  formSubmit: 'onUpdateFormSubmit',
  accessEdit: 'onAccessEdit',
  sharingCheck: 'checkOfficeSharing',
  meetingFormSubmit: 'onMeetingFormSubmit',
  commitmentFormSubmit: 'onCommitmentFormSubmit',
  contentEdit: 'onContentEdit',
  /** Il giro di una volta sola, un minuto dopo un cambio in «Referenti»: lo crea onContentEdit, non la preparazione. */
  referentsPublish: 'publishReferents',
  usage: 'closeUsage',
} as const

/** «15/11», «1.200», «12:30», «20 %», «vero»: il Foglio ne farebbe una data, un numero, un'ora o un sì. */
const LOOKS_LIKE_VALUE = /^[\d\s.,:/€%()-]*\d[\d\s.,:/€%()-]*$|^(?:true|false|vero|falso)$/i

/**
 * Il Foglio legge ciò che riceve come se lo scrivesse una persona: un testo che comincia con = + - @ diventerebbe una
 * formula, e una risposta come «15/11» una data. Si scrivono come testo, con l'apostrofo davanti. Le date AAAA-MM-GG
 * del motore, come la scadenza, restano date.
 */
export const cellValue = (value: unknown): unknown =>
  typeof value === 'string' &&
  (/^[=+\-@]/.test(value) || (LOOKS_LIKE_VALUE.test(value.trim()) && !/^\d{4}-\d{2}-\d{2}$/.test(value)))
    ? `'${value}`
    : value

export function spreadsheetWorkbook(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet): Workbook {
  const sheet = (name: string) => {
    const found = spreadsheet.getSheetByName(name)
    if (!found) throw new Error(`Manca la scheda «${name}».`)
    return found
  }
  return {
    values: (name) => spreadsheet.getSheetByName(name)?.getDataRange().getValues() ?? null,
    setCell: (name, row, column, value) =>
      void sheet(name)
        .getRange(row + 1, column + 1)
        .setValue(cellValue(value)),
    appendRow: (name, values) => void sheet(name).appendRow(values.map(cellValue)),
  }
}

export function formSource<F extends string, P extends Prefilled>(
  form: GoogleAppsScript.Forms.Form,
  spec: FormSpec<F, P>,
): FormSource<Record<F, string>, P> {
  return {
    responsesSince: (since) =>
      (since ? form.getResponses(since) : form.getResponses()).map((response): FormResponse<Record<F, string>> => ({
        id: response.getId(),
        submittedAt: new Date(response.getTimestamp().getTime()),
        answer: answerFrom(
          spec,
          response.getItemResponses().map((item) => ({
            title: item.getItem().getTitle(),
            response: item.getResponse(),
          })),
        ),
      })),
    prefill() {
      const items = form.getItems()
      let response = form.createResponse()
      for (const field of spec.prefilled) {
        const title = spec.questions.find((question) => (question.field as string) === field)?.title
        const item = items.find((candidate) => candidate.getTitle() === title)
        if (!item) throw new Error(`Il Modulo «${spec.title}» è cambiato: manca la domanda «${title}».`)
        response = response.withItemResponse(item.asTextItem().createResponse(PREFILL_MARKERS[field]))
      }
      return parsePrefilledUrl(response.toPrefilledUrl(), spec)
    },
  }
}

/**
 * Il Modulo «Proponi un impegno»: le risposte come per gli altri Moduli; l'elenco a discesa delle righe «da scrivere»
 * si riscrive solo quando cambia, e senza righe ha la scelta che lo dice, perché Google ne vuole almeno una.
 */
export function commitmentFormSource(form: GoogleAppsScript.Forms.Form): CommitmentFormSource {
  const title = COMMITMENT_FORM.questions.find((question) => question.field === 'row')?.title
  return {
    responsesSince: formSource(form, COMMITMENT_FORM).responsesSince,
    setRowChoices(labels) {
      const item = form.getItems().find((candidate) => candidate.getTitle() === title)
      if (!item) throw new Error(`Il Modulo «${COMMITMENT_FORM.title}» è cambiato: manca la domanda «${title}».`)
      const list = item.asListItem()
      const values = labels.length ? labels : [NO_COMMITMENT_ROW]
      const current = list.getChoices().map((choice) => String(choice.getValue()))
      if (current.join('\n') !== values.join('\n')) list.setChoiceValues(values)
    },
    url: () => form.getPublishedUrl(),
  }
}

export function propertiesState(properties: GoogleAppsScript.Properties.Properties): PublishState {
  return { get: (name) => properties.getProperty(name), set: (name, value) => void properties.setProperty(name, value) }
}

const sha256Hex = (text: string) =>
  bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8))

const toCalendarDate = (instant: Date): CalendarDate => Utilities.formatDate(instant, TIME_ZONE, 'yyyy-MM-dd')

const toLocalTime = (instant: Date) => Utilities.formatDate(instant, TIME_ZONE, "yyyy-MM-dd'T'HH:mm")

/** 122 bit casuali (UUID v4), senza trattini. */
const randomKey = () => Utilities.getUuid().replace(/-/g, '')

/** Il KV della Bussola, con l'API di Cloudflare. */
function bussolaKv(): { kv: KvStore; scope: string } {
  const namespaceId = requiredProperty('CF_KV_NAMESPACE_ID')
  const kv = cloudflareKv(
    { accountId: requiredProperty('CF_ACCOUNT_ID'), namespaceId, apiToken: requiredProperty('CF_API_TOKEN') },
    (url, params) => UrlFetchApp.fetch(url, params),
  )
  return { kv, scope: namespaceId }
}

function cycleDeps(now: Date): CycleDeps {
  const properties = PropertiesService.getScriptProperties()
  const formId = properties.getProperty('UPDATE_FORM_ID')
  const meetingFormId = properties.getProperty('MEETING_FORM_ID')
  const commitmentFormId = properties.getProperty('COMMITMENT_FORM_ID')
  const sociId = properties.getProperty('SOCI_SHEET_ID')
  return {
    workbook: spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID'))),
    // Da T4 il giro pubblica anche i numeri dei soci, se il Foglio soci è collegato.
    soci: sociId ? spreadsheetWorkbook(SpreadsheetApp.openById(sociId)) : null,
    form: formId ? formSource(FormApp.openById(formId), UPDATE_FORM) : null,
    meetingForm: meetingFormId ? formSource(FormApp.openById(meetingFormId), MEETING_FORM) : null,
    commitmentForm: commitmentFormId ? commitmentFormSource(FormApp.openById(commitmentFormId)) : null,
    ...bussolaKv(),
    state: propertiesState(properties),
    sha256Hex,
    toCalendarDate,
    toLocalTime,
    randomKey,
    now,
  }
}

/** Un giro alla volta: la risposta del Modulo e i 10 minuti possono arrivare insieme. */
export function runPublication(): CycleReport | null {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(60_000)) {
    console.log('Un altro giro è in corso da più di un minuto: questo si salta, ci pensa il prossimo.')
    return null
  }
  try {
    const report = runCycle(cycleDeps(new Date()))
    console.log(
      JSON.stringify({
        responses: report.outcomes.map(({ response, outcome }) => ({ id: response.id, outcome })),
        published: report.published,
        violations: report.violations,
        warnings: report.warnings,
      }),
    )
    return report
  } finally {
    lock.releaseLock()
  }
}

/** Il giro dopo un cambio in «Referenti» parte dopo un minuto: uno solo, anche per tante celle cambiate di fila. */
export const REFERENTS_DELAY_MS = 60_000

const referentsTriggers = () =>
  ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === HANDLERS.referentsPublish)

/**
 * Il trigger onEdit del Foglio contenuti: un cambio nella scheda «Referenti» prepara un giro fra un minuto, così il
 * nome di chi ritira il consenso sparisce dal sito senza aspettare i 10 minuti. Se un giro è già in attesa, basta
 * quello. Le altre schede aspettano il trigger dei 10 minuti. Restituisce se ha preparato un giro.
 */
export function scheduleAfterContentEdit(e: GoogleAppsScript.Events.SheetsOnEdit): boolean {
  if (e.range.getSheet().getName() !== SHEETS.referents.name) return false
  if (referentsTriggers().length) return false
  ScriptApp.newTrigger(HANDLERS.referentsPublish).timeBased().after(REFERENTS_DELAY_MS).create()
  return true
}

/**
 * Il giro preparato da scheduleAfterContentEdit: prima cancella il suo trigger, che è di una volta sola, così un
 * cambio che arriva durante il giro ne prepara un altro; poi pubblica.
 */
export function publishAfterReferentsEdit(): CycleReport | null {
  for (const trigger of referentsTriggers()) ScriptApp.deleteTrigger(trigger)
  return runPublication()
}

/** Il primo del mese: l'uso del mese prima nella scheda «Uso», le impronte e il sale cancellati da KV. */
export function runUsageClose(): string[] {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(60_000)) return ['Il motore è occupato: ci riprovo domani.']
  try {
    const now = new Date()
    const { kv, scope } = bussolaKv()
    const workbook = spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID')))
    const report = closeUsageMonth({
      kv,
      scope,
      workbook,
      state: propertiesState(PropertiesService.getScriptProperties()),
      today: toCalendarDate(now),
      // 244 bit casuali: due UUID v4 di fila.
      randomSalt: () => randomKey() + randomKey(),
    })
    writeHealth({ workbook, now }, [report.health])
    return report.lines
  } finally {
    lock.releaseLock()
  }
}

function createForm<F extends string>(spec: FormSpec<F, Prefilled>): GoogleAppsScript.Forms.Form {
  const form = FormApp.create(spec.title)
    .setDescription(spec.description)
    .setConfirmationMessage(spec.confirmation)
    .setRequireLogin(false)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false)
  for (const question of spec.questions) {
    const item =
      question.kind === 'choice'
        ? form.addMultipleChoiceItem().setChoiceValues([...(question.choices ?? [])])
        : question.kind === 'list'
          ? form.addListItem().setChoiceValues([...(question.choices ?? [])])
          : question.kind === 'date'
            ? form.addDateItem().setIncludesYear(true)
            : question.kind === 'time'
              ? form.addTimeItem()
              : question.kind === 'paragraph'
                ? form.addParagraphTextItem()
                : question.kind === 'email'
                  ? form.addTextItem().setValidation(FormApp.createTextValidation().requireTextIsEmail().build())
                  : form.addTextItem()
    item.setTitle(question.title).setHelpText(question.help).setRequired(question.required)
  }
  return form
}

type Choice = { sheet: SheetSpec; column: string; values: string[] }

/** Le colonne a scelta: nelle schede nuove si sceglie da un elenco, e il motore legge solo queste parole. */
const CHOICES: Choice[] = [
  { sheet: SHEETS.projects, column: 'stato', values: ['avvio', 'in corso', 'in revisione', 'in chiusura', 'chiuso'] },
  {
    sheet: SHEETS.deadlines,
    column: 'tipo',
    values: ['bando', 'adempimento', 'fiscale', 'evento', 'Assemblea', 'misura'],
  },
  { sheet: SHEETS.resolutions, column: 'organo', values: ['Direttivo', 'Coordinamento', 'Assemblea'] },
  { sheet: SHEETS.issues, column: 'stato', values: ['aperta', 'chiusa'] },
  { sheet: SHEETS.groups, column: 'chat aperta ai soci', values: ['sì', 'no'] },
  { sheet: SHEETS.deadlines, column: 'visibile ai soci', values: ['sì', 'no'] },
  { sheet: SHEETS.meetings, column: 'visibile ai soci', values: ['sì', 'no'] },
  { sheet: SHEETS.links, column: 'chi lo può aprire', values: AUDIENCE_CHOICES },
  ...Object.entries(COMMITMENT_CHOICES).map(([column, values]) => ({
    sheet: SHEETS.commitments,
    column,
    values: [...values],
  })),
]

/** `at`: la colonna, da 1, quando non è quella dello spec (una colonna aggiunta in fondo a una scheda che c'era). */
function addChoices(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  spec: SheetSpec,
  choices: readonly Choice[],
  at?: number,
) {
  for (const choice of choices) {
    if (choice.sheet !== spec) continue
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(choice.values).build()
    const column = at ?? spec.columns.indexOf(choice.column) + 1
    sheet.getRange(2, column, sheet.getMaxRows() - 1, 1).setDataValidation(rule)
  }
}

/** Le colonne che una tappa dopo aggiunge a una scheda che c'è già: la preparazione le mette in fondo, vuote. */
const LATER_COLUMNS: readonly { sheet: SheetSpec; column: string }[] = [
  { sheet: SHEETS.groups, column: 'chat aperta ai soci' },
  { sheet: SHEETS.deadlines, column: 'visibile ai soci' },
]

/** Le voci di «Impostazioni» nate dopo la prima preparazione, col valore di partenza. */
const LATER_SETTINGS: readonly [string, string][] = [
  ['link della segreteria', ''],
  ['compenso visibile ai soci', 'no'],
]

/** Su una scheda che c'è già: le colonne e le voci nate dopo, in fondo. Il resto non si tocca. */
function addLaterPieces(sheet: GoogleAppsScript.Spreadsheet.Sheet, spec: SheetSpec, done: string[]) {
  const values = sheet.getDataRange().getValues()
  const header = (values[0] ?? []).map((name) => String(name).trim().toLowerCase())
  for (const { column } of LATER_COLUMNS.filter((later) => later.sheet === spec)) {
    if (header.includes(column)) continue
    header.push(column)
    sheet.getRange(1, header.length).setValue(column)
    addChoices(
      sheet,
      spec,
      CHOICES.filter((choice) => choice.column === column),
      header.length,
    )
    done.push(`Scheda «${spec.name}»: aggiunta in fondo la colonna «${column}».`)
  }
  if (spec !== SHEETS.settings) return
  const voice = header.indexOf('voce')
  const written = values.slice(1).map((row) =>
    String(row[voice] ?? '')
      .trim()
      .toLowerCase(),
  )
  for (const [name, value] of LATER_SETTINGS) {
    if (written.includes(name)) continue
    sheet.appendRow([name, value])
    done.push(`Scheda «${spec.name}»: aggiunta la voce «${name}», da scrivere.`)
  }
}

/** Le dieci righe delle Misure, con la formula di «variazione»: la scheda la scrive poi chi conta. */
function fillMeasures(sheet: GoogleAppsScript.Spreadsheet.Sheet) {
  const { columns } = SHEETS.measures
  for (const measure of MEASURES) {
    const cells = measureCells(measure)
    sheet.appendRow(columns.map((name) => cells[name] ?? ''))
  }
  const column = columns.indexOf('variazione') + 1
  MEASURES.forEach((measure, i) => {
    const cell = sheet.getRange(i + 2, column).setFormulaR1C1(CHANGE_FORMULAS[measure.change])
    if (measure.change === 'relative') cell.setNumberFormat('0%')
  })
}

/** Il Modulo che manca, accanto al Foglio, col suo id nelle proprietà; a uno che c'è rimette la descrizione. */
function ensureForm<F extends string>(
  spec: FormSpec<F, Prefilled>,
  property: string,
  folder: () => GoogleAppsScript.Drive.Folder,
  done: string[],
): string {
  const properties = PropertiesService.getScriptProperties()
  const formId = properties.getProperty(property)
  if (!formId) {
    const form = createForm(spec)
    properties.setProperty(property, form.getId())
    DriveApp.getFileById(form.getId()).moveTo(folder())
    done.push(`Modulo «${spec.title}» creato, accanto al Foglio.`)
    return form.getId()
  }
  // Da T3 la descrizione ha il link all'informativa: il Modulo creato prima va aggiornato.
  const form = FormApp.openById(formId)
  if (form.getDescription() !== spec.description) {
    form.setDescription(spec.description)
    done.push(`Descrizione del Modulo «${spec.title}» aggiornata, col link all'informativa.`)
  }
  const missing = missingQuestions(
    spec,
    form.getItems().map((item) => item.getTitle()),
  )
  if (missing.length)
    done.push(
      `Il Modulo «${spec.title}» non ha le domande ${missing.map((question) => `«${question.title}»`).join(', ')}: ` +
        'aggiungile a mano, con questi titoli, perché il motore legge le risposte dal titolo.',
    )
  return formId
}

/**
 * La preparazione, da lanciare dall'editor una volta: le schede che mancano nel Foglio contenuti, con le
 * intestazioni, le colonne a scelta e le dieci righe delle Misure; nelle schede che ci sono, le colonne e le voci
 * nate dopo, in fondo; i Moduli «Aggiorna il cantiere», «Prossimo incontro» e «Proponi un impegno», accanto al Foglio;
 * i trigger. Si può rilanciare: non tocca ciò che c'è già.
 */
export function setup(): string[] {
  const done: string[] = []
  const spreadsheet = SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID'))
  for (const spec of Object.values(SHEETS)) {
    const existing = spreadsheet.getSheetByName(spec.name)
    if (existing) {
      addLaterPieces(existing, spec, done)
      continue
    }
    const sheet = spreadsheet.insertSheet(spec.name)
    sheet.appendRow([...spec.columns])
    sheet.setFrozenRows(1)
    done.push(`Scheda «${spec.name}» creata.`)
    if (spec === SHEETS.settings) {
      sheet.appendRow(['giorni per fermo', 30])
      for (const row of LATER_SETTINGS) sheet.appendRow([...row])
    }
    if (spec === SHEETS.measures) fillMeasures(sheet)
    addChoices(sheet, spec, CHOICES)
  }

  const folder = () => DriveApp.getFileById(spreadsheet.getId()).getParents().next()
  const formId = ensureForm(UPDATE_FORM, 'UPDATE_FORM_ID', folder, done)
  const meetingFormId = ensureForm(MEETING_FORM, 'MEETING_FORM_ID', folder, done)
  const commitmentFormId = ensureForm(COMMITMENT_FORM, 'COMMITMENT_FORM_ID', folder, done)

  const handlers = ScriptApp.getProjectTriggers().map((trigger) => trigger.getHandlerFunction())
  if (!handlers.includes(HANDLERS.everyTenMinutes)) {
    ScriptApp.newTrigger(HANDLERS.everyTenMinutes).timeBased().everyMinutes(10).create()
    done.push('Trigger dei 10 minuti acceso.')
  }
  if (!handlers.includes(HANDLERS.formSubmit)) {
    ScriptApp.newTrigger(HANDLERS.formSubmit).forForm(formId).onFormSubmit().create()
    done.push('Trigger delle risposte del Modulo acceso.')
  }
  if (!handlers.includes(HANDLERS.meetingFormSubmit)) {
    ScriptApp.newTrigger(HANDLERS.meetingFormSubmit).forForm(meetingFormId).onFormSubmit().create()
    done.push('Trigger delle risposte del Modulo «Prossimo incontro» acceso.')
  }
  if (!handlers.includes(HANDLERS.commitmentFormSubmit)) {
    ScriptApp.newTrigger(HANDLERS.commitmentFormSubmit).forForm(commitmentFormId).onFormSubmit().create()
    done.push('Trigger delle risposte del Modulo «Proponi un impegno» acceso.')
  }
  if (!handlers.includes(HANDLERS.contentEdit)) {
    ScriptApp.newTrigger(HANDLERS.contentEdit).forSpreadsheet(spreadsheet.getId()).onEdit().create()
    done.push('Trigger dei cambi di «Referenti» acceso.')
  }
  if (!handlers.includes(HANDLERS.usage)) {
    ScriptApp.newTrigger(HANDLERS.usage).timeBased().everyDays(1).atHour(1).create()
    done.push('Conteggio dell’uso di ogni notte acceso: chiude il mese il primo.')
  }
  return done.length ? done : ['Era già tutto pronto.']
}

// La segreteria (ADR 0002): il Foglio «Bussola · soci», la pagina, il «Registro di Accessi» e il controllo delle
// condivisioni. Il Foglio soci è un file a parte: la proprietà SOCI_SHEET_ID.

const formatInstant = (instant: Date) => Utilities.formatDate(instant, TIME_ZONE, 'dd/MM/yyyy HH:mm')

/** KV per i numeri dei soci; null se le proprietà di Cloudflare mancano: si registra anche senza vetrina. */
function optionalKv(): { kv: KvStore | null; scope: string } {
  try {
    return bussolaKv()
  } catch {
    return { kv: null, scope: '' }
  }
}

/** La cartella «Libro soci»: quella della proprietà, o una nuova accanto al Foglio soci, ricordata. */
function registerFolder(sociId: string): GoogleAppsScript.Drive.Folder {
  const properties = PropertiesService.getScriptProperties()
  const saved = properties.getProperty('LIBRO_SOCI_FOLDER_ID')
  if (saved) return DriveApp.getFolderById(saved)
  const parent = DriveApp.getFileById(sociId).getParents().next()
  const folder = parent.createFolder('Libro soci')
  properties.setProperty('LIBRO_SOCI_FOLDER_ID', folder.getId())
  return folder
}

/**
 * Il Drive per il libro soci: un Foglio nuovo nella cartella «Libro soci», con la scheda protetta (la modifica solo
 * l'account della Bussola) e senza che chi lo legge possa condividerlo. Restituisce il link.
 */
export function driveRegisterStore(sociId: string): RegisterStore {
  return {
    save(name, rows) {
      const spreadsheet = SpreadsheetApp.create(name)
      const sheet = spreadsheet.getSheets()[0] ?? spreadsheet.insertSheet()
      sheet.setName('Libro soci')
      const width = Math.max(1, ...rows.map((row) => row.length))
      if (rows.length)
        sheet
          .getRange(1, 1, rows.length, width)
          .setValues(rows.map((row) => [...row, ...Array(width - row.length).fill('')]))
      sheet.setFrozenRows(1)
      const protection = sheet.protect().setDescription('Il libro soci di questo giorno: in sola lettura.')
      protection.addEditor(Session.getEffectiveUser().getEmail())
      protection.removeEditors(protection.getEditors())
      if (protection.canDomainEdit()) protection.setDomainEdit(false)
      const file = DriveApp.getFileById(spreadsheet.getId())
      file.setShareableByEditors(false)
      file.moveTo(registerFolder(sociId))
      return spreadsheet.getUrl()
    },
  }
}

/** Il Foglio contenuti, per le scadenze e «Salute» della segreteria; null se la proprietà manca. */
function optionalContent(): (() => Workbook) | null {
  const contentId = PropertiesService.getScriptProperties().getProperty('CONTENT_SHEET_ID')
  return contentId ? () => spreadsheetWorkbook(SpreadsheetApp.openById(contentId)) : null
}

/**
 * Le giunture della pagina della segreteria, coi servizi veri. KV serve solo ai numeri dei soci della Riservata, e se
 * non risponde non ferma niente: si registra anche con la vetrina ferma.
 */
export function officeDeps(): OfficeDeps {
  const sociId = requiredProperty('SOCI_SHEET_ID')
  return {
    workbook: spreadsheetWorkbook(SpreadsheetApp.openById(sociId)),
    content: optionalContent(),
    email: Session.getActiveUser().getEmail(),
    now: new Date(),
    toCalendarDate,
    formatInstant,
    withLock(run) {
      // Lo stesso lucchetto della pubblicazione: un giro dura pochi secondi, e si aspetta.
      const lock = LockService.getScriptLock()
      if (!lock.tryLock(30_000))
        throw new ContentError('Il motore è occupato da più di 30 secondi. Riprova: se c’era già, non si duplica.')
      try {
        const result = run()
        // Chi prende il lucchetto dopo deve leggere la riga nuova.
        SpreadsheetApp.flush()
        return result
      } finally {
        lock.releaseLock()
      }
    },
    sendMail: (mail) =>
      MailApp.sendEmail({
        to: mail.to,
        subject: mail.subject,
        body: mail.body,
        name: mail.name,
        replyTo: mail.replyTo,
      }),
    state: propertiesState(PropertiesService.getScriptProperties()),
    ...optionalKv(),
    sha256Hex,
    registerStore: driveRegisterStore(sociId),
  }
}

/** Il calendario «Scadenze RAMI», con CalendarApp: lo crea la prima volta. Le date sono giorni di Roma. */
function deadlineCalendar(): DeadlineCalendar {
  const calendar =
    CalendarApp.getCalendarsByName(CALENDAR_NAME)[0] ??
    CalendarApp.createCalendar(CALENDAR_NAME, { timeZone: TIME_ZONE })
  const asDate = (date: CalendarDate) => new Date(`${date}T00:00:00`)
  const now = Date.now()
  const year = 365 * 86_400_000
  return {
    events: () =>
      calendar
        .getEvents(new Date(now - year), new Date(now + 3 * year))
        .filter((event) => event.getTag(EVENT_TAG))
        .map((event) => ({
          id: event.getId(),
          deadlineId: event.getTag(EVENT_TAG),
          title: event.getTitle(),
          date: toCalendarDate(new Date(event.getAllDayStartDate().getTime())),
        })),
    create(deadlineId, title, date) {
      const event = calendar.createAllDayEvent(title, asDate(date))
      event.setTag(EVENT_TAG, deadlineId)
      // L'avviso 7 giorni prima, come finestra sul telefono: nessuna mail di promemoria.
      event.removeAllReminders()
      event.addPopupReminder(REMINDER_DAYS * 24 * 60)
    },
    update(id, title, date) {
      const event = calendar.getEventById(id)
      if (!event) return
      event.setTitle(title)
      event.setAllDayDate(asDate(date))
    },
    remove(id) {
      calendar.getEventById(id)?.deleteEvent()
    },
  }
}

/** Ogni notte il calendario «Scadenze RAMI» dice ciò che dice la scheda «Scadenze»; un errore non ferma il resto. */
export function runCalendarSync(): string[] {
  try {
    const content = spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID')))
    const groups = readGroups(readTable(content, SHEETS.groups))
    const deadlines = readDeadlines(
      readTable(content, SHEETS.deadlines),
      toCalendarDate,
      [],
      groups.map((group) => group.name),
    )
    const { created, updated, removed } = syncDeadlineCalendar(deadlines, deadlineCalendar())
    return [`Calendario «${CALENDAR_NAME}»: ${created} eventi creati, ${updated} aggiornati, ${removed} tolti.`]
  } catch (error) {
    return [`Calendario «${CALENDAR_NAME}» non allineato: ${error instanceof Error ? error.message : String(error)}`]
  }
}

/**
 * L'automatismo mensile della segreteria, dal trigger di ogni notte (monthly.ts): la scadenza «misura» del mese nel
 * Foglio contenuti e il libro soci nel Drive. Senza il Foglio soci collegato non fa niente.
 */
export function runMonthlyTasks(): string[] {
  const properties = PropertiesService.getScriptProperties()
  const sociId = properties.getProperty('SOCI_SHEET_ID')
  if (!sociId) return []
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(60_000)) return ['Il motore è occupato: l’automatismo mensile riprova domani notte.']
  try {
    const now = new Date()
    const { lines } = runMonthly({
      content: spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID'))),
      soci: spreadsheetWorkbook(SpreadsheetApp.openById(sociId)),
      state: propertiesState(properties),
      today: toCalendarDate(now),
      toCalendarDate,
      store: driveRegisterStore(sociId),
    })
    return lines
  } finally {
    lock.releaseLock()
  }
}

/** Il trigger installabile onEdit del Foglio soci: scrive i cambi di «Accessi» nel registro. */
export function recordAccessEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  const { range } = e
  const singleCell = range.getNumRows() === 1 && range.getNumColumns() === 1
  logAccessEdit(spreadsheetWorkbook(e.source), {
    sheet: range.getSheet().getName(),
    cells: range.getA1Notation(),
    singleCell,
    oldValue: e.oldValue,
    value: e.value,
    shown: singleCell ? [] : range.getDisplayValues(),
    user: e.user ? e.user.getEmail() : '',
    when: new Date(),
  })
}

type DriveItem = GoogleAppsScript.Drive.File | GoogleAppsScript.Drive.Folder

function sharedItem(where: string, item: DriveItem): SharedItem {
  const emails = (users: GoogleAppsScript.Drive.User[]) => users.map((user) => user.getEmail())
  return {
    where,
    editors: emails(item.getEditors()),
    viewers: emails(item.getViewers()),
    access: String(item.getSharingAccess()),
    permission: String(item.getSharingPermission()),
  }
}

/** Il controllo di ogni giorno: Foglio soci, la sua cartella «Bussola» e, se c'è, la cartella «Libro soci». */
export function runOfficeSharingCheck(): SharingReport {
  const properties = PropertiesService.getScriptProperties()
  const sociId = requiredProperty('SOCI_SHEET_ID')
  const file = DriveApp.getFileById(sociId)
  const libroId = properties.getProperty('LIBRO_SOCI_FOLDER_ID')
  return runSharingCheck({
    soci: spreadsheetWorkbook(SpreadsheetApp.openById(sociId)),
    content: () => spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID'))),
    owner: Session.getEffectiveUser().getEmail(),
    sociSheet: sharedItem(SHARING_PLACES.sociSheet, file),
    bussolaFolder: sharedItem(SHARING_PLACES.bussolaFolder, file.getParents().next()),
    libroFolder: libroId ? sharedItem(SHARING_PLACES.libroFolder, DriveApp.getFolderById(libroId)) : null,
    state: propertiesState(properties),
    today: toCalendarDate(new Date()),
  })
}

const YES_NO = ['sì', 'no']

/** Le colonne a scelta del Foglio soci. */
const SOCI_CHOICES: Choice[] = [
  { sheet: SOCI_SHEETS.members, column: 'tipo', values: Object.values(MEMBER_TYPE_WORDS) },
  { sheet: SOCI_SHEETS.payments, column: 'modo', values: Object.values(PAYMENT_METHOD_WORDS) },
  { sheet: SOCI_SHEETS.payments, column: 'stato', values: Object.values(PAYMENT_STATUS_WORDS) },
  { sheet: SOCI_SHEETS.access, column: 'ruolo', values: [...ACCESS_ROLES] },
  { sheet: SOCI_SHEETS.access, column: "entra nell'area", values: YES_NO },
  { sheet: SOCI_SHEETS.access, column: 'può registrare pagamenti', values: YES_NO },
  { sheet: SOCI_SHEETS.access, column: 'può confermare pagamenti', values: YES_NO },
  { sheet: SOCI_SHEETS.privacyLog, column: 'tipo', values: [...PRIVACY_KINDS] },
]

const READER_NOTE = 'chi cura la Bussola: scrivi la sua mail'

/**
 * La preparazione del Foglio soci, da lanciare dall'editor con l'account della Bussola (ADR 0004): le schede che
 * mancano, con le intestazioni, le colonne a scelta e le impostazioni di partenza; il «Registro di Accessi» protetto,
 * che modificano solo il proprietario e l'account della Bussola; i due trigger, che girano come chi li crea. Si può
 * rilanciare: non tocca ciò che c'è già. Se il Foglio non è dell'account della Bussola, la prima riga lo dice.
 */
export function setupSociSheet(): string[] {
  const done: string[] = []
  const spreadsheetId = requiredProperty('SOCI_SHEET_ID')
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  const me = Session.getEffectiveUser().getEmail()
  // Il registro e la proprietà del Foglio devono stare con l'account dei trigger. In un Drive condiviso il proprietario
  // non c'è: niente avviso.
  const owner = DriveApp.getFileById(spreadsheetId).getOwner()?.getEmail() ?? ''
  const warnings =
    owner && normalizeEmail(owner) !== normalizeEmail(me)
      ? [
          `Attenzione: il Foglio soci è di ${owner}, non dell’account della Bussola (${me}). Spostane la proprietà, ` +
            'poi rilancia setupSoci.',
        ]
      : []
  for (const spec of Object.values(SOCI_SHEETS)) {
    if (spreadsheet.getSheetByName(spec.name)) continue
    const sheet = spreadsheet.insertSheet(spec.name)
    sheet.appendRow([...spec.columns])
    sheet.setFrozenRows(1)
    done.push(`Scheda «${spec.name}» creata.`)
    if (spec === SOCI_SHEETS.settings)
      for (const { voce, partenza } of Object.values(OFFICE_SETTINGS))
        // «15/10» resta testo: il Foglio ne farebbe una data dell'anno in corso.
        sheet.appendRow([voce, cellValue(partenza), voce === OFFICE_SETTINGS.reader.voce ? READER_NOTE : ''])
    addChoices(sheet, spec, SOCI_CHOICES)
  }

  const log = spreadsheet.getSheetByName(SOCI_SHEETS.accessLog.name)
  if (log && !log.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    const protection = log.protect().setDescription('Lo scrive solo il motore, con l’account della Bussola.')
    // Prima l'account dei trigger, come nell'esempio di Apps Script: se il Foglio non è suo, togliendo tutti gli
    // editori il trigger non scriverebbe più il registro.
    protection.addEditor(me)
    protection.removeEditors(protection.getEditors())
    if (protection.canDomainEdit()) protection.setDomainEdit(false)
    done.push(
      `Scheda «${SOCI_SHEETS.accessLog.name}» protetta: la modificano solo il proprietario e l’account della Bussola.`,
    )
  }

  const handlers = ScriptApp.getProjectTriggers().map((trigger) => trigger.getHandlerFunction())
  if (!handlers.includes(HANDLERS.accessEdit)) {
    ScriptApp.newTrigger(HANDLERS.accessEdit).forSpreadsheet(spreadsheet.getId()).onEdit().create()
    done.push('Trigger del «Registro di Accessi» acceso.')
  }
  if (!handlers.includes(HANDLERS.sharingCheck)) {
    ScriptApp.newTrigger(HANDLERS.sharingCheck).timeBased().everyDays(1).atHour(6).create()
    done.push('Controllo delle condivisioni di ogni giorno acceso.')
  }
  return [...warnings, ...(done.length ? done : ['Era già tutto pronto.'])]
}

/**
 * La migrazione del libro soci (T3), dall'editor, con lo stesso lucchetto della segreteria: nessuno registra mentre si
 * scrive. Il resoconto va nella scheda «Migrazione», rifatto da capo a ogni lancio, per leggerlo col segretario.
 */
export function migrationRun(write: boolean): string[] {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty('SOCI_SHEET_ID'))
  const now = new Date()
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(30_000)) return ['Il motore è occupato: riprova fra un minuto.']
  try {
    const lines = runMigration(spreadsheetWorkbook(spreadsheet), { today: toCalendarDate(now), toCalendarDate, write })
    const report =
      spreadsheet.getSheetByName(MIGRATION_SHEETS.report) ?? spreadsheet.insertSheet(MIGRATION_SHEETS.report)
    report.clear()
    report.appendRow([`${write ? 'Migrazione' : 'Prova'} del ${formatInstant(now)}`])
    for (const line of lines) report.appendRow([cellValue(line)])
    SpreadsheetApp.flush()
    return lines
  } finally {
    lock.releaseLock()
  }
}
