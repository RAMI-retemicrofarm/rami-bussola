import { MEMBER_STATUSES, statusLabel } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { OFFICE_CALLS } from './office-api.ts'
import { OFFICE_PAGE_WORDS, officePageHtml } from './office-page.ts'

const html = officePageHtml()
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '')
const script = scripts[0] ?? ''

describe('officePageHtml', () => {
  it('è un documento intero, in italiano', () => {
    expect(html.startsWith('<!doctype html>\n<html lang="it">')).toBe(true)
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('arriva con lo scheletro, prima dei dati', () => {
    expect(html).toContain('Sto aprendo la segreteria…')
  })

  it('ha un solo script, scritto per il browser, che si legge senza errori', () => {
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(scripts).toHaveLength(1)
    // Solo la sintassi: `new Function` lo legge senza eseguirlo.
    expect(() => new Function(script)).not.toThrow()
  })

  it('non carica niente da fuori: niente link, src o indirizzi http', () => {
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<link\b|\bsrc=|@import|url\(/)
  })

  it('chiama solo le funzioni del contratto, tutte, e ogni chiamata ha il suo failure handler', () => {
    const called = new Set([...script.matchAll(/\bcall\("(\w+)"/g)].map((match) => match[1]))
    expect([...called].sort()).toEqual([...OFFICE_CALLS].sort())
    expect(script.match(/google\.script\.run/g)).toHaveLength(1)
    expect(script).toContain('.withFailureHandler(')
  })

  it('non usa alert, confirm né prompt', () => {
    expect(script).not.toMatch(/\b(alert|confirm|prompt)\(/)
  })

  it('scrive gli stati con le stesse parole delle regole delle quote', () => {
    for (const status of MEMBER_STATUSES) {
      const label = statusLabel(status, 2026).replace('2027', '')
      expect(script).toContain(`"${label}`)
    }
  })

  it('ricorda il «Chi sei?» sul dispositivo con la sua chiave, sempre dentro un try', () => {
    expect(script).toContain('"bussola.segreteria.chiSei"')
    const uses = script.match(/localStorage\./g) ?? []
    const guarded = script.match(/try \{ (return )?localStorage\./g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    expect(guarded).toHaveLength(uses.length)
  })
})

// Le parole della pagina sono funzioni pure, senza DOM: si leggono dal loro blocco e si provano una per una.
type Words = {
  accessChangeText: (change: { when: string; who: string; cells: string; before: string; after: string }) => string
  sharingWarning: (checkedOn: string, today: string) => string
  revokeAdvice: (finding: { where: string; account: string }) => string
  emptySearchText: (query: string, filterLabel: string) => string
  outcomeLine: (result: {
    payment: { memberNumber: string; validYear: number }
    memberName: string
    pending: boolean
    status: string | null
  }) => [string, string, string]
  noAccessText: (email: string) => string
}
const words = new Function(
  `"use strict"\n${OFFICE_PAGE_WORDS}\nreturn { accessChangeText, sharingWarning, revokeAdvice, emptySearchText, outcomeLine, noAccessText }`,
)() as Words

describe('le parole della pagina', () => {
  it('sono dentro lo script della pagina', () => {
    expect(script).toContain(OFFICE_PAGE_WORDS)
  })

  const change = {
    when: '26/10/2026 16:40',
    who: 'segreteria@example.org',
    cells: 'A4:F4',
    before: '',
    after: 'Ugo Bassi · condiviso@example.org',
  }

  it('un cambio di «Accessi» è una frase sola, con la riga e chi l’ha fatto', () => {
    expect(words.accessChangeText(change)).toBe(
      "26/10 alle 16:40 la riga 4 di «Accessi» è cambiata: ora «Ugo Bassi · condiviso@example.org». L'ha fatto segreteria@example.org.",
    )
  })

  it('più righe insieme: «le righe 4–5»; svuotate: «ora vuote»', () => {
    expect(words.accessChangeText({ ...change, cells: 'A4:F5', after: '' })).toBe(
      "26/10 alle 16:40 le righe 4–5 di «Accessi» sono cambiate: ora vuote. L'ha fatto segreteria@example.org.",
    )
  })

  it('una cella sola ha anche il valore di prima, e vuota si dice', () => {
    expect(words.accessChangeText({ ...change, cells: 'D5', before: 'sì', after: 'no' })).toBe(
      "26/10 alle 16:40 la riga 5 di «Accessi» è cambiata: prima «sì», ora «no». L'ha fatto segreteria@example.org.",
    )
    expect(words.accessChangeText({ ...change, cells: 'B7', before: '', after: 'x@example.org' })).toContain(
      'prima vuota, ora «x@example.org»',
    )
  })

  it('celle che non si leggono e chi non è noto restano dette come sono', () => {
    expect(words.accessChangeText({ ...change, when: 'ieri', cells: 'A:A', who: 'non noto' })).toBe(
      "ieri le celle A:A di «Accessi» sono cambiate: ora «Ugo Bassi · condiviso@example.org». Non si sa chi l'ha fatto.",
    )
  })

  it('il controllo delle condivisioni: avviso oltre due giorni, o se non ha mai girato', () => {
    expect(words.sharingWarning('2026-11-03', '2026-11-05')).toBe('')
    expect(words.sharingWarning('2026-11-02', '2026-11-05')).toBe(
      'Il controllo delle condivisioni non gira dal 02/11/2026: avvisa chi cura la Bussola.',
    )
    expect(words.sharingWarning('2026-10-30', '2026-11-02')).toContain('dal 30/10/2026')
    expect(words.sharingWarning('', '2026-11-05')).toBe(
      'Il controllo delle condivisioni non ha ancora girato: avvisa chi cura la Bussola.',
    )
  })

  it('cosa fare di una condivisione fuori dall’elenco, col posto giusto', () => {
    expect(words.revokeAdvice({ where: 'il Foglio soci', account: 'qualcuno@example.org' })).toBe(
      "Togli l'accesso dal Foglio soci, oppure aggiungi la persona in «Accessi».",
    )
    expect(words.revokeAdvice({ where: 'la cartella «Bussola»', account: 'q@example.org' })).toContain(
      'dalla cartella «Bussola»,',
    )
    expect(words.revokeAdvice({ where: 'il Foglio soci', account: 'chiunque abbia il link' })).toBe(
      "Togli l'accesso dal Foglio soci.",
    )
  })

  it('la ricerca vuota dice il filtro acceso, e come uscirne', () => {
    expect(words.emptySearchText('Zanetti', '')).toBe('Nessun socio con «Zanetti».')
    expect(words.emptySearchText(' neri ', 'Da rinnovare')).toBe(
      'Nessun socio con «neri» fra quelli «Da rinnovare». Tocca «Tutti» per cercare fra tutti.',
    )
    expect(words.emptySearchText('', 'In regola')).toBe('Nessun socio in questo elenco.')
  })

  it('la conferma dice «in regola» solo se il socio lo è', () => {
    const recorded = (status: string | null, validYear = 2026) => ({
      payment: { memberNumber: '5', validYear },
      memberName: 'Anna Esposito',
      pending: false,
      status,
    })
    expect(words.outcomeLine(recorded('inGoodStanding'))).toEqual([
      'Registrato. Anna Esposito è in regola per il 2026.',
      'ok',
      'dot pieno',
    ])
    expect(words.outcomeLine(recorded('paidAhead', 2027))[0]).toBe('Registrato. Anna Esposito è in regola per il 2027.')
    expect(words.outcomeLine(recorded('left'))[0]).toBe(
      'Registrato per il 2026. Lo stato di Anna Esposito è «Receduto».',
    )
    expect(words.outcomeLine(recorded('dueForRenewal'))[0]).toBe(
      'Registrato per il 2026. Lo stato di Anna Esposito è «Da rinnovare».',
    )
    expect(words.outcomeLine(recorded('notInGoodStanding'))[0]).toBe(
      'Registrato per il 2026. Lo stato di Anna Esposito è «Non in regola».',
    )
    expect(words.outcomeLine({ ...recorded('left'), pending: true })[0]).toBe(
      'Registrato. Il pagamento è in attesa del tesoriere: conta quando lo conferma.',
    )
    expect(words.outcomeLine({ ...recorded(null), payment: { memberNumber: '', validYear: 2026 } })[0]).toBe(
      'Registrato senza socio: va in «Da abbinare».',
    )
  })

  it('«Non hai accesso» dice l’account in uso, se c’è', () => {
    expect(words.noAccessText('curioso@example.org')).toBe(
      "Stai usando l'account curioso@example.org. Entra con quello della segreteria: se il telefono ne ha più di uno, esci da Google e rientra con quello giusto. Se è già quello giusto, scrivi a chi cura la Bussola.",
    )
    expect(words.noAccessText('')).toBe(
      "Entra con l'account della segreteria: se il telefono ne ha più di uno, esci da Google e rientra con quello giusto. Se è già quello giusto, scrivi a chi cura la Bussola.",
    )
  })
})
