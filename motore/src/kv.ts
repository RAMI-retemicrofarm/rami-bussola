// KV visto dal motore: l'API REST di Cloudflare, chiamata con UrlFetchApp. Il token tocca solo il KV della Bussola, in
// lettura e scrittura, e sta nelle proprietà dello script, mai nel codice. Da T7 il motore elenca e cancella anche le
// chiavi dell'uso, il primo del mese (usage.ts).

export type KvStore = {
  /** `expirationTtl`: dopo quanti secondi la chiave sparisce da sola. */
  put(key: string, value: string, options?: { expirationTtl?: number }): void
  /** I nomi delle chiavi che cominciano con `prefix`, tutte. */
  list(prefix: string): string[]
  delete(keys: readonly string[]): void
}

export type CloudflareKvConfig = {
  accountId: string
  namespaceId: string
  apiToken: string
}

export type HttpResponse = { getResponseCode(): number; getContentText(): string }
/** Le opzioni di UrlFetchApp che servono qui, senza i tipi di Google: chi importa il motore nelle E2E non li ha. */
export type HttpRequest = {
  method: 'get' | 'put' | 'post'
  contentType?: string
  payload?: string
  headers: Record<string, string>
  muteHttpExceptions: boolean
}
export type HttpFetch = (url: string, params: HttpRequest) => HttpResponse

/** L'API cancella al più 10.000 chiavi per chiamata. */
const DELETE_BATCH = 10_000

export function cloudflareKv(config: CloudflareKvConfig, fetch: HttpFetch): KvStore {
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}`
  const headers = { Authorization: `Bearer ${config.apiToken}` }
  const call = (url: string, params: Omit<HttpRequest, 'headers' | 'muteHttpExceptions'>, what: string) => {
    const response = fetch(url, { ...params, headers, muteHttpExceptions: true })
    const code = response.getResponseCode()
    if (code !== 200) throw new Error(`KV ha risposto ${code} ${what}: ${response.getContentText().slice(0, 300)}`)
    return response.getContentText()
  }
  return {
    put(key, value, options) {
      const ttl = options?.expirationTtl ? `?expiration_ttl=${options.expirationTtl}` : ''
      call(
        `${base}/values/${encodeURIComponent(key)}${ttl}`,
        { method: 'put', contentType: 'text/plain; charset=utf-8', payload: value },
        `scrivendo ${key}`,
      )
    },
    list(prefix) {
      const names: string[] = []
      let cursor = ''
      do {
        const query = `prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        const page = JSON.parse(call(`${base}/keys?${query}`, { method: 'get' }, `elencando ${prefix}`)) as {
          result?: { name?: unknown }[]
          result_info?: { cursor?: unknown }
        }
        if (!Array.isArray(page.result)) throw new Error(`KV ha risposto senza l’elenco delle chiavi di ${prefix}.`)
        for (const item of page.result) if (typeof item.name === 'string') names.push(item.name)
        cursor = typeof page.result_info?.cursor === 'string' ? page.result_info.cursor : ''
      } while (cursor)
      return names
    },
    delete(keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH)
        call(
          `${base}/bulk/delete`,
          { method: 'post', contentType: 'application/json', payload: JSON.stringify(batch) },
          `cancellando ${batch.length} chiavi`,
        )
      }
    },
  }
}
