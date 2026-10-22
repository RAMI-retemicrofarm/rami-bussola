// La colla con Google: il Foglio, il Modulo, le proprietà dello script e il lucchetto, dietro le interfacce che il
// giro del motore usa (cycle.ts). Si prova girando il file unito in una vm di Node coi servizi finti (build.test.ts);
// con gli account veri, la prima volta si lancia `setupBussola` dall'editor.
import { bytesToHex, normalizeEmail, type CalendarDate } from '@bussola/condiviso'
import { logAccessEdit } from './access-log.ts'
import { ContentError, SHEETS, type SheetSpec, type Workbook } from './content.ts'
import { runCycle, type CycleDeps, type CycleReport, type FormSource } from './cycle.ts'
import { answerFromItems, parsePrefilledUrl, PREFILL_MARKERS, UPDATE_FORM, type FormResponse } from './form.ts'
import { cloudflareKv } from './kv.ts'
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
import type { OfficeDeps } from './office.ts'
import { requiredProperty } from './properties.ts'
import type { PublishState } from './publish.ts'
import { runSharingCheck, SHARING_PLACES, type SharedItem, type SharingReport } from './sharing.ts'

const TIME_ZONE = 'Europe/Rome'
export const HANDLERS = {
  everyTenMinutes: 'everyTenMinutes',
  formSubmit: 'onUpdateFormSubmit',
  accessEdit: 'onAccessEdit',
  sharingCheck: 'checkOfficeSharing',
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

export function formSource(form: GoogleAppsScript.Forms.Form): FormSource {
  return {
    responsesSince: (since) =>
      (since ? form.getResponses(since) : form.getResponses()).map((response): FormResponse => ({
        id: response.getId(),
        submittedAt: new Date(response.getTimestamp().getTime()),
        answer: answerFromItems(
          response.getItemResponses().map((item) => ({
            title: item.getItem().getTitle(),
            response: item.getResponse(),
          })),
        ),
      })),
    prefill() {
      const items = form.getItems()
      let response = form.createResponse()
      for (const field of ['group', 'project', 'code'] as const) {
        const title = UPDATE_FORM.questions.find((question) => question.field === field)?.title
        const item = items.find((candidate) => candidate.getTitle() === title)
        if (!item) throw new Error(`Il Modulo è cambiato: manca la domanda «${title}».`)
        response = response.withItemResponse(item.asTextItem().createResponse(PREFILL_MARKERS[field]))
      }
      return parsePrefilledUrl(response.toPrefilledUrl())
    },
  }
}

export function propertiesState(properties: GoogleAppsScript.Properties.Properties): PublishState {
  return { get: (name) => properties.getProperty(name), set: (name, value) => void properties.setProperty(name, value) }
}

const sha256Hex = (text: string) =>
  bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8))

const toCalendarDate = (instant: Date): CalendarDate => Utilities.formatDate(instant, TIME_ZONE, 'yyyy-MM-dd')

/** 122 bit casuali (UUID v4), senza trattini. */
const randomKey = () => Utilities.getUuid().replace(/-/g, '')

