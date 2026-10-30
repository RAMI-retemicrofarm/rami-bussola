// In locale fa ciò che il motore fa su Cloudflare: scrive nel KV di `wrangler pages dev` i valori coi dati inventati di
// demo-kv.ts (npm run seed:local -w motore). Con --remote li scrive nel KV vero `BUSSOLA`, che leggono l'anteprima e
// il sito definitivo, per la prova in cinque della Riservata coi dati inventati (npm run seed:anteprima -w motore): è
// una deroga decisa dal titolare il 25/10/2026, e a prova finita le quattro chiavi si cancellano se il motore non le
// ha già sostituite; le date dei dati si contano dal giorno del seed, che si rilancia il giorno prima della prova. Lì
// le persone inventate lasciano il posto a quelle del file indicato da BUSSOLA_PERSONE, che sta fuori da ogni repo:
// una lista JSON con le colonne di «Persone della Riservata».
//
//   [
//     { "mail": "direttivo@example.org", "ruoli": "Direttivo", "numero socio": 12 },
//     { "mail": "orti@example.org", "ruoli": "rappresentante", "GdL": "GDL-orti", "numero socio": 34 },
//     { "mail": "segreteria@example.org", "ruoli": "segreteria" },
//     { "mail": "cura@example.org", "ruoli": "cura della Bussola, Direttivo" }
//   ]
//
// I ruoli sono le parole del Foglio (Direttivo, rappresentante, segreteria, cura della Bussola); chi è rappresentante,
// anche esterno, ha uno dei GdL inventati: GDL-orti, GDL-semi, GDL-formazione, GDL-comunicazione. I numeri socio 12 e
// 34 servono: gli impegni inventati li citano come chi verifica e chi propone.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSeedPeople, seedValues } from './demo-kv.ts'

/** Se la cartella del file la segue git: questo progetto, la radice della Bottega o un altro repo. */
function insideGit(path: string): boolean {
  try {
    const answer = execFileSync('git', ['-C', dirname(resolve(path)), 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return answer.trim() === 'true'
  } catch {
    return false
  }
}

const remote = process.argv.includes('--remote')
const peopleFile = process.env.BUSSOLA_PERSONE
if (remote && !peopleFile)
  throw new Error('Nel KV vero vanno le persone della prova: BUSSOLA_PERSONE=<il file, fuori dal repo>.')
// Il file sta fuori da ogni repo, perché le mail non finiscano in un commit.
if (peopleFile && insideGit(peopleFile))
  throw new Error('Il file delle persone sta in una cartella seguita da git: va tenuto fuori, per esempio in $HOME.')
const values = seedValues(new Date(), peopleFile ? readSeedPeople(readFileSync(peopleFile, 'utf8')) : undefined)

// I valori passano da un file: l'istantanea è troppo lunga per una riga di comando comoda.
const folder = mkdtempSync(join(tmpdir(), 'bussola-kv-'))
try {
  for (const [key, value] of values) {
    const file = join(folder, 'valore.json')
    writeFileSync(file, value)
    const where = remote ? '--remote' : '--local'
    execFileSync('npx', ['wrangler', 'kv', 'key', 'put', key, '--path', file, '--binding', 'BUSSOLA', where], {
      cwd: fileURLToPath(new URL('../../sito/', import.meta.url)),
      stdio: 'inherit',
    })
  }
} finally {
  rmSync(folder, { recursive: true, force: true })
}
