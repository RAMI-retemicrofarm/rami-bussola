import { describe, expect, it } from 'vitest'
import {
  at,
  daysAgo,
  EMAILS,
  MEET,
  OFFICE_URL,
  requestPage,
  reservedFixture,
  reservedWithOffice,
  SEMI_FOLDER,
  siteFixture,
  visibleText,
} from './testing.ts'
import { formatMeeting } from './ui.tsx'

/** Una sezione della pagina, dal suo titolo al titolo dopo. */
const section = (html: string, title: string) => {
  const start = html.indexOf(`>${title}</h2>`)
  if (start < 0) return ''
  const end = html.indexOf('<h2', start + 1)
  return html.slice(start, end < 0 ? undefined : end)
}

describe('/gruppi', () => {
  it('elenca i gruppi con la missione, e ognuno porta alla sua pagina', async () => {
    const { html } = await requestPage('/gruppi', EMAILS.board)
    expect(html).toContain('<h1>Gruppi</h1>')
    for (const group of siteFixture().groups) {
      expect(html).toContain(`href="/gruppi/${group.id}"`)
      expect(html).toContain(group.mission)
    }
  })

  it('senza l’istantanea del sito lo dice a parole', async () => {
    const { html } = await requestPage('/gruppi', EMAILS.board, { site: null })
    expect(html).toContain('I gruppi non sono ancora arrivati dal Foglio.')
  })
})

describe('la pagina del gruppo', () => {
  it('ha la missione, come si partecipa, dove e quando', async () => {
    const { html } = await requestPage('/gruppi/GDL-orti', EMAILS.board)
    expect(html).toContain('<h1>Orti e Suoli</h1>')
    expect(html).toContain('Mettere in rete gli orti dei soci e imparare insieme a curare il suolo.')
    expect(section(html, 'Come si partecipa')).toContain('Vieni a un incontro online: non serve iscriversi.')
    expect(section(html, 'Dove e quando')).toContain('Online, un giovedì al mese alle 18:30.')
  })

  it('i referenti col consenso con nome e ruolo; senza, solo il ruolo', async () => {
    const { html } = await requestPage('/gruppi/GDL-orti', EMAILS.board)
    const referents = section(html, 'Chi lo segue')
    expect(referents).toContain('<li>Lia Prova, referente</li>')
    expect(referents).toContain('<li>Co-referente</li>')
  })

  it('il prossimo incontro visibile ai soci, con «Entra su Meet»', async () => {
    const { html } = await requestPage('/gruppi/GDL-orti', EMAILS.board)
    const meeting = section(html, 'Prossimo incontro')
    expect(meeting).toContain(formatMeeting(at(7, '18:30'), daysAgo(0)))
    expect(meeting).toContain(`href="${MEET.orti}"`)
    expect(html).not.toContain(MEET.ortiInternal)
  })

  it('il rappresentante del gruppo vede anche l’incontro solo per il gruppo, e i suoi tasti', async () => {
    const { html } = await requestPage('/gruppi/GDL-orti', EMAILS.rep)
    expect(section(html, 'Prossimo incontro')).toContain(`href="${MEET.ortiInternal}"`)
    expect(html).toContain('Aggiorna il tuo gruppo')
    expect(html).toContain('Aggiungi un incontro')
    // Sulla pagina di un altro gruppo, no.
    const other = (await requestPage('/gruppi/GDL-semi', EMAILS.rep)).html
    expect(other).not.toContain('Aggiungi un incontro')
  })

  it('il contatto è la chat del gruppo, se è aperta ai soci', async () => {
    const { html } = await requestPage('/gruppi/GDL-orti', EMAILS.board)
    expect(section(html, 'Come contattarlo')).toContain('href="https://chat.example.org/orti-e-suoli"')
  })

  it('altrimenti è la segreteria', async () => {
    const { html } = await requestPage('/gruppi/GDL-semi', EMAILS.board)
    const contact = section(html, 'Come contattarlo')
    expect(contact).toContain('La chat del gruppo è solo per chi partecipa.')
    expect(contact).toContain(`href="${OFFICE_URL}">Scrivi alla segreteria`)
  })

  it('senza referenti e senza incontri lo dice', async () => {
    const { html } = await requestPage('/gruppi/GDL-comunicazione', EMAILS.board)
    expect(html).toContain('Il gruppo non ha ancora un referente.')
    expect(html).toContain('Nessun incontro in calendario nei prossimi 60 giorni.')
  })

  it('un gruppo che non c’è risponde 404, a parole', async () => {
    const { res, html } = await requestPage('/gruppi/GDL-inventato', EMAILS.board)
    expect(res.status).toBe(404)
    expect(html).toContain('Gruppo non trovato')
  })

  it('il nome di chi non ha dato il consenso non c’è, perché non arriva', async () => {
    const site = siteFixture()
    const groups = site.groups.map((group) => ({
      ...group,
      referents: group.referents.map((referent) => ({ ...referent, name: null })),
    }))
    const { html } = await requestPage('/gruppi/GDL-orti', EMAILS.board, { site: { ...site, groups } })
    expect(html).not.toContain('Lia Prova')
    expect(section(html, 'Chi lo segue')).toContain('<li>Referente</li>')
  })
})

