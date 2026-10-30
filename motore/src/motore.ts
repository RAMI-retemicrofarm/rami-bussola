// Il motore, sull'account della Bussola (ADR 0001, 0002 e 0004). Ogni esportazione diventa una funzione globale di
// Apps Script (build.ts), e chiunque apra la pagina della segreteria può chiamarla con `google.script.run`, come
// l'account della Bussola: tutte, tranne doGet e le office*, passano prima dalla guardia di callers.ts.
import { HELLO_KEY } from '@bussola/condiviso'
import { editorOnly, triggerOrEditor, type Callers } from './callers.ts'
import * as checks from './checks.ts'
import {
  migrationRun,
  officeDeps,
  publishAfterReferentsEdit,
  recordAccessEdit,
  runCalendarSync,
  runMonthlyTasks,
  runOfficeSharingCheck,
  runPublication,
  runUsageClose,
  scheduleAfterContentEdit,
  setup,
  setupSociSheet,
} from './google.ts'
import { buildHello } from './hello.ts'
import { cloudflareKv } from './kv.ts'
import {
  assignMember,
  cancelPayment,
  cashReceived,
  changePaymentYear,
  confirmPayment,
  deadlineDone,
  ignoreBankLine,
  importBank,
  openOffice,
  previewPayment,
  recordPayment,
  saveRegister,
} from './office.ts'
import { officePageHtml } from './office-page.ts'
import type {
  AssignMemberInput,
  CancelInput,
  ChangeResult,
  ChangeYearInput,
  DeadlineDoneInput,
  IgnoreBankLineInput,
  ImportBankInput,
  ImportResult,
  OfficeOpenResult,
  PaymentActionInput,
  PaymentInput,
  PreviewResult,
  RecordResult,
  SaveRegisterInput,
} from './office-api.ts'
import { requiredProperty } from './properties.ts'

/** Chi lancia, chi fa girare lo script e i trigger del progetto, chiesti a Google solo quando servono. */
const callers: Callers = {
  activeEmail: () => Session.getActiveUser().getEmail(),
  effectiveEmail: () => Session.getEffectiveUser().getEmail(),
  triggerIds: () => ScriptApp.getProjectTriggers().map((trigger) => trigger.getUniqueId()),
}

/** Le prove dell'imbastitura (checks.ts), dall'editor. */
export function checkSharing(): void {
  editorOnly(callers)
  checks.checkSharing()
}

export function checkBounces(): void {
  editorOnly(callers)
  checks.checkBounces()
}

/** Scrive su KV il valore che legge la pagina «Ciao». Si lancia dall'editor. */
export function publishHello(): void {
  editorOnly(callers)
  const kv = cloudflareKv(
    {
      accountId: requiredProperty('CF_ACCOUNT_ID'),
      namespaceId: requiredProperty('CF_KV_NAMESPACE_ID'),
      apiToken: requiredProperty('CF_API_TOKEN'),
    },
    (url, params) => UrlFetchApp.fetch(url, params),
  )
  kv.put(HELLO_KEY, JSON.stringify(buildHello(new Date())))
}

/** La pubblicazione, dal trigger dei 10 minuti. */
export function everyTenMinutes(e?: GoogleAppsScript.Events.TimeDriven): void {
  triggerOrEditor(callers, e)
  runPublication()
}

/** La pubblicazione, dal trigger delle risposte del Modulo «Aggiorna il cantiere». */
export function onUpdateFormSubmit(e?: GoogleAppsScript.Events.FormsOnFormSubmit): void {
  triggerOrEditor(callers, e)
  runPublication()
}

/** La pubblicazione, dal trigger delle risposte del Modulo «Prossimo incontro». */
export function onMeetingFormSubmit(e?: GoogleAppsScript.Events.FormsOnFormSubmit): void {
  triggerOrEditor(callers, e)
  runPublication()
}

/** La pubblicazione, dal trigger delle risposte del Modulo «Proponi un impegno»: la scheda va in «Da approvare». */
export function onCommitmentFormSubmit(e?: GoogleAppsScript.Events.FormsOnFormSubmit): void {
  triggerOrEditor(callers, e)
  runPublication()
}

/** Dal trigger installabile onEdit del Foglio contenuti: un cambio in «Referenti» si pubblica entro un minuto. */
export function onContentEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  triggerOrEditor(callers, e)
  scheduleAfterContentEdit(e)
}

/** Dal trigger di una volta sola che prepara onContentEdit. */
export function publishReferents(e?: GoogleAppsScript.Events.TimeDriven): void {
  triggerOrEditor(callers, e)
  publishAfterReferentsEdit()
}

