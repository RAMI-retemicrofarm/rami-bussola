import { RESERVED_KEY } from '@bussola/condiviso'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import app from './index.tsx'
import { accessJwt, AUD, EMAILS, reservedFixture, TEAM, testEnv, useAccessKeys } from './testing.ts'

beforeAll(useAccessKeys)
afterAll(() => {
  vi.unstubAllGlobals()
})

const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const now = () => Math.floor(Date.now() / 1000)

const requestReserved = (jwt?: string, environment = testEnv({ [RESERVED_KEY]: reservedFixture() })) =>
  app.request(
    'https://rami-bussola.pages.dev/riservata',
    { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} },
    environment,
  )

async function expectRefused(res: Response) {
  expect(res.status).toBe(403)
  const body = await res.text()
  for (const data of ['Scambio di semi', 'Orti e Suoli', 'docs.google.com', 'Fermo da'])
    expect(body).not.toContain(data)
}

describe('su pages.dev la Function rifiuta il JWT di Access, e non dà nessun dato, se', () => {
  it('manca', async () => {
    await expectRefused(await requestReserved())
  })

  it('è scaduto', async () => {
    await expectRefused(await requestReserved(await accessJwt({ exp: now() - 60 })))
  })

  it('non ha la scadenza', async () => {
    await expectRefused(await requestReserved(await accessJwt({ exp: undefined })))
  })

  it('aud è sbagliato', async () => {
    await expectRefused(await requestReserved(await accessJwt({ aud: ['altra-applicazione'] })))
  })

  it('iss è sbagliato', async () => {
    await expectRefused(await requestReserved(await accessJwt({ iss: 'https://altro.cloudflareaccess.com' })))
  })

  it('la firma è alterata', async () => {
    const [header, , signature] = (await accessJwt()).split('.')
    const payload = base64url({ iss: `https://${TEAM}`, aud: [AUD], email: EMAILS.rep, exp: now() + 600 })
    await expectRefused(await requestReserved(`${header}.${payload}.${signature}`))
  })

  it('alg è none', async () => {
    const header = base64url({ alg: 'none', typ: 'JWT', kid: 'prova' })
    const payload = base64url({ iss: `https://${TEAM}`, aud: [AUD], email: EMAILS.board, exp: now() + 600 })
    await expectRefused(await requestReserved(`${header}.${payload}.`))
  })

  it('l’AUD non è configurato', async () => {
    await expectRefused(await requestReserved(await accessJwt(), testEnv({ [RESERVED_KEY]: reservedFixture() }, '')))
  })
})

describe('con un JWT valido', () => {
  it('apre la Riservata', async () => {
    const res = await requestReserved(await accessJwt())
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Scambio di semi autunnale')
  })
})

describe('la mail di prova delle E2E', () => {
  it('su pages.dev non conta: senza JWT si rifiuta', async () => {
    const res = await app.request(
      'https://rami-bussola.pages.dev/cantieri',
      { headers: { 'X-Bussola-Prova-Mail': EMAILS.rep } },
      testEnv({ [RESERVED_KEY]: reservedFixture() }),
    )
    await expectRefused(res)
  })

  it('su pages.dev, con un JWT valido, chi entra è quello del JWT', async () => {
    const res = await app.request(
      'https://rami-bussola.pages.dev/cantieri',
      { headers: { 'Cf-Access-Jwt-Assertion': await accessJwt(), 'X-Bussola-Prova-Mail': EMAILS.rep } },
      testEnv({ [RESERVED_KEY]: reservedFixture() }),
    )
    expect(await res.text()).not.toContain('Aggiorna il tuo gruppo')
  })
})
