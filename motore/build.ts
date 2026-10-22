// Unisce i due progetti Apps Script con esbuild: clasp 3 non traduce più il TypeScript. Apps Script non ha moduli, e
// ciò che il runtime chiama da fuori (doGet, doPost, trigger, funzioni lanciate dall'editor) deve essere una
// dichiarazione in cima al file: le esportazioni dell'entrata diventano funzioni globali nel `footer`.
import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const PROJECTS = ['motore', 'porta'] as const
export type Project = (typeof PROJECTS)[number]

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export async function bundle(project: Project): Promise<{ code: string; globals: string[] }> {
  const entry = here(`src/${project}.ts`)
  // Un primo giro in ESM, senza scrivere niente, solo per leggere i nomi esportati.
  const probe = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    outdir: 'out',
  })
  const globals = Object.values(probe.metafile.outputs).flatMap((output) => output.exports)
  const footer = globals.map((name) => `function ${name}() {\n  return Bussola.${name}.apply(this, arguments)\n}`)
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: 'Bussola',
    target: 'es2020',
    legalComments: 'none',
    footer: { js: footer.join('\n') },
    write: false,
    outfile: 'Code.js',
  })
  const code = result.outputFiles[0]?.text
  if (!code) throw new Error(`esbuild non ha prodotto niente per ${project}`)
  return { code, globals }
}

if (import.meta.main) {
  for (const project of PROJECTS) {
    const { code, globals } = await bundle(project)
    const out = here(`dist/${project}/`)
    await mkdir(out, { recursive: true })
    await writeFile(`${out}Code.js`, code)
    await copyFile(here(`progetti/${project}/appsscript.json`), `${out}appsscript.json`)
    console.log(`${project}: dist/${project}/Code.js, con ${globals.join(', ')}`)
  }
}