describe('/link', () => {
  it('ogni link con chi lo può aprire', async () => {
    const { html } = await requestPage('/link', EMAILS.board)
    const text = visibleText(html)
    expect(text).toContain('Calendario degli incontri Lo apre chiunque.')
    expect(text).toContain('Modulo per proporre un evento Lo aprono i soci.')
    expect(text).toContain('Cartella dei semenzai Lo aprono solo i partecipanti del GdL Orti e Suoli.')
    expect(text).toContain('Verbali del Coordinamento Lo apre solo il Coordinamento.')
  })

  it('per quelli di un GdL dice di chiedere ai referenti, e porta alla pagina del gruppo', async () => {
    const { html } = await requestPage('/link', EMAILS.board)
    expect(visibleText(html)).toContain('Per entrare, chiedi ai referenti del gruppo.')
    expect(html).toContain('href="/gruppi/GDL-orti">Chi segue Orti e Suoli')
  })

  it('per quelli del Coordinamento dice di chiedere alla segreteria', async () => {
    const { html } = await requestPage('/link', EMAILS.rep)
    expect(visibleText(html)).toContain('Per entrare, chiedi alla segreteria.')
    expect(html).toContain(`href="${OFFICE_URL}">Scrivi alla segreteria`)
  })

  it('l’indirizzo c’è solo per i link che la persona può aprire: degli altri il titolo, chi lo apre e a chi chiedere', async () => {
    const site = { ...siteFixture(), links: [...siteFixture().links, SEMI_FOLDER] }
    // Il rappresentante di Orti e Suoli: la sua cartella e, da Coordinamento, i verbali; non la cartella di Semi.
    const rep = await requestPage('/link', EMAILS.rep, { site })
    expect(rep.html).toContain('href="https://drive.google.com/drive/folders/orti">Cartella dei semenzai')
    expect(rep.html).toContain('href="https://drive.google.com/drive/folders/coordinamento">Verbali del Coordinamento')
    expect(rep.html).not.toContain('folders/semi')
    expect(visibleText(rep.html)).toContain(
      'Cartella dei semi Lo aprono solo i partecipanti del GdL Semi e Biodiversità. Per entrare, chiedi ai referenti del gruppo.',
    )
    // La segreteria non è di un GdL né del Coordinamento: nessuna cartella, nessun verbale, ma il calendario sì.
    const office = await requestPage('/link', EMAILS.office, { site, reserved: await reservedWithOffice() })
    expect(office.res.status).toBe(200)
    expect(office.html).toContain('href="https://calendar.example.org/rami">Calendario degli incontri')
    expect(office.html).not.toContain('drive.google.com')
    expect(visibleText(office.html)).toContain(
      'Verbali del Coordinamento Lo apre solo il Coordinamento. Per entrare, chiedi alla segreteria.',
    )
  })
})

describe('/primo-giorno', () => {
  it('i passi per entrare in un GdL, in ordine', async () => {
    const { html } = await requestPage('/primo-giorno', EMAILS.board)
    const titles = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(titles).toEqual(siteFixture().firstDay.map((step) => step.title))
    expect(html).toContain('href="https://calendar.example.org/rami"')
    expect(html).toContain('href="/gruppi">Guarda i Gruppi')
  })
})

describe('i tasti del rappresentante su /cantieri', () => {
  it('«Aggiungi un incontro» accanto ad «Aggiungi un cantiere», col Modulo precompilato', async () => {
    const { html } = await requestPage('/cantieri', EMAILS.rep)
    const group = reservedFixture().groups.find((candidate) => candidate.id === 'GDL-orti')
    expect(html).toContain(`href="${group?.newMeetingUrl?.replace(/&/g, '&amp;')}">Aggiungi un incontro`)
    const url = new URL(group?.newMeetingUrl ?? '')
    expect([...url.searchParams.values()]).toEqual(['pp_url', 'Orti e Suoli', 'k-orti'])
  })
})
