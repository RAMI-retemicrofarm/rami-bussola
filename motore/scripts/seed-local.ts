// In locale fa ciò che il motore fa su Cloudflare: scrive nel KV di `wrangler pages dev` il valore della pagina
// «Ciao» e l'istantanea riservata, fatta dal giro vero del motore sul Foglio con dati inventati (src/demo.ts).
import { HELLO_KEY, romeDate } from '@bussola/condiviso'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCycle } from '../src/cycle.ts'
import { DEMO_PREFILL_URL, demoSheets } from '../src/demo.ts'
import { buildHello } from '../src/hello.ts'
import { memoryForm, memoryKv, memoryState, memoryWorkbook } from '../src/memory.ts'

const now = new Date()
const kv = memoryKv()
const report = runCycle({
  workbook: memoryWorkbook(demoSheets(now)),
  form: memoryForm([], DEMO_PREFILL_URL),
  kv,
  state: memoryState(),
  scope: 'locale',
  sha256Hex: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
  toCalendarDate: romeDate,
  randomKey: () => crypto.randomUUID().replace(/-/g, ''),
  now,
})
if (report.violations.length) throw new Error(`L'istantanea di prova esce dalla lista ammessa: ${report.violations}`)
kv.values.set(HELLO_KEY, JSON.stringify(buildHello(now)))

// I valori passano da un file: l'istantanea è troppo lunga per una riga di comando comoda.
const folder = mkdtempSync(join(tmpdir(), 'bussola-kv-'))
try {
  for (const [key, value] of kv.values) {
    const file = join(folder, 'valore.json')
    writeFileSync(file, value)
    execFileSync('npx', ['wrangler', 'kv', 'key', 'put', key, '--path', file, '--binding', 'BUSSOLA', '--local'], {
      cwd: fileURLToPath(new URL('../../sito/', import.meta.url)),
      stdio: 'inherit',
    })
  }
} finally {
  rmSync(folder, { recursive: true, force: true })
}
