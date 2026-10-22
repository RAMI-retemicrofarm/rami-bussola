import { describe, expect, it } from 'vitest'
import app from './index.tsx'
import { testEnv } from './testing.ts'

// I rifiuti del JWT di Access stanno in access.test.ts, le intestazioni in security.test.ts.
const HELLO = { version: 1, message: 'Ciao dal motore della Bussola', writtenAt: '2026-10-18T19:00:00.000Z' }

describe('la pagina «Ciao»', () => {
  it('in locale mostra il valore che il motore ha scritto su KV', async () => {
    const res = await app.request('http://localhost:8788/', {}, testEnv({ 'v1/ciao.json': HELLO }))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<html lang="it">')
    expect(html).toContain('«Ciao dal motore della Bussola»')
    expect(html).toContain('Scritto il 18 ottobre 2026')
  })

  it('se il motore non ha scritto niente, lo dice', async () => {
    const res = await app.request('http://localhost:8788/', {}, testEnv())
    expect(await res.text()).toContain('Il motore non ha ancora scritto niente.')
  })
})
