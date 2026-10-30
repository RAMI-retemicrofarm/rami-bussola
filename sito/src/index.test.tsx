import { describe, expect, it } from 'vitest'
import { EMAILS, requestPage, reservedFixture, visibleText } from './testing.ts'

// Le pagine di T7, dietro Access come il resto di pages.dev. I rifiuti del JWT di Access stanno in access.test.ts, le
// intestazioni in security.test.ts, le pagine una per una nei loro test.
const PAGES = ['/', '/cantieri', '/gruppi', '/gruppi/GDL-orti', '/link', '/primo-giorno', '/cerca?q=orti', '/riservata']

/** Una mail, o nove cifre di fila con al più due spazi, punti o trattini fra l'una e l'altra: un telefono. */
const EMAIL = /[^\s@<>"'=/]+@[^\s@<>"']+\.[a-z]{2,}/i
const PHONE = /\d(?:[\s.\-/()]{0,2}\d){8,}/

describe('le pagine', () => {
  it.each(PAGES)('%s si apre, ed è tutta nell’HTML: niente JavaScript', async (path) => {
    const { res, html } = await requestPage(path, EMAILS.board)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(html).not.toMatch(/<script/i)
  })

  it.each(PAGES)('%s non mostra mail né telefoni', async (path) => {
    for (const email of [EMAILS.board, EMAILS.rep]) {
      const { html } = await requestPage(path, email)
      // Il testo che si legge: i disegni delle icone hanno cifre, e i link le hanno negli id.
      const text = visibleText(html)
      expect(text).not.toMatch(EMAIL)
      expect(text).not.toMatch(PHONE)
      expect(html).not.toMatch(/href="(?:mailto|tel):/)
    }
  })

  it('chi non sta in «Persone della Riservata» trova il rifiuto anche sulle pagine nuove', async () => {
    for (const path of ['/', '/gruppi', '/link', '/primo-giorno', '/cerca?q=orti']) {
      const { res, html } = await requestPage(path, EMAILS.outsider)
      expect(res.status).toBe(403)
      expect(html).not.toContain('Orti e Suoli')
    }
  })
})

describe('la barra', () => {
  /** Le voci della barra, coi loro indirizzi. */
  const bar = (html: string) =>
    [...(html.match(/<nav class="barra"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/href="([^"]+)"/g)].map((m) => m[1])

  it('ha Home, Cantieri, Gruppi e, per chi ha un ruolo, Riservata', async () => {
    expect(bar((await requestPage('/', EMAILS.board)).html)).toEqual(['/', '/cantieri', '/gruppi', '/riservata'])
  })

  it('ogni voce porta a una pagina che esiste', async () => {
    for (const href of bar((await requestPage('/', EMAILS.rep)).html))
      expect([href, (await requestPage(href ?? '', EMAILS.rep)).res.status]).toEqual([href, 200])
  })

  it('«Riservata» la vede solo chi ha un ruolo: chi non ne ha non entra, e non ha la barra', async () => {
    const snapshot = reservedFixture()
    const people = snapshot.people.map((person) => ({ ...person, roles: [] }))
    const { res, html } = await requestPage('/', EMAILS.board, { reserved: { ...snapshot, people } })
    expect(res.status).toBe(403)
    expect(bar(html)).toEqual([])
  })

  it('segna la voce della pagina, anche sulla pagina di un gruppo', async () => {
    expect((await requestPage('/', EMAILS.board)).html).toMatch(/<a[^>]*href="\/"[^>]*aria-current="page"/)
    expect((await requestPage('/gruppi/GDL-orti', EMAILS.board)).html).toMatch(
      /<a[^>]*href="\/gruppi"[^>]*aria-current="page"/,
    )
  })
})
