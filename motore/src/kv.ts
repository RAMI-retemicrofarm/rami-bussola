// KV visto dal motore: l'API REST di Cloudflare, chiamata con UrlFetchApp. Il token tocca solo il KV della Bussola, in
// lettura e scrittura, e sta nelle proprietà dello script, mai nel codice.

export type KvStore = {
  put(key: string, value: string): void
}

export type CloudflareKvConfig = {
  accountId: string
  namespaceId: string
  apiToken: string
}

export type HttpResponse = { getResponseCode(): number; getContentText(): string }
/** Le opzioni di UrlFetchApp che servono qui, senza i tipi di Google: chi importa il motore nelle E2E non li ha. */
export type HttpRequest = {
  method: 'put'
  contentType: string
  payload: string
  headers: Record<string, string>
  muteHttpExceptions: boolean
}
export type HttpFetch = (url: string, params: HttpRequest) => HttpResponse

export function cloudflareKv(config: CloudflareKvConfig, fetch: HttpFetch): KvStore {
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}`
  return {
    put(key, value) {
      const response = fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'put',
        contentType: 'text/plain; charset=utf-8',
        payload: value,
        headers: { Authorization: `Bearer ${config.apiToken}` },
        muteHttpExceptions: true,
      })
      const code = response.getResponseCode()
      if (code !== 200)
        throw new Error(`KV ha risposto ${code} scrivendo ${key}: ${response.getContentText().slice(0, 300)}`)
    },
  }
}
