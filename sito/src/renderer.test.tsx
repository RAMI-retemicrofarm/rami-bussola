import { describe, expect, it } from 'vitest'
import { EMAILS, requestPage } from './testing.ts'

/** Ciò che sta fra l'apertura e la chiusura dell'header della pagina. */
const header = (html: string) => html.match(/<body>\s*<header[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? ''

describe('la cornice delle pagine', () => {
  // Chi si muove fra i landmark con lo screen reader deve incontrare l'avviso di dove si trova: fuori da ogni
  // landmark non lo trova (la regola «region» di axe).
  it.each(['/riservata', '/riservata/impegni/IMP-0001'])(
    'su %s la fascia «Solo Direttivo, Coordinamento e segreteria» sta nell’header',
    async (path) => {
      const { html } = await requestPage(path, EMAILS.board)
      expect(header(html)).toContain('Solo Direttivo, Coordinamento e segreteria')
    },
  )

  it('fuori dalla Riservata l’header ha solo il marchio', async () => {
    const { html } = await requestPage('/cantieri', EMAILS.board)
    expect(header(html)).toContain('Bussola')
    expect(html).not.toContain('Solo Direttivo, Coordinamento e segreteria')
  })
})
