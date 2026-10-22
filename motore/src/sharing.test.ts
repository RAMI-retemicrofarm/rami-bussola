import { describe, expect, it } from 'vitest'
import { DEMO_EMAILS, demoSheets } from './demo.ts'
import { SOCI_SHEETS } from './members.ts'
import { memoryState, memoryWorkbook } from './memory.ts'
import {
  readSharingReport,
  runSharingCheck,
  SHARING_PLACES,
  sharingFindings,
  type SharedItem,
  type SharingCheckDeps,
} from './sharing.ts'

const item = (change: Partial<SharedItem> = {}): SharedItem => ({
  where: SHARING_PLACES.sociSheet,
  editors: [],
  viewers: [],
  access: 'PRIVATE',
  permission: 'NONE',
  ...change,
})

describe('sharingFindings', () => {
  const allowed = new Set(['segreteria@example.org', 'cura@example.org'])

  it('chi è nell’elenco non si segnala, senza badare a maiuscole e spazi', () => {
    expect(
      sharingFindings(item({ editors: ['Segreteria@Example.org '], viewers: ['cura@example.org'] }), allowed),
    ).toEqual([])
  })

  it('una mail fuori dall’elenco si segnala, con modifica o lettura', () => {
    expect(
      sharingFindings(
        item({ editors: ['segreteria@example.org', 'curioso@example.org'], viewers: ['altro@x.org'] }),
        allowed,
      ),
    ).toEqual([
      { where: 'il Foglio soci', account: 'curioso@example.org', access: 'modifica' },
      { where: 'il Foglio soci', account: 'altro@x.org', access: 'lettura' },
    ])
  })

  it('la condivisione per link o per dominio si segnala sempre', () => {
    expect(sharingFindings(item({ access: 'ANYONE_WITH_LINK', permission: 'VIEW' }), allowed)).toEqual([
      { where: 'il Foglio soci', account: 'chiunque abbia il link', access: 'lettura' },
    ])
    expect(sharingFindings(item({ access: 'ANYONE', permission: 'EDIT' }), allowed)).toEqual([
      { where: 'il Foglio soci', account: 'chiunque abbia il link', access: 'modifica' },
    ])
    expect(sharingFindings(item({ access: 'DOMAIN_WITH_LINK', permission: 'COMMENT' }), allowed)).toEqual([
      { where: 'il Foglio soci', account: 'chi è nel dominio', access: 'lettura' },
    ])
    expect(sharingFindings(item({ access: 'DOMAIN', permission: 'EDIT' }), allowed)).toEqual([
      { where: 'il Foglio soci', account: 'chi è nel dominio', access: 'modifica' },
    ])
  })
})

describe('runSharingCheck', () => {
  const soci = () =>
    memoryWorkbook({
      [SOCI_SHEETS.access.name]: [
        [...SOCI_SHEETS.access.columns],
        ['Rossana Ferri', 'Rossana@example.org', 'segretario', 'sì', 'sì', 'no'],
        ['Ugo Bassi', 'ugo@example.org', 'tesoriere', 'no', 'sì', 'sì'],
      ],
      [SOCI_SHEETS.settings.name]: [
        [...SOCI_SHEETS.settings.columns],
        ['legge il Foglio soci', DEMO_EMAILS.keeper, 'chi cura la Bussola'],
      ],
    })
  const everyone = [
    'segreteria@example.org',
    'rossana@example.org',
    DEMO_EMAILS.keeper,
    DEMO_EMAILS.board,
    'ugo@example.org',
  ]
  const deps = (change: Partial<SharingCheckDeps> = {}): SharingCheckDeps => ({
    soci: soci(),
    content: () => memoryWorkbook(demoSheets(new Date('2026-11-05T09:00:00Z'))),
    owner: 'segreteria@example.org',
    sociSheet: item({ editors: everyone }),
    bussolaFolder: item({ where: SHARING_PLACES.bussolaFolder, viewers: everyone }),
    libroFolder: item({ where: SHARING_PLACES.libroFolder, viewers: everyone }),
    state: memoryState(),
    today: '2026-11-05',
    ...change,
  })

  it('Foglio soci e cartella «Bussola»: il proprietario, chi entra in «Accessi» e le voci fisse; «Libro soci» anche il Direttivo', () => {
    const report = runSharingCheck(deps())
    expect(report.findings).toEqual([
      { where: 'il Foglio soci', account: DEMO_EMAILS.board, access: 'modifica' },
      // Ugo ha «entra» no: non è nell'elenco.
      { where: 'il Foglio soci', account: 'ugo@example.org', access: 'modifica' },
      { where: 'la cartella «Bussola»', account: DEMO_EMAILS.board, access: 'lettura' },
      { where: 'la cartella «Bussola»', account: 'ugo@example.org', access: 'lettura' },
      { where: 'la cartella «Libro soci»', account: 'ugo@example.org', access: 'lettura' },
    ])
  })

  it('salva il risultato con la data, e la vista lo rilegge', () => {
    const state = memoryState()
    expect(readSharingReport(state)).toEqual({ checkedOn: '', findings: [] })
    const report = runSharingCheck(deps({ state }))
    expect(readSharingReport(state)).toEqual({ checkedOn: '2026-11-05', findings: report.findings })
  })

  it('senza la cartella «Libro soci» la salta, e non apre il Foglio contenuti', () => {
    const report = runSharingCheck(
      deps({
        libroFolder: null,
        content: () => {
          throw new Error('non doveva aprirlo')
        },
      }),
    )
    expect(report.findings.map((finding) => finding.where)).not.toContain('la cartella «Libro soci»')
  })
})
