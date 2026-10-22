// La pubblicazione: scrive su KV solo le istantanee cambiate, per stare molto sotto le 1.000 scritture al giorno del
// piano gratuito. Ricorda l'impronta dell'ultima versione scritta nelle proprietà dello script, per KV: se Cloudflare
// non risponde l'impronta non cambia, e il giro dopo riprova.
import type { KvStore } from './kv.ts'

export type PublishState = { get(name: string): string | null; set(name: string, value: string): void }

export type PublishResult =
  { key: string; status: 'written' | 'unchanged' } | { key: string; status: 'failed'; error: string }

export type PublishDeps = {
  kv: KvStore
  state: PublishState
  sha256Hex: (text: string) => string
  now: Date
  /** Il KV di destinazione: un KV nuovo riceve tutto. */
  scope: string
}

export function publish(entries: { key: string; content: object }[], deps: PublishDeps): PublishResult[] {
  return entries.map(({ key, content }): PublishResult => {
    const name = `pubblicato:${deps.scope}:${key}`
    const fingerprint = deps.sha256Hex(JSON.stringify(content))
    if (deps.state.get(name) === fingerprint) return { key, status: 'unchanged' }
    try {
      deps.kv.put(key, JSON.stringify({ ...content, publishedAt: deps.now.toISOString() }))
    } catch (error) {
      return { key, status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
    deps.state.set(name, fingerprint)
    return { key, status: 'written' }
  })
}
