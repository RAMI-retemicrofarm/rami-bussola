import type { SiteLink } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { search } from './search.ts'
import {
  EMAILS,
  requestPage,
  reservedFixture,
  reservedWithOffice,
  SEMI_FOLDER,
  siteFixture,
  visibleText,
} from './testing.ts'

const data = () => ({ groups: siteFixture().groups, projects: reservedFixture().projects, links: siteFixture().links })

describe('search', () => {
  it('trova un gruppo, un cantiere e un link con una parola del titolo', () => {
    expect(search('Biodiversità', data()).groups.map((group) => group.id)).toEqual(['GDL-semi'])
    expect(search('mercati', data()).projects.map((project) => project.id)).toEqual(['CAN-0001'])
    expect(search('semenzai', data()).links.map((link) => link.title)).toEqual(['Cartella dei semenzai'])
  })

  it('senza accenti e senza maiuscole', () => {
    expect(search('BIODIVERSITA', data()).groups).toHaveLength(1)
  })

  it('ogni parola deve esserci; quelle nel titolo vengono prima', () => {
    expect(search('orto condiviso', data()).projects.map((project) => project.id)).toEqual(['CAN-0003'])
    expect(search('orti', data(), (id) => (id === 'GDL-orti' ? 'Orti e Suoli' : id)).projects[0]?.groupId).toBe(
      'GDL-orti',
    )
  })

  it('una ricerca vuota non trova niente', () => {
    expect(search('  ', data())).toEqual({ groups: [], projects: [], links: [] })
  })
})

describe('/cerca', () => {
  it('trova sul server un gruppo, un cantiere e un link, ognuno col suo indirizzo', async () => {
    const group = await requestPage('/cerca?q=Semi', EMAILS.board)
    expect(group.html).toContain('href="/gruppi/GDL-semi">Semi e Biodiversità')
    const project = await requestPage('/cerca?q=mercati', EMAILS.board)
    expect(project.html).toContain('href="/cantieri#CAN-0001">Rete dei mercati contadini')
    const link = await requestPage('/cerca?q=verbali', EMAILS.board)
    expect(link.html).toContain('href="https://drive.google.com/drive/folders/coordinamento">Verbali del Coordinamento')
  })

  it('dei link che la persona non può aprire dà il titolo con chi lo apre, non l’indirizzo', async () => {
    const site = { ...siteFixture(), links: [...siteFixture().links, SEMI_FOLDER] }
    const rep = await requestPage('/cerca?q=cartella', EMAILS.rep, { site })
    expect(rep.html).toContain('href="https://drive.google.com/drive/folders/orti">Cartella dei semenzai')
    expect(rep.html).not.toContain('folders/semi')
    expect(visibleText(rep.html)).toContain(
      'Cartella dei semi Lo aprono solo i partecipanti del GdL Semi e Biodiversità.',
    )
    const office = await requestPage('/cerca?q=verbali', EMAILS.office, { site, reserved: await reservedWithOffice() })
    expect(office.html).not.toContain('drive.google.com')
    expect(visibleText(office.html)).toContain('Verbali del Coordinamento Lo apre solo il Coordinamento.')
  })

  it('per un link di un GdL che il Foglio dei gruppi non ha, dice chi lo apre con la stessa frase di /link', async () => {
    const orphan: SiteLink = {
      title: 'Cartella orfana',
      url: 'https://drive.google.com/x',
      audience: 'group',
      groupId: 'GDL-nope',
    }
    const site = { ...siteFixture(), links: [...siteFixture().links, orphan] }
    const sentence = 'Cartella orfana Lo aprono solo i partecipanti del GdL GDL-nope.'
    expect(visibleText((await requestPage('/cerca?q=orfana', EMAILS.rep, { site })).html)).toContain(sentence)
    expect(visibleText((await requestPage('/link', EMAILS.rep, { site })).html)).toContain(sentence)
  })

  it('dice quanti risultati ha trovato', async () => {
    const { html } = await requestPage('/cerca?q=mercati', EMAILS.board)
    expect(visibleText(html)).toContain('1 risultato per «mercati».')
  })

  it('senza risultati lo dice, e propone i Gruppi', async () => {
    const { html } = await requestPage(`/cerca?q=${encodeURIComponent('zucchine')}`, EMAILS.board)
    expect(visibleText(html)).toContain(
      "Nessun risultato per «zucchine». Prova con un'altra parola, o guarda i Gruppi.",
    )
    expect(html).toContain('href="/gruppi">Guarda i Gruppi')
  })

  it('la parola cercata torna nel campo, senza diventare HTML', async () => {
    const { html } = await requestPage(`/cerca?q=${encodeURIComponent('<b>orti</b>')}`, EMAILS.board)
    expect(html).not.toContain('<b>orti</b>')
    expect(html).toContain('value="&lt;b&gt;orti&lt;/b&gt;"')
  })

  it('senza parola mostra solo il campo', async () => {
    const { html } = await requestPage('/cerca', EMAILS.board)
    expect(html).toContain('role="search"')
    expect(html).not.toContain('Nessun risultato')
  })
})
