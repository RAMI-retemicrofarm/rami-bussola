import { describe, expect, it } from 'vitest'
import { QUESTIONS } from './home.tsx'
import { at, daysAgo, EMAILS, MEET, requestPage, reservedFixture, siteFixture, visibleText } from './testing.ts'
import { formatDay, formatMeeting } from './ui.tsx'

/** Una sezione della Home, dal suo titolo al titolo dopo. */
const section = (html: string, title: string) => {
  const start = html.indexOf(`>${title}</h2>`)
  if (start < 0) return ''
  const end = html.indexOf('<h2', start + 1)
  return html.slice(start, end < 0 ? undefined : end)
}

const today = () => daysAgo(0)

describe('la Home', () => {
  it('ha le quattro domande, ognuna con un link alla risposta', async () => {
    const { html } = await requestPage('/', EMAILS.board)
    const questions = section(html, 'Le quattro domande')
    expect(QUESTIONS).toHaveLength(4)
    for (const { question, href } of QUESTIONS) {
      expect(questions).toContain(question)
      expect(questions).toContain(`href="${href}"`)
    }
  })

  it('«Il primo giorno» a un tocco', async () => {
    const { html } = await requestPage('/', EMAILS.board)
    expect(html).toMatch(/<a class="btn sec" href="\/primo-giorno">Il primo giorno/)
  })

  describe('il prossimo incontro', () => {
    it('è quello visibile ai soci, con «Entra su Meet»', async () => {
      const { html } = await requestPage('/', EMAILS.board)
      const meeting = section(html, 'Prossimo incontro')
      expect(meeting).toContain(formatMeeting(at(7, '18:30'), today()))
      expect(meeting).toContain('GdL Orti e Suoli')
      expect(meeting).toContain(`href="${MEET.orti}"`)
      expect(meeting).toContain('Entra su Meet')
      // Quello del Coordinamento e quello del solo gruppo non ci sono.
      expect(html).not.toContain(MEET.coordination)
      expect(html).not.toContain(MEET.ortiInternal)
    })

    it('un incontro del Coordinamento aperto ai soci si chiama Coordinamento, non «GdL Coordinamento»', async () => {
      const site = siteFixture()
      const meetings = [{ groupId: 'Coordinamento', startsAt: at(1, '21:00'), meetUrl: MEET.coordination }]
      const { html } = await requestPage('/', EMAILS.board, { site: { ...site, meetings } })
      const meeting = section(html, 'Prossimo incontro')
      expect(meeting).toContain('<p class="small">Coordinamento</p>')
      expect(meeting).not.toContain('GdL Coordinamento')
    })

    it('senza incontri lo dice', async () => {
      const { html } = await requestPage('/', EMAILS.board, { site: { ...siteFixture(), meetings: [] } })
      expect(section(html, 'Prossimo incontro')).toContain('Nessun incontro aperto ai soci nei prossimi 60 giorni.')
    })

    it('il rappresentante vede quello del suo GdL, anche se non è visibile ai soci, e i suoi tasti', async () => {
      const { html } = await requestPage('/', EMAILS.rep)
      const mine = section(html, 'Il mio gruppo: GdL Orti e Suoli')
      expect(mine).toContain(formatMeeting(at(3, '18:30'), today()))
      expect(mine).toContain(`href="${MEET.ortiInternal}"`)
      expect(mine).toContain('Solo per chi partecipa al gruppo: i soci non lo vedono.')
      expect(mine).toContain('href="/cantieri?filtro=mio">Aggiorna il tuo gruppo')
      const group = reservedFixture().groups.find((candidate) => candidate.id === 'GDL-orti')
      expect(mine).toContain(`href="${group?.newMeetingUrl?.replace(/&/g, '&amp;')}">Aggiungi un incontro`)
      expect(html).not.toContain('>Prossimo incontro</h2>')
    })

    it('chi non è rappresentante non ha i tasti del rappresentante', async () => {
      const { html } = await requestPage('/', EMAILS.board)
      expect(html).not.toContain('Aggiorna il tuo gruppo')
      expect(html).not.toContain('Aggiungi un incontro')
    })
  })

  describe('«Cosa succede»', () => {
    it('mostra i tre cantieri aggiornati più di recente, dal più recente', async () => {
      const { html } = await requestPage('/', EMAILS.board)
      const titles = [...section(html, 'Cosa succede').matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1])
      // Aggiornati oggi, 20, 29 e 30 giorni fa: il quarto resta fuori.
      expect(titles).toEqual(['Rete dei mercati contadini', 'Scambio di semi autunnale', 'Orto condiviso'])
      expect(section(html, 'Cosa succede')).toContain('aggiornato oggi')
    })

    it('con un cantiere aggiornato oggi, quello entra e il più vecchio dei tre esce', async () => {
      const snapshot = reservedFixture()
      const projects = snapshot.projects.map((project) =>
        project.id === 'CAN-0004' ? { ...project, updatedOn: daysAgo(1) } : project,
      )
      const { html } = await requestPage('/', EMAILS.board, { reserved: { ...snapshot, projects } })
      const titles = [...section(html, 'Cosa succede').matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1])
      expect(titles).toEqual(['Rete dei mercati contadini', 'Sito dei prodotti locali', 'Scambio di semi autunnale'])
    })
  })

  describe('«Prossime scadenze»', () => {
    it('quelle visibili ai soci nei prossimi 90 giorni; una a 91 giorni no, e le passate no', async () => {
      const { html } = await requestPage('/', EMAILS.board)
      const deadlines = section(html, 'Prossime scadenze')
      expect(visibleText(deadlines)).toContain('Convocazione dell’Assemblea')
      expect(deadlines).toContain(`Evento · ${formatDay(daysAgo(-90), today())}`)
      expect(deadlines).toContain('Raduno di primavera')
      expect(deadlines).not.toContain('Assemblea dei soci di primavera')
      expect(deadlines).not.toContain('Iscrizioni al corso chiuse')
    })

    it('le scadenze solo della Riservata non ci sono', async () => {
      const { html } = await requestPage('/', EMAILS.board)
      expect(section(html, 'Prossime scadenze')).not.toContain('Quota annuale')
    })
  })

  describe('i link', () => {
    it('quelli che la persona può aprire, e il link a tutti', async () => {
      const board = section((await requestPage('/', EMAILS.board)).html, 'I tuoi link')
      expect(board).toContain('Calendario degli incontri')
      expect(board).toContain('Verbali del Coordinamento')
      expect(board).not.toContain('Cartella dei semenzai')
      expect(board).toContain('href="/link"')
      const rep = section((await requestPage('/', EMAILS.rep)).html, 'I tuoi link')
      expect(rep).toContain('Cartella dei semenzai')
    })
  })

  it('ha la ricerca, un modulo GET verso /cerca', async () => {
    const { html } = await requestPage('/', EMAILS.board)
    expect(html).toMatch(/<form class="cerca" action="\/cerca" method="get" role="search">/)
    expect(html).toContain('<label for="q">')
  })

  it('senza l’istantanea del sito lo dice a parole, e il resto si vede', async () => {
    const { res, html } = await requestPage('/', EMAILS.board, { site: null })
    expect(res.status).toBe(200)
    expect(html).toContain('Le scadenze non sono ancora arrivate dal Foglio.')
    expect(html).toContain('Rete dei mercati contadini')
  })
})
