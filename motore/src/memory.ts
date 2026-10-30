// Il Foglio, il Modulo, KV e le proprietà dello script in memoria: per i test, che girano in Node, e per scrivere il
// KV locale delle E2E con lo stesso giro del motore. Non entra nel file unito per Apps Script.
import type { Workbook } from './content.ts'
import {
  parsePrefilledUrl,
  type CommitmentAnswer,
  type FormResponse,
  type FormSpec,
  type Prefilled,
  type UpdateAnswer,
} from './form.ts'
import type { CommitmentFormSource, FormSource } from './cycle.ts'
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

export type MemoryKv = KvStore & {
  values: Map<string, string>
  writes: string[]
  /** Le scadenze date con `expirationTtl`, in secondi. */
  ttls: Map<string, number>
  down: boolean
}

/** `down` fa come Cloudflare che non risponde: la scrittura si ferma con un errore. */
export function memoryKv(): MemoryKv {
  const fail = (what: string) => {
    if (kv.down) throw new Error(`KV ha risposto 503 ${what}: Service Unavailable`)
  }
  const kv: MemoryKv = {
    values: new Map(),
    writes: [],
    ttls: new Map(),
    down: false,
    put(key, value, options) {
      fail(`scrivendo ${key}`)
      kv.values.set(key, value)
      kv.writes.push(key)
      if (options?.expirationTtl) kv.ttls.set(key, options.expirationTtl)
    },
    list(prefix) {
      fail(`elencando ${prefix}`)
      return [...kv.values.keys()].filter((key) => key.startsWith(prefix)).sort()
    },
    delete(keys) {
      fail(`cancellando ${keys.length} chiavi`)
      for (const key of keys) kv.values.delete(key)
    },
  }
  return kv
}

export function memoryState(): PublishState & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return { values, get: (name) => values.get(name) ?? null, set: (name, value) => void values.set(name, value) }
}

export function memoryForm<A = UpdateAnswer, P extends Prefilled = Prefilled>(
  responses: FormResponse<A>[],
  prefillUrl: string,
  spec?: FormSpec<string, P>,
): FormSource<A, P> {
  return {
    responsesSince: (since) => responses.filter((response) => !since || response.submittedAt >= since),
    prefill: () => parsePrefilledUrl(prefillUrl, spec),
  }
}

/** Il Modulo «Proponi un impegno» in memoria: `choices` è l'elenco delle righe, `writes` quante volte è cambiato. */
export function memoryCommitmentForm(
  responses: FormResponse<CommitmentAnswer>[],
  url: string,
): CommitmentFormSource & { choices: string[]; writes: number } {
  const form = {
    choices: [] as string[],
    writes: 0,
    responsesSince: (since: Date | null) => responses.filter((response) => !since || response.submittedAt >= since),
    setRowChoices(labels: string[]) {
      if (labels.join('\n') === form.choices.join('\n')) return
      form.choices = [...labels]
      form.writes++
    },
    url: () => url,
  }
  return form
}
