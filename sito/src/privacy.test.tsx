import { RESERVED_KEY } from '@bussola/condiviso'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import app from './index.tsx'
import { PRIVACY_CONFIRMED, PrivacyPage } from './privacy.tsx'
import { accessJwt, EMAILS, reservedFixture, testEnv, useAccessKeys } from './testing.ts'

beforeAll(useAccessKeys)
afterAll(() => {
  vi.unstubAllGlobals()
})

const MEMBERS = 'https://bussola.retemicrofarm.it'
const SOON = 'La Bussola dei soci apre a gennaio.'
const DRAFT = 'Bozza: il testo aspetta la conferma del segretario.'

/** Un KV che conta le letture: sul dominio dei soci non se ne fa nessuna. */
function watchedEnv() {
  const env = testEnv({ [RESERVED_KEY]: reservedFixture() })
  const get = vi.spyOn(env.BUSSOLA, 'get')
  return { env, get }
}

const request = (url: string, headers: Record<string, string> = {}) => {
  const { env, get } = watchedEnv()
  return { res: app.request(url, { headers }, env), get }
}

describe('il dominio dei soci, senza Access', () => {
  it('/privacy risponde a chiunque, senza JWT, con l’informativa', async () => {
    const { res, get } = request(`${MEMBERS}/privacy`)
    const response = await res
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<h1>Come usiamo i dati</h1>')
    expect(html).toContain('Rete Agroecologica Microfarm Italia APS')
    expect(html).toContain('segreteria@retemicrofarm.it')
    expect(get).not.toHaveBeenCalled()
  })

  it('/privacy non ha la barra e ha una cache pubblica breve', async () => {
    const response = await request(`${MEMBERS}/privacy`).res
    expect(await response.text()).not.toContain('class="barra"')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  for (const path of ['/', '/cantieri', '/qualunque', '/privacy/altro'])
    it(`${path} dice che la Bussola dei soci apre a gennaio, senza leggere il KV`, async () => {
      const { res, get } = request(`${MEMBERS}${path}`)
      const response = await res
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(`<h1>${SOON}</h1>`)
      expect(html).toContain('href="/privacy"')
      expect(html).toContain('href="https://rami-bussola.pages.dev"')
      expect(html).not.toContain('class="barra"')
      for (const data of ['Scambio di semi', 'Orti e Suoli', 'Il motore dice']) expect(html).not.toContain(data)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(get).not.toHaveBeenCalled()
    })

  // Le frasi che il segretario conferma: se cambiano, il testo torna da lui.
  it('l’informativa nomina Cloudflare Access, i registri di 24 ore e il legittimo interesse per chi non è socio', async () => {
    const html = await (await request(`${MEMBERS}/privacy`).res).text()
    expect(html).toContain('<b>Cloudflare Access</b> fa entrare nella Riservata')
    expect(html).toContain('Conserva per 24 ore i registri degli accessi')
    expect(html).toContain('<li>I registri degli accessi di Cloudflare Access: 24 ore.</li>')
    expect(html).toMatch(/rappresentanti dei GdL che non sono soci, il legittimo interesse di RAMI/)
  })

  it('l’informativa nomina ciò che chiede il Modulo dei cantieri: il nome di chi aggiorna e ciò che scrive', async () => {
    const html = (await (await request(`${MEMBERS}/privacy`).res).text()).replace(/\s+/g, ' ')
    expect(html).toContain('Se aggiorni un cantiere dal Modulo')
    expect(html).toMatch(/il tuo nome e ciò che scrivi, per sapere chi ha fatto l’aggiornamento/)
  })

  it('l’informativa nomina ciò che chiede il Modulo degli impegni a chi propone, e che nome e mail restano su Google', async () => {
    const html = (await (await request(`${MEMBERS}/privacy`).res).text()).replace(/\s+/g, ' ')
    expect(html).toContain(
      'Se proponi un impegno dal Modulo, il tuo nome e cognome, il numero di socio e la mail, per sapere chi l’ha ' +
        'proposto e scriverti sulla scheda.',
    )
    expect(html).toContain(
      'Nome, cognome e mail restano nel Foglio della Bussola, su Google, che leggono la segreteria e chi cura la ' +
        'Bussola: non vanno sul sito né nella Riservata.',
    )
    expect(html).toContain(
      '<li>Nome, cognome e mail di chi propone un impegno: 2 anni dalla proposta, come le risposte ai Moduli.</li>',
    )
  })

  it('l’informativa dice che i Fogli sono dell’account della Bussola, non della segreteria (ADR 0004)', async () => {
    const html = (await (await request(`${MEMBERS}/privacy`).res).text()).replace(/\s+/g, ' ')
    expect(html).toContain('l’anagrafica, le quote e i pagamenti, in un Foglio dell’account della Bussola.')
    expect(html).not.toContain('account della segreteria')
  })

  it('l’informativa dice che Google e Cloudflare sono società degli Stati Uniti, e su cosa si basa il trasferimento', async () => {
    const html = (await (await request(`${MEMBERS}/privacy`).res).text()).replace(/\s+/g, ' ')
    expect(html).toContain('Google e Cloudflare sono società degli Stati Uniti')
    expect(html).toContain('Data Privacy Framework')
    expect(html).toContain('clausole contrattuali standard')
  })

  it('l’informativa ha in cima i salti a diritti, tempi e titolare, verso titoli che esistono', async () => {
    const html = await (await request(`${MEMBERS}/privacy`).res).text()
    const nav = html.match(/<nav [^>]*aria-label="Su questa pagina"[^>]*>(.*?)<\/nav>/)?.[1] ?? ''
    expect(nav).not.toBe('')
    expect(html.indexOf('<nav')).toBeLessThan(html.indexOf('<h2'))
    const jumps = [
      ['diritti', 'I tuoi diritti'],
      ['tempi', 'Quanto li teniamo'],
      ['chi', 'Chi tratta i tuoi dati'],
    ]
    const links = [...nav.matchAll(/<a [^>]*href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])
    expect(links).toEqual(jumps)
    for (const [id, title] of jumps) expect(html).toContain(`<h2 id="${id}">${title}</h2>`)
  })

  it('la pagina di gennaio ha il tasto per la Riservata, l’indirizzo intero e il contatto', async () => {
    const html = await (await request(`${MEMBERS}/`).res).text()
    expect(html).toMatch(/<a class="btn sec" href="https:\/\/rami-bussola\.pages\.dev">Vai alla Riservata<\/a>/)
    expect(html).toContain('<p class="small">L’indirizzo è rami-bussola.pages.dev.</p>')
    expect(html).not.toContain('Per la Riservata entra da')
    // Il contatto è un tasto come nell'informativa: un link nella riga, alto 44 px, con lo zoom non andava a capo.
    expect(html).toMatch(
      /<p class="dopo-tasto">Domande\?<\/p><a class="btn sec" href="mailto:segreteria@retemicrofarm\.it">Scrivi a segreteria@retemicrofarm\.it<\/a>/,
    )
  })

  it('/riservata rimanda ancora a pages.dev', async () => {
    const response = await request(`${MEMBERS}/riservata`).res
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://rami-bussola.pages.dev/riservata')
  })

  it('robots.txt chiude ancora tutto', async () => {
    const response = await request(`${MEMBERS}/robots.txt`).res
    expect(await response.text()).toBe('User-agent: *\nDisallow: /\n')
  })
})

describe('su pages.dev /privacy sta dietro Access, come il resto', () => {
  it('senza JWT dà 403', async () => {
    const response = await request('https://rami-bussola.pages.dev/privacy').res
    expect(response.status).toBe(403)
  })

  it('con un JWT valido mostra l’informativa', async () => {
    const response = await request('https://rami-bussola.pages.dev/privacy', {
      'Cf-Access-Jwt-Assertion': await accessJwt(),
    }).res
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<h1>Come usiamo i dati</h1>')
  })
})

describe('l’host di prova delle E2E', () => {
  const asMembers = { 'X-Bussola-Prova-Host': 'bussola.retemicrofarm.it' }

  it('da localhost fa trattare la richiesta come del dominio dei soci', async () => {
    const { res, get } = request('http://localhost:8788/cantieri', asMembers)
    expect(await (await res).text()).toContain(SOON)
    expect(get).not.toHaveBeenCalled()
  })

  it('da localhost vale anche per il rimando della Riservata', async () => {
    const response = await request('http://localhost:8788/riservata', asMembers).res
    expect(response.status).toBe(302)
  })

  it('su pages.dev non conta: senza JWT si rifiuta', async () => {
    for (const path of ['/', '/privacy', '/cantieri']) {
      const response = await request(`https://rami-bussola.pages.dev${path}`, asMembers).res
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain(SOON)
    }
  })

  it('sul dominio dei soci non lo si può spegnere', async () => {
    const response = await request(`${MEMBERS}/cantieri`, {
      'X-Bussola-Prova-Host': 'rami-bussola.pages.dev',
      'X-Bussola-Prova-Mail': EMAILS.board,
    }).res
    expect(await response.text()).toContain(SOON)
  })

  it('senza l’intestazione, localhost resta com’era', async () => {
    const { res, get } = request('http://localhost:8788/cantieri', { 'X-Bussola-Prova-Mail': EMAILS.board })
    expect(await (await res).text()).toContain('<h1>Cantieri</h1>')
    // La spia conta davvero le letture: qui il KV si legge.
    expect(get).toHaveBeenCalled()
  })
})

describe('la bozza dell’informativa', () => {
  it('finché il segretario non conferma, la pagina lo dice in cima, prima del testo', async () => {
    const html = await (await request(`${MEMBERS}/privacy`).res).text()
    expect(PRIVACY_CONFIRMED).toBe(false)
    expect(html).toContain(DRAFT)
    expect(html.indexOf(DRAFT)).toBeLessThan(html.indexOf('<h2>'))
  })

  it('confermata, la riga sparisce e resta la data della versione', () => {
    const html = (<PrivacyPage confirmed version="2026-11-02" />).toString()
    expect(html).not.toContain(DRAFT)
    expect(html).toContain('Versione del 2 novembre 2026.')
  })
})
