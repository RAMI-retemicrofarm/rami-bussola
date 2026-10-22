import { RESERVED_KEY } from '@bussola/condiviso'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import app from './index.tsx'
import { accessJwt, reservedFixture, testEnv, useAccessKeys } from './testing.ts'

beforeAll(useAccessKeys)
afterAll(() => {
  vi.unstubAllGlobals()
})

const env = () => testEnv({ [RESERVED_KEY]: reservedFixture() })
const onPagesDev = async (path: string, jwt?: string) =>
  app.request(
    `https://rami-bussola.pages.dev${path}`,
    { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} },
    env(),
  )

// «Una pagina qualsiasi»: le pagine, una che non c'è, un rifiuto di Access, robots.txt e il dominio dei soci.
const anyPage = async () => {
  const jwt = await accessJwt()
  return [
    ['la Riservata', await onPagesDev('/riservata', jwt)],
    ['i Cantieri', await onPagesDev('/cantieri', jwt)],
    ['una pagina che non c’è', await onPagesDev('/non-esiste', jwt)],
    ['un rifiuto di Access', await onPagesDev('/riservata')],
    ['robots.txt', await onPagesDev('/robots.txt')],
    ['il rimando dal dominio dei soci', await app.request('https://bussola.retemicrofarm.it/riservata', {}, env())],
    ['l’informativa del dominio dei soci', await app.request('https://bussola.retemicrofarm.it/privacy', {}, env())],
    ['la pagina «apre a gennaio»', await app.request('https://bussola.retemicrofarm.it/', {}, env())],
  ] as const
}

describe('le intestazioni di sicurezza, su ogni risposta della vetrina', () => {
  it("Content-Security-Policy contiene default-src 'self' e frame-ancestors 'none'", async () => {
    for (const [, res] of await anyPage()) {
      const csp = res.headers.get('Content-Security-Policy') ?? ''
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("frame-ancestors 'none'")
    }
  })

  it('Referrer-Policy vale no-referrer', async () => {
    for (const [, res] of await anyPage()) expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('X-Robots-Tag vale noindex', async () => {
    for (const [, res] of await anyPage()) expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('Strict-Transport-Security vale max-age=31536000', async () => {
    for (const [, res] of await anyPage()) expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000')
  })

  it('Permissions-Policy vale camera=(), microphone=(), geolocation=()', async () => {
    for (const [, res] of await anyPage())
      expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
  })
})

describe('robots.txt', () => {
  it('chiude tutto a tutti, anche senza Access', async () => {
    const res = await onPagesDev('/robots.txt')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n')
  })
})

describe('niente sul telefono per le pagine con i dati della Riservata', () => {
  it('la Riservata risponde con Cache-Control: no-store', async () => {
    const res = await onPagesDev('/riservata', await accessJwt())
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('anche i Cantieri, che hanno i link coi codici dei gruppi', async () => {
    const res = await onPagesDev('/cantieri', await accessJwt())
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('il dominio dei soci', () => {
  it('/riservata rimanda a pages.dev', async () => {
    const res = await app.request('https://bussola.retemicrofarm.it/riservata', {}, env())
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://rami-bussola.pages.dev/riservata')
  })

  it('il rimando non porta dati della Riservata', async () => {
    const res = await app.request('https://bussola.retemicrofarm.it/riservata', {}, env())
    expect(await res.text()).not.toContain('Scambio di semi')
  })
})
