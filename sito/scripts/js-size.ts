// Tutto il JavaScript che arriva al browser sta sotto i 10 KB compressi con gzip. Si misura sul build, dopo `vite
// build`: ogni .js e .mjs di dist, tranne `_worker.js`, che è la Function e gira su Cloudflare. Le pagine non hanno
// script in linea (lo provano i test delle pagine), quindi questo è tutto.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const LIMIT_BYTES = 10 * 1024

export function clientScripts(dist: string): { file: string; gzip: number }[] {
  return readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => relative(dist, path) !== '_worker.js')
    .map((path) => ({ file: relative(dist, path), gzip: gzipSync(readFileSync(path), { level: 9 }).length }))
}

/** La misura, riga per riga, e il verdetto: sopra il limite c'è l'errore che ferma il build. */
export function checkClientScripts(dist: string): { lines: string[]; error: string | null } {
  const scripts = clientScripts(dist)
  const total = scripts.reduce((sum, script) => sum + script.gzip, 0)
  return {
    lines: [
      ...scripts.map(({ file, gzip }) => `${file}: ${gzip} byte con gzip`),
      `JavaScript per il browser: ${total} byte con gzip, su ${LIMIT_BYTES} ammessi.`,
    ],
    error: total > LIMIT_BYTES ? 'Troppo JavaScript: il limite è 10 KB compressi con gzip.' : null,
  }
}

if (import.meta.main) {
  const { lines, error } = checkClientScripts(fileURLToPath(new URL('../dist/', import.meta.url)))
  for (const line of lines) console.log(line)
  if (error) {
    console.error(error)
    process.exit(1)
  }
}
