// I valori del KV coi dati inventati, come li scrive il motore su Cloudflare: la pagina «Ciao», l'istantanea riservata,
// quella del sito e i numeri dei soci, fatte dal giro vero del motore sui Fogli di src/demo.ts e src/demo-soci.ts. La
// stesura di prova della scheda «La cura della Bussola» passa dal Modulo «Proponi un impegno», come farà quella vera:
// nella Riservata è in «Da approvare». Per la prova in cinque sull'anteprima le persone inventate di «Persone della
// Riservata» lasciano il posto a quelle del file del titolare: delle mail, nel KV restano solo le impronte.
import { HELLO_KEY, normalizeEmail, romeDate, romeDateTime } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { SHEETS } from '../src/content.ts'
import { runCycle } from '../src/cycle.ts'
import {
  DEMO_CODES,
  DEMO_COMMITMENT_ANSWER,
  DEMO_COMMITMENT_FORM_URL,
  DEMO_MEETING_PREFILL_URL,
  DEMO_PREFILL_URL,
  demoSheets,
} from '../src/demo.ts'
import { DEMO_SOCI_NOW, demoSociSheets } from '../src/demo-soci.ts'
import { MEETING_FORM } from '../src/form.ts'
import { buildHello } from '../src/hello.ts'
import { buildMembersSnapshot, publishMembersSnapshot, readMembersSheets } from '../src/members-snapshot.ts'
import { memoryCommitmentForm, memoryForm, memoryKv, memoryState, memoryWorkbook } from '../src/memory.ts'

/** Una riga di «Persone della Riservata», con le colonne del Foglio. */
export type SeedPerson = { mail: string; ruoli: string; GdL?: string; 'numero socio'?: string | number }

const FIELDS = ['mail', 'ruoli', 'GdL', 'numero socio']
const GROUPS = Object.keys(DEMO_CODES)

/**
 * Le persone dal file del titolare, una lista JSON come in cima a seed-local.ts. Si ferma al primo errore, e nei
 * messaggi dice il numero della persona, mai la mail: l'errore può finire in un terminale condiviso o in una chat.
 */
export function readSeedPeople(text: string): SeedPerson[] {
  let list: unknown
  try {
    list = JSON.parse(text)
  } catch {
    // Il messaggio di JSON.parse riporta un pezzo del file: niente.
    throw new Error('Il file delle persone non si legge come JSON: va scritto come in cima a seed-local.ts.')
  }
  if (!Array.isArray(list) || !list.length) throw new Error('Il file delle persone è una lista con almeno una persona.')
  const seen: string[] = []
  return list.map((item: unknown, index) => {
    const which = `La persona n. ${index + 1}`
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new Error(`${which} non ha la forma giusta: { "mail": …, "ruoli": … }.`)
    const fields = item as Record<string, unknown>
    for (const name of Object.keys(fields))
      if (!FIELDS.includes(name))
        throw new Error(`${which}: «${name}» non la conosco; vanno bene mail, ruoli, GdL e numero socio.`)
    const { mail, ruoli, GdL, 'numero socio': number } = fields
    if (typeof mail !== 'string' || !mail.trim()) throw new Error(`${which}: manca la mail.`)
    if (!mail.includes('@')) throw new Error(`${which}: la mail non ha la chiocciola.`)
    if (typeof ruoli !== 'string' || !ruoli.trim()) throw new Error(`${which}: mancano i ruoli.`)
    if (/rappresentante/i.test(ruoli) && (typeof GdL !== 'string' || !GROUPS.includes(GdL.trim())))
      throw new Error(`${which} è rappresentante: le serve uno dei GdL inventati, ${GROUPS.join(', ')}.`)
    if (GdL !== undefined && typeof GdL !== 'string') throw new Error(`${which}: il GdL va scritto fra virgolette.`)
    if (number !== undefined && typeof number !== 'string' && typeof number !== 'number')
      throw new Error(`${which}: il numero socio va scritto come numero.`)
    const email = normalizeEmail(mail)
    const twin = seen.indexOf(email)
    if (twin >= 0) throw new Error(`${which} ha la stessa mail della n. ${twin + 1}.`)
    seen.push(email)
    return {
      mail,
      ruoli,
      ...(GdL === undefined ? {} : { GdL }),
      ...(number === undefined ? {} : { 'numero socio': number }),
    }
  })
}

