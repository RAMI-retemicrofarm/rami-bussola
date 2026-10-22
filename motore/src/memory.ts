// Il Foglio, il Modulo, KV e le proprietà dello script in memoria: per i test, che girano in Node, e per scrivere il
// KV locale delle E2E con lo stesso giro del motore. Non entra nel file unito per Apps Script.
import type { Workbook } from './content.ts'
import { parsePrefilledUrl, type FormResponse } from './form.ts'
import type { FormSource } from './cycle.ts'
import type { KvStore } from './kv.ts'
import type { PublishState } from './publish.ts'

export type MemoryWorkbook = Workbook & { sheets: Record<string, unknown[][]> }

export function memoryWorkbook(sheets: Record<string, unknown[][]>): MemoryWorkbook {
  const sheet = (name: string) => {
    const rows = sheets[name]
    if (!rows) throw new Error(`Nel Foglio finto manca la scheda ${name}`)
    return rows
  }
  return {
    sheets,
    values: (name) => sheets[name]?.map((row) => [...row]) ?? null,
    setCell(name, row, column, value) {
      const rows = sheet(name)
      const cells = rows[row] ?? (rows[row] = [])
      while (cells.length < column) cells.push('')
      cells[column] = value
    },
    appendRow(name, values) {
      sheet(name).push([...values])
    },
  }
}

export type MemoryKv = KvStore & { values: Map<string, string>; writes: string[]; down: boolean }

/** `down` fa come Cloudflare che non risponde: la scrittura si ferma con un errore. */
export function memoryKv(): MemoryKv {
  const kv: MemoryKv = {
    values: new Map(),
    writes: [],
    down: false,
    put(key, value) {
      if (kv.down) throw new Error(`KV ha risposto 503 scrivendo ${key}: Service Unavailable`)
      kv.values.set(key, value)
      kv.writes.push(key)
    },
  }
  return kv
}

export function memoryState(): PublishState & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return { values, get: (name) => values.get(name) ?? null, set: (name, value) => void values.set(name, value) }
}

export function memoryForm(responses: FormResponse[], prefillUrl: string): FormSource {
  return {
    responsesSince: (since) => responses.filter((response) => !since || response.submittedAt >= since),
    prefill: () => parsePrefilledUrl(prefillUrl),
  }
}