/**
 * Dal trigger di ogni notte: il primo del mese chiude l'uso del mese prima (usage.ts) e fa l'automatismo mensile
 * della segreteria, la scadenza «misura» e il libro soci nel Drive (monthly.ts); ogni notte allinea il calendario
 * «Scadenze RAMI» (calendar.ts).
 */
export function closeUsage(e?: GoogleAppsScript.Events.TimeDriven): void {
  triggerOrEditor(callers, e)
  for (const line of runUsageClose()) console.log(line)
  for (const line of runMonthlyTasks()) console.log(line)
  for (const line of runCalendarSync()) console.log(line)
}

/** Prepara Foglio contenuti, Moduli e trigger. Si lancia dall'editor; si può rilanciare. */
export function setupBussola(): void {
  editorOnly(callers)
  for (const line of setup()) console.log(line)
}

/** La pagina della segreteria, distribuita «Esegui come: io» e «Chi ha accesso: chiunque nel dominio». */
export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(officePageHtml())
    .setTitle('Segreteria · Bussola')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
}

// Le chiamate della pagina della segreteria, con `google.script.run` (office-api.ts). Ognuna rifà il controllo di
// «Accessi» con l'account di Google; un problema del Foglio torna come `{ kind: 'error', message }`.

/** All'apertura: `person` è il nome scelto nel «Chi sei?», o vuoto. */
export function officeOpen(person?: string): OfficeOpenResult {
  return openOffice(officeDeps(), person ?? '')
}

export function officePreview(input: PaymentInput): PreviewResult {
  return previewPayment(officeDeps(), input)
}

export function officeRecordPayment(input: PaymentInput): RecordResult {
  return recordPayment(officeDeps(), input)
}

export function officeCancelPayment(input: CancelInput): ChangeResult {
  return cancelPayment(officeDeps(), input)
}

export function officeChangeYear(input: ChangeYearInput): ChangeResult {
  return changePaymentYear(officeDeps(), input)
}

/** «Conferma» su un pagamento in attesa del tesoriere. */
export function officeConfirmPayment(input: PaymentActionInput): ChangeResult {
  return confirmPayment(officeDeps(), input)
}

/** «Ricevuti» sui contanti da consegnare. */
export function officeCashReceived(input: PaymentActionInput): ChangeResult {
  return cashReceived(officeDeps(), input)
}

/** «Abbina a un socio» un pagamento registrato senza socio. */
export function officeAssignMember(input: AssignMemberInput): ChangeResult {
  return assignMember(officeDeps(), input)
}

/** Le righe della banca, incollate o dal CSV, in «Estratto conto», con l'abbinamento. */
export function officeImportBank(input: ImportBankInput): ImportResult {
  return importBank(officeDeps(), input)
}

/** «Non è una quota» su una riga della banca in «Da abbinare», col motivo. */
export function officeIgnoreBankLine(input: IgnoreBankLineInput): ChangeResult {
  return ignoreBankLine(officeDeps(), input)
}

/** «Fatta» su una scadenza del Foglio contenuti; per la misura del mese anche il numero. */
export function officeDeadlineDone(input: DeadlineDoneInput): ChangeResult {
  return deadlineDone(officeDeps(), input)
}

/** «Salva nel Drive»: il libro soci di oggi. */
export function officeSaveRegister(input: SaveRegisterInput): ChangeResult {
  return saveRegister(officeDeps(), input)
}

/** Dal trigger installabile onEdit del Foglio soci, creato da `setupSoci` con l'account della Bussola. */
export function onAccessEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  triggerOrEditor(callers, e)
  recordAccessEdit(e)
}

/** Dal trigger di ogni giorno: le condivisioni fuori dall'elenco vanno in «Oggi» del segretario. */
export function checkOfficeSharing(e?: GoogleAppsScript.Events.TimeDriven): void {
  triggerOrEditor(callers, e)
  console.log(JSON.stringify(runOfficeSharingCheck()))
}

/** Prepara Foglio soci, «Registro di Accessi» e i due trigger. Dall'editor con l'account della Bussola; si rilancia. */
export function setupSoci(): void {
  editorOnly(callers)
  for (const line of setupSociSheet()) console.log(line)
}

/** La migrazione del libro soci, prima in prova: scrive solo il resoconto nella scheda «Migrazione». */
export function previewMemberRegister(): void {
  editorOnly(callers)
  for (const line of migrationRun(false)) console.log(line)
}

/** La migrazione vera: scrive «Soci» e «Pagamenti», solo se sono vuoti, e il resoconto. */
export function migrateMemberRegister(): void {
  editorOnly(callers)
  for (const line of migrationRun(true)) console.log(line)
}