/** Le chiavi del KV coi loro valori; con `people`, al posto delle persone inventate ci sono quelle. */
export function seedValues(now: Date, people?: readonly SeedPerson[]): Map<string, string> {
  const sheets = demoSheets(now)
  if (people) {
    const columns = SHEETS.people.columns
    // Gli impegni inventati citano per numero socio chi verifica e chi propone: quei numeri restano, su persone vere.
    const cell = (row: unknown[], name: string) => String(row[columns.indexOf(name)] ?? '').trim()
    const given = people.map((person) => String(person['numero socio'] ?? '').trim())
    for (const row of sheets[SHEETS.people.name]?.slice(1) ?? []) {
      const number = cell(row, 'numero socio')
      if (number && !given.includes(number))
        throw new Error(
          `Nel file manca il numero socio ${number} (${cell(row, 'ruoli')}), che gli impegni inventati citano: dallo a una delle persone.`,
        )
    }
    const rows = people.map((person, index) => {
      const values: Record<string, unknown> = { ...person, id: `PER-${String(index + 1).padStart(2, '0')}` }
      return columns.map((name) => values[name] ?? '')
    })
    sheets[SHEETS.people.name] = [[...columns], ...rows]
  }
  const kv = memoryKv()
  const state = memoryState()
  const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
  const report = runCycle({
    workbook: memoryWorkbook(sheets),
    soci: memoryWorkbook(demoSociSheets()),
    form: memoryForm([], DEMO_PREFILL_URL),
    meetingForm: memoryForm([], DEMO_MEETING_PREFILL_URL, MEETING_FORM),
    commitmentForm: memoryCommitmentForm(
      [{ id: 'proposta-di-prova', submittedAt: new Date(now.getTime() - 3_600_000), answer: DEMO_COMMITMENT_ANSWER }],
      DEMO_COMMITMENT_FORM_URL,
    ),
    kv,
    state,
    scope: 'locale',
    sha256Hex,
    toCalendarDate: romeDate,
    toLocalTime: romeDateTime,
    randomKey: () => crypto.randomUUID().replace(/-/g, ''),
    now,
  })
  if (report.violations.length) throw new Error(`L'istantanea di prova esce dalla lista ammessa: ${report.violations}`)
  if (report.warnings.length) throw new Error(`Il Foglio di prova ha degli avvisi: ${report.warnings}`)
  if (report.commitmentOutcomes.some((item) => !item.outcome.startsWith('applicata')))
    throw new Error(`La scheda di prova non è entrata: ${JSON.stringify(report.commitmentOutcomes)}`)
  if (report.published.some((item) => item.status === 'failed'))
    throw new Error(`Una pubblicazione di prova non è riuscita: ${JSON.stringify(report.published)}`)
  kv.values.set(HELLO_KEY, JSON.stringify(buildHello(now)))

  // I numeri dei soci al giorno del Foglio soci inventato, il 5/11/2026, come nelle prove della segreteria: così i
  // conteggi e la riga dei rinnovi (da gennaio ad aprile) non dipendono dal giorno in cui si prova.
  const soci = readMembersSheets(memoryWorkbook(demoSociSheets()), romeDate)
  const today = romeDate(DEMO_SOCI_NOW)
  const members = publishMembersSnapshot(
    { kv, state, sha256Hex, now, scope: 'locale', today },
    buildMembersSnapshot(soci.members, soci.payments, soci.settings.dues, today),
  )
  if (members.status === 'failed') throw new Error(`I numeri dei soci di prova non sono usciti: ${members.error}`)
  return kv.values
}