function cycleDeps(now: Date): CycleDeps {
  const properties = PropertiesService.getScriptProperties()
  const namespaceId = requiredProperty('CF_KV_NAMESPACE_ID')
  const formId = properties.getProperty('UPDATE_FORM_ID')
  return {
    workbook: spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID'))),
    form: formId ? formSource(FormApp.openById(formId)) : null,
    kv: cloudflareKv(
      { accountId: requiredProperty('CF_ACCOUNT_ID'), namespaceId, apiToken: requiredProperty('CF_API_TOKEN') },
      (url, params) => UrlFetchApp.fetch(url, params),
    ),
    state: propertiesState(properties),
    scope: namespaceId,
    sha256Hex,
    toCalendarDate,
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

function createUpdateForm(): GoogleAppsScript.Forms.Form {
  const form = FormApp.create(UPDATE_FORM.title)
    .setDescription(UPDATE_FORM.description)
    .setConfirmationMessage(UPDATE_FORM.confirmation)
    .setRequireLogin(false)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false)
  for (const question of UPDATE_FORM.questions) {
    const item =
      question.kind === 'choice'
        ? form.addMultipleChoiceItem().setChoiceValues([...(question.choices ?? [])])
        : question.kind === 'date'
          ? form.addDateItem().setIncludesYear(true)
          : question.kind === 'paragraph'
            ? form.addParagraphTextItem()
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
]

function addChoices(sheet: GoogleAppsScript.Spreadsheet.Sheet, spec: SheetSpec, choices: readonly Choice[]) {
  for (const choice of choices) {
    if (choice.sheet !== spec) continue
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(choice.values).build()
    const column = spec.columns.indexOf(choice.column) + 1
    sheet.getRange(2, column, sheet.getMaxRows() - 1, 1).setDataValidation(rule)
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

/**
 * La preparazione, da lanciare dall'editor una volta: le schede che mancano nel Foglio contenuti, con le
 * intestazioni, le colonne a scelta e le dieci righe delle Misure; il Modulo «Aggiorna il cantiere», accanto al
 * Foglio; i due trigger. Si può rilanciare: non tocca ciò che c'è già.
 */
export function setup(): string[] {
  const done: string[] = []
  const properties = PropertiesService.getScriptProperties()
  const spreadsheet = SpreadsheetApp.openById(requiredProperty('CONTENT_SHEET_ID'))
  for (const spec of Object.values(SHEETS)) {
    if (spreadsheet.getSheetByName(spec.name)) continue
    const sheet = spreadsheet.insertSheet(spec.name)
    sheet.appendRow([...spec.columns])
    sheet.setFrozenRows(1)
    done.push(`Scheda «${spec.name}» creata.`)
    if (spec === SHEETS.settings) sheet.appendRow(['giorni per fermo', 30])
    if (spec === SHEETS.measures) fillMeasures(sheet)
    addChoices(sheet, spec, CHOICES)
  }

  let formId = properties.getProperty('UPDATE_FORM_ID')
  if (!formId) {
    const form = createUpdateForm()
    formId = form.getId()
    properties.setProperty('UPDATE_FORM_ID', formId)
    DriveApp.getFileById(formId).moveTo(DriveApp.getFileById(spreadsheet.getId()).getParents().next())
    done.push(`Modulo «${UPDATE_FORM.title}» creato, accanto al Foglio.`)
  } else {
    // Da T3 la descrizione ha il link all'informativa: il Modulo creato prima va aggiornato.
    const form = FormApp.openById(formId)
    if (form.getDescription() !== UPDATE_FORM.description) {
      form.setDescription(UPDATE_FORM.description)
      done.push(`Descrizione del Modulo «${UPDATE_FORM.title}» aggiornata, col link all'informativa.`)
    }
  }

  const handlers = ScriptApp.getProjectTriggers().map((trigger) => trigger.getHandlerFunction())
  if (!handlers.includes(HANDLERS.everyTenMinutes)) {
    ScriptApp.newTrigger(HANDLERS.everyTenMinutes).timeBased().everyMinutes(10).create()
    done.push('Trigger dei 10 minuti acceso.')
  }
  if (!handlers.includes(HANDLERS.formSubmit)) {
    ScriptApp.newTrigger(HANDLERS.formSubmit).forForm(formId).onFormSubmit().create()
    done.push('Trigger delle risposte del Modulo acceso.')
  }
  return done.length ? done : ['Era già tutto pronto.']
}

// La segreteria (ADR 0002): il Foglio «Bussola · soci», la pagina, il «Registro di Accessi» e il controllo delle
// condivisioni. Il Foglio soci è un file a parte: la proprietà SOCI_SHEET_ID.

const formatInstant = (instant: Date) => Utilities.formatDate(instant, TIME_ZONE, 'dd/MM/yyyy HH:mm')

/** Le giunture della pagina della segreteria, coi servizi veri. Niente KV: si registra anche con la vetrina ferma. */
export function officeDeps(): OfficeDeps {
  return {
    workbook: spreadsheetWorkbook(SpreadsheetApp.openById(requiredProperty('SOCI_SHEET_ID'))),
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
    sendMail: (mail) => MailApp.sendEmail({ to: mail.to, subject: mail.subject, body: mail.body, name: mail.name }),
    state: propertiesState(PropertiesService.getScriptProperties()),
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
 * La preparazione del Foglio soci, da lanciare dall'editor con l'account segreteria@: le schede che mancano, con le
 * intestazioni, le colonne a scelta e le impostazioni di partenza; il «Registro di Accessi» protetto, che modificano
 * solo il proprietario e segreteria@; i due trigger, che girano come chi li crea. Si può rilanciare: non tocca ciò che
 * c'è già. Se il Foglio non è di segreteria@, la prima riga lo dice.
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
          `Attenzione: il Foglio soci è di ${owner}, non dell’account della segreteria. Spostane la proprietà, poi ` +
            'rilancia setupSoci.',
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
    const protection = log.protect().setDescription('Lo scrive solo il motore, con l’account della segreteria.')
    // Prima l'account dei trigger, come nell'esempio di Apps Script: se il Foglio non è suo, togliendo tutti gli
    // editori il trigger non scriverebbe più il registro.
    protection.addEditor(me)
    protection.removeEditors(protection.getEditors())
    if (protection.canDomainEdit()) protection.setDomainEdit(false)
    done.push(
      `Scheda «${SOCI_SHEETS.accessLog.name}» protetta: la modificano solo il proprietario e l’account della segreteria.`,
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
