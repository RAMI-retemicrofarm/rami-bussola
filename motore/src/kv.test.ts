import { describe, expect, it } from 'vitest'
import { cloudflareKv, type HttpFetch } from './kv.ts'

const config = { accountId: 'acc123', namespaceId: 'ns456', apiToken: 'token-segreto' }

function fakeFetch(code: number, body = '{}') {
  const calls: { url: string; params: Parameters<HttpFetch>[1] }[] = []
  const fetch: HttpFetch = (url, params) => {
    calls.push({ url, params })
    return { getResponseCode: () => code, getContentText: () => body }
  }
  return { fetch, calls }
}

describe('cloudflareKv', () => {
  it('scrive la chiave con una PUT all’API di Cloudflare, col token nell’intestazione', () => {
    const { fetch, calls } = fakeFetch(200)
    cloudflareKv(config, fetch).put('v1/ciao.json', '{"a":1}')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc123/storage/kv/namespaces/ns456/values/v1%2Fciao.json',
    )
    expect(calls[0]?.params).toMatchObject({
      method: 'put',
      payload: '{"a":1}',
      headers: { Authorization: 'Bearer token-segreto' },
      muteHttpExceptions: true,
    })
  })

  it('se Cloudflare non risponde 200 si ferma, e l’errore non contiene il token', () => {
    const { fetch } = fakeFetch(403, '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}')
    const put = () => cloudflareKv(config, fetch).put('v1/ciao.json', '{}')
    expect(put).toThrow(/403/)
    expect(put).toThrow(/v1\/ciao\.json/)
    expect(put).not.toThrow(/token-segreto/)
  })
})
