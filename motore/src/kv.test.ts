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

describe('cloudflareKv, per l’uso', () => {
  it('una chiave che scade dopo 70 giorni', () => {
    const { fetch, calls } = fakeFetch(200)
    cloudflareKv(config, fetch).put('uso-sale:2026-11', 'sale', { expirationTtl: 6_048_000 })
    expect(calls[0]?.url).toMatch(/\/values\/uso-sale%3A2026-11\?expiration_ttl=6048000$/)
  })

  it('elenca le chiavi con un prefisso, pagina dopo pagina', () => {
    const pages = [
      { result: [{ name: 'uso:2026-10:coordinamento:a' }], result_info: { cursor: 'c2' } },
      { result: [{ name: 'uso:2026-10:coordinamento:b' }], result_info: { cursor: '' } },
    ]
    const urls: string[] = []
    const fetch: HttpFetch = (url) => {
      urls.push(url)
      const page = pages.shift()
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(page) }
    }
    expect(cloudflareKv(config, fetch).list('uso:')).toEqual([
      'uso:2026-10:coordinamento:a',
      'uso:2026-10:coordinamento:b',
    ])
    expect(urls[0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc123/storage/kv/namespaces/ns456/keys?prefix=uso%3A&limit=1000',
    )
    expect(urls[1]).toContain('&cursor=c2')
  })

  it('cancella le chiavi in una chiamata sola, con l’elenco dei nomi', () => {
    const { fetch, calls } = fakeFetch(200)
    cloudflareKv(config, fetch).delete(['a', 'b'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toMatch(/\/namespaces\/ns456\/bulk\/delete$/)
    expect(calls[0]?.params).toMatchObject({ method: 'post', payload: '["a","b"]' })
  })

  it('se Cloudflare non risponde 200, cancellare si ferma', () => {
    const { fetch } = fakeFetch(500, 'errore')
    expect(() => cloudflareKv(config, fetch).delete(['a'])).toThrow(/500 cancellando 1 chiavi/)
  })
})
