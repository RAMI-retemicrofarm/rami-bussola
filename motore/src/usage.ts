// La chiusura del mese dell'uso (O5), dal trigger di ogni notte: il primo del mese conta le chiavi del mese prima che
// la vetrina ha scritto in KV, una per persona e area, e le copia nella scheda «Uso»; poi cancella le chiavi e il
// sale di quel mese, così le impronte di due mesi non si possono più legare. Prepara anche il sale del mese dopo. Le
// altre notti non fa niente. Tutto entra come parametro, come nel giro (cycle.ts).
import {
  parseUsageKey,
  SALT_PREFIX,
  saltKey,
  saltMonth,
  USAGE_PREFIX,
  USAGE_TTL_SECONDS,
  usageArea,
  type CalendarDate,
  type Month,
  type UsageArea,
} from '@bussola/condiviso'
import { readOptionalTable, readPeople, readTable, rowValues, SHEETS, text, type Workbook } from './content.ts'
import { HEALTH, type HealthRow } from './cycle.ts'
import type { KvStore } from './kv.ts'
import type { PublishState } from './publish.ts'

export type UsageDeps = {
  kv: KvStore
  /** Il KV di destinazione, come per la pubblicazione. */
  scope: string
  workbook: Workbook
  state: PublishState
  today: CalendarDate
  /** Un sale nuovo, casuale. */
  randomSalt: () => string
}

export type UsageReport = { health: HealthRow; lines: string[] }

const nextMonth = (month: Month): Month => {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7)
}

export function closeUsageMonth(deps: UsageDeps): UsageReport {
  const month = deps.today.slice(0, 7)
  const done = `uso:${deps.scope}:mese`
  const piece = HEALTH.usage
  if (deps.state.get(done) === month)
    return { health: { piece, status: 'a posto', note: `Il mese ${month} è aperto.` }, lines: [] }

  const warnings: string[] = []
  const table = readOptionalTable(deps.workbook, SHEETS.usage, warnings)
  if (!table) return { health: { piece, status: 'da guardare', note: warnings.join(' ') }, lines: warnings }
  try {
    const keys = deps.kv.list(USAGE_PREFIX)
    const salts = deps.kv.list(SALT_PREFIX)
    const counts = new Map<Month, Map<UsageArea, number>>()
    const count = (closed: Month) => counts.get(closed) ?? counts.set(closed, new Map()).get(closed) ?? new Map()
    const old: string[] = []
    for (const key of keys) {
      const parsed = parseUsageKey(key)
      if (!parsed || parsed.month >= month) continue
      const areas = count(parsed.month)
      areas.set(parsed.area, (areas.get(parsed.area) ?? 0) + 1)
      old.push(key)
    }
    // Un mese col sale ma senza chiavi è un mese in cui nessuno del Coordinamento è entrato: si scrive lo zero.
    for (const salt of salts) {
      const closed = saltMonth(salt)
      if (!closed || closed >= month) continue
      count(closed)
      old.push(salt)
    }

    // «su quante»: le Persone della Riservata che entrano nel conteggio del Coordinamento, oggi.
    const people = readPeople(readTable(deps.workbook, SHEETS.people), [])
    const eligible = people.filter((person) => usageArea(person, 'riservata') === 'coordinamento').length
    const written = new Set(table.rows.map((row) => `${text(row.get('mese'))} ${text(row.get('area'))}`))
    const lines: string[] = []
    for (const closed of [...counts.keys()].sort()) {
      const areas = count(closed)
      const rows: [UsageArea, number, number | ''][] = [['coordinamento', areas.get('coordinamento') ?? 0, eligible]]
      // I soci contano dall'entrata dei soci: finché non c'è, la loro riga non si scrive.
      if (areas.get('soci')) rows.push(['soci', areas.get('soci') ?? 0, ''])
      for (const [area, people, of] of rows) {
        if (written.has(`${closed} ${area}`)) continue
        deps.workbook.appendRow(
          SHEETS.usage.name,
          rowValues(table, { mese: closed, area, 'persone distinte': people, 'su quante': of }),
        )
        lines.push(`${closed}, ${area}: ${people}${of === '' ? '' : ` su ${of}`}.`)
      }
    }
    // Prima si scrive «Uso», poi si cancella: se la cancellazione si ferma, la notte dopo non scrive doppioni.
    if (old.length) deps.kv.delete(old)
    const next = nextMonth(month)
    if (!salts.includes(saltKey(next)))
      deps.kv.put(saltKey(next), deps.randomSalt(), { expirationTtl: USAGE_TTL_SECONDS })
    deps.state.set(done, month)
    return {
      health: {
        piece,
        status: 'a posto',
        note: lines.length ? `Mese chiuso. ${lines.join(' ')}` : `Il mese ${month} è aperto.`,
        updated: lines.length > 0,
      },
      lines,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      health: { piece, status: 'da guardare', note: `Il mese non è chiuso: ${message}. Riprovo la notte dopo.` },
      lines: [message],
    }
  }
}
