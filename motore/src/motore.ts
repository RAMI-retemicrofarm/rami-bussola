// Il motore, sull'account segreteria@ (ADR 0001 e 0002). Ogni esportazione diventa una funzione globale di Apps
// Script (build.ts), e chiunque apra la pagina della segreteria può chiamarla con `google.script.run`, come
// segreteria@: tutte, tranne doGet e le office*, passano prima dalla guardia di callers.ts.
import { HELLO_KEY } from '@bussola/condiviso'
import { editorOnly, triggerOrEditor, type Callers } from './callers.ts'
import * as checks from './checks.ts'
import {
  migrationRun,
  officeDeps,
  recordAccessEdit,
  runOfficeSharingCheck,
  runPublication,
  setup,
  setupSociSheet,
} from './google.ts'
import { buildHello } from './hello.ts'
import { cloudflareKv } from './kv.ts'
import { cancelPayment, changePaymentYear, openOffice, previewPayment, recordPayment } from './office.ts'
import { officePageHtml } from './office-page.ts'
import type {
  CancelInput,
  ChangeResult,
  ChangeYearInput,
  OfficeOpenResult,
  PaymentInput,
  PreviewResult,
  RecordResult,
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

/** Prepara Foglio contenuti, Modulo e trigger. Si lancia dall'editor; si può rilanciare. */
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

/** Dal trigger installabile onEdit del Foglio soci, creato da `setupSoci` con l'account segreteria@. */
export function onAccessEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  triggerOrEditor(callers, e)
  recordAccessEdit(e)
}

/** Dal trigger di ogni giorno: le condivisioni fuori dall'elenco vanno in «Oggi» del segretario. */
export function checkOfficeSharing(e?: GoogleAppsScript.Events.TimeDriven): void {
  triggerOrEditor(callers, e)
  console.log(JSON.stringify(runOfficeSharingCheck()))
}

/** Prepara Foglio soci, «Registro di Accessi» e i due trigger. Si lancia dall'editor con segreteria@; si può rilanciare. */
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
