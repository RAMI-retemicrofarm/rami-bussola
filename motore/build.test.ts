import { normalizeEmail, romeDate, romeDateTime } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { bundle } from './build.ts'
import { CALLER_REFUSED } from './src/callers.ts'
import { SHEETS } from './src/content.ts'
import { DEMO_CODES, DEMO_COMMITMENT_ANSWER, DEMO_EMAILS, demoSheets } from './src/demo.ts'
import { DEMO_OFFICE, DEMO_SHARED_ACCOUNT, demoSociSheets } from './src/demo-soci.ts'
import { COMMITMENT_FORM, MEETING_FORM, NO_COMMITMENT_ROW, UPDATE_FORM } from './src/form.ts'
import { MEASURES } from './src/measures.ts'
import { OFFICE_SETTINGS, SOCI_SHEETS } from './src/members.ts'
import { OFFICE_CALLS, type PaymentInput } from './src/office-api.ts'
import { officePageHtml } from './src/office-page.ts'

describe('il file unito per Apps Script', () => {
  it('dichiara in cima ciò che il runtime chiama da fuori', async () => {
    const { code, globals } = await bundle('motore')
    expect([...globals].sort()).toEqual([
      'checkBounces',
      'checkOfficeSharing',
      'checkSharing',
      'closeUsage',
      'doGet',
      'everyTenMinutes',
      'migrateMemberRegister',
      'officeAssignMember',
      'officeCancelPayment',
      'officeCashReceived',
      'officeChangeYear',
      'officeConfirmPayment',
      'officeDeadlineDone',
      'officeIgnoreBankLine',
      'officeImportBank',
      'officeOpen',
      'officePreview',
      'officeRecordPayment',
      'officeSaveRegister',
      'onAccessEdit',
      'onCommitmentFormSubmit',
      'onContentEdit',
      'onMeetingFormSubmit',
      'onUpdateFormSubmit',
      'previewMemberRegister',
      'publishHello',
      'publishReferents',
      'setupBussola',
      'setupSoci',
    ])
    for (const name of globals) expect(code).toMatch(new RegExp(`^function ${name}\\(`, 'm'))
    // Le chiamate della pagina della segreteria sono tutte funzioni globali.
    for (const call of OFFICE_CALLS) expect(globals).toContain(call)
  })

  it('la porta risponde «pronta» a una POST, girando come in Apps Script', async () => {
    const { code } = await bundle('porta')
    const ContentService = {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ setMimeType: (mime: string) => ({ text, mime }) }),
    }
    const output = runInNewContext(`${code}\ndoPost({})`, { ContentService }) as { text: string; mime: string }
    expect(output.mime).toBe('application/json')
    expect(JSON.parse(output.text)).toEqual({ ok: true, porta: 'pronta' })
  })
})

// I servizi di Google finti, con le firme che usa il motore. Le date si passano alla vm col `Date` di Node, perché
// in Apps Script le date del Foglio e quelle del codice sono dello stesso mondo.
type Sheets = Record<string, unknown[][]>

/**
 * Ciò che la preparazione scrive oltre ai valori: le convalide per scheda e colonna, i formati per cella; le schede
 * protette e il registro delle chiamate alla protezione.
 */
type Extras = {
  validations: Record<string, unknown>
  formats: Record<string, string>
  protected?: string[]
  log?: string[]
}

function fakeSpreadsheet(sheets: Sheets, extras: Extras = { validations: {}, formats: {} }) {
  const sheet = (name: string) => ({
    getName: () => name,
    getDataRange: () => ({ getValues: () => (sheets[name] ?? []).map((row) => [...row]) }),
    // Come in Apps Script, i metodi di una cella che la cambiano restituiscono la cella.
    getRange(row: number, column: number) {
      const cells = () => {
        const rows = sheets[name] ?? []
        return rows[row - 1] ?? (rows[row - 1] = [])
      }
      const range = {
        setValue(value: unknown) {
          cells()[column - 1] = value
          return range
        },
        // La formula si scrive nella cella, come la mostrerebbe la barra delle formule.
        setFormulaR1C1(formula: string) {
          cells()[column - 1] = formula
          return range
        },
        setNumberFormat(format: string) {
          extras.formats[`${name}!R${row}C${column}`] = format
          return range
        },
        setDataValidation(rule: unknown) {
          extras.validations[`${name}!C${column}`] = rule
          return range
        },
      }
      return range
    },
    appendRow: (values: unknown[]) => void (sheets[name] ?? []).push(values),
    clear: () => void (sheets[name] = []),
    setFrozenRows: () => undefined,
    getMaxRows: () => 1000,
    getProtections: () => (extras.protected?.includes(name) ? ['protezione'] : []),
    protect() {
      extras.protected?.push(name)
      return recorder(extras.log ?? [], `protezione ${name}`, {
        getEditors: ['editore@example.org'],
        canDomainEdit: true,
      })
    },
  })
  return {
    getId: () => 'foglio',
    getSheetByName: (name: string) => (sheets[name] ? sheet(name) : null),
    insertSheet: (name: string) => {
      sheets[name] = []
      return sheet(name)
    },
  }
}

function fakeProperties(values: Record<string, string>) {
  return {
    getScriptProperties: () => ({
      getProperty: (name: string) => values[name] ?? null,
      setProperty: (name: string, value: string) => void (values[name] = value),
    }),
  }
}

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  // Apps Script dà i byte con il segno.
  computeDigest: (_: string, text: string) =>
    [...createHash('sha256').update(text, 'utf8').digest()].map((byte) => (byte > 127 ? byte - 256 : byte)),
  formatDate: (date: Date, _: string, format: string) => (format.includes('HH') ? romeDateTime(date) : romeDate(date)),
  getUuid: () => '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
}

/** Un oggetto che accetta ogni chiamata, la scrive nel registro e restituisce sé stesso, salvo le risposte date. */
function recorder(log: string[], name: string, answers: Record<string, unknown> = {}): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get: (_, method) => {
        if (method === 'then') return undefined
        return (...args: unknown[]) => {
          log.push(`${name}.${String(method)}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`)
          const answer = answers[String(method)]
          return answer === undefined ? self : typeof answer === 'function' ? answer(...args) : answer
        }
      },
    },
  )
  return self
}

/** L'account che fa girare lo script (ADR 0004): web app e trigger sono «Esegui come: io» dell'account della Bussola. */
const BUSSOLA_ACCOUNT = 'amministratore.bussola@example.org'

/** Session: dall'editor l'account attivo è quello della Bussola; da `google.script.run` o da un trigger un altro. */
function fakeSession(active: string = BUSSOLA_ACCOUNT) {
  return {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => BUSSOLA_ACCOUNT }),
  }
}

/** I trigger del progetto, coi loro id; un evento vero porta l'id del suo trigger in `triggerUid`. */
function fakeTriggers(handlers: string[]) {
  return handlers.map((name) => ({ getHandlerFunction: () => name, getUniqueId: () => `uid-${name}` }))
}

describe('chi può lanciare le funzioni globali', () => {
  // La pagina della segreteria e le sue chiamate rifanno il controllo di «Accessi»: le apre chiunque nel dominio.
  const OPEN = ['doGet', ...OFFICE_CALLS]
  // I gestori dei trigger creati da setupBussola e setupSoci: passano col `triggerUid` giusto, o dall'editor.
  const TRIGGERS = [
    'checkOfficeSharing',
    'closeUsage',
    'everyTenMinutes',
    'onAccessEdit',
    'onCommitmentFormSubmit',
    'onContentEdit',
    'onMeetingFormSubmit',
    'onUpdateFormSubmit',
    'publishReferents',
  ]
  // Le funzioni che si lanciano solo dall'editor, con l'account della Bussola.
  const EDITOR = [
    'checkBounces',
    'checkSharing',
    'migrateMemberRegister',
    'previewMemberRegister',
    'publishHello',
    'setupBussola',
    'setupSoci',
  ]
  const PASSED = 'oltre la guardia'

  /** Ogni servizio di Google fuori da Session e dai trigger cade con PASSED: la guardia o ferma prima, o è passata. */
  const beyond = new Proxy(
    {},
    {
      get: () => {
        throw new Error(PASSED)
      },
    },
  )
  const SERVICES = ['SpreadsheetApp', 'PropertiesService', 'DriveApp', 'GmailApp', 'FormApp', 'UrlFetchApp']

  /** `fields` diventa l'evento, con la cella e il Foglio di onEdit che cadono oltre la guardia; senza, nessun evento. */
  async function call(name: string, active: string, fields?: Record<string, unknown>) {
    const { code } = await bundle('motore')
    const context: Record<string, unknown> = {
      event: fields && { ...fields, range: beyond, source: beyond },
      Session: fakeSession(active),
      ScriptApp: {
        getProjectTriggers: () => fakeTriggers(TRIGGERS),
        newTrigger: () => beyond,
        deleteTrigger: () => {
          throw new Error(PASSED)
        },
      },
      ...Object.fromEntries(
        [...SERVICES, 'LockService', 'HtmlService', 'MailApp', 'Utilities', 'console'].map((name) => [name, beyond]),
      ),
    }
    try {
      runInNewContext(`${code}\n${name}(event)`, context)
      return 'nessun errore'
    } catch (error) {
      return (error as Error).message
    }
  }

  it('ogni globale è classificata: aperta, gestore di un trigger o solo dall’editor', async () => {
    const { globals } = await bundle('motore')
    expect([...globals].sort()).toEqual([...OPEN, ...TRIGGERS, ...EDITOR].sort())
  })

  it('da `google.script.run`, con un altro account del dominio, si fermano tutte tranne la pagina', async () => {
    const { globals } = await bundle('motore')
    for (const name of globals) {
      if (OPEN.includes(name)) continue
      expect([name, await call(name, 'socio@example.org')]).toEqual([name, CALLER_REFUSED])
      expect([name, await call(name, 'socio@example.org', { triggerUid: 'uid-inventato' })]).toEqual([
        name,
        CALLER_REFUSED,
      ])
      expect([name, await call(name, '')]).toEqual([name, CALLER_REFUSED])
    }
  })

  it('i gestori dei trigger passano col `triggerUid` del loro trigger, anche con un altro account attivo', async () => {
    for (const name of TRIGGERS)
      expect([name, await call(name, 'socio@example.org', { triggerUid: `uid-${name}` })]).toEqual([name, PASSED])
    // Le funzioni dell'editor non guardano il triggerUid.
    for (const name of EDITOR)
      expect([name, await call(name, 'socio@example.org', { triggerUid: 'uid-everyTenMinutes' })]).toEqual([
        name,
        CALLER_REFUSED,
      ])
  })

  it('dall’editor, con l’account della Bussola, passano tutte', async () => {
    for (const name of [...TRIGGERS, ...EDITOR])
      expect([name, await call(name, ' Amministratore.Bussola@Example.org', {})]).toEqual([name, PASSED])
  })
})

describe('un giro del motore nel file unito', () => {
  const now = new Date('2026-10-31T17:50:00Z')
  const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

  /** `call`: la globale da lanciare, coi trigger del progetto che la fanno passare. */
  async function run(
    call = "everyTenMinutes({ triggerUid: 'uid-everyTenMinutes' })",
    triggers = ['everyTenMinutes'],
    withCommitmentForm = false,
  ) {
    const { code } = await bundle('motore')
    /** I trigger creati e cancellati dal giro. */
    const log: string[] = []
    const sheets = demoSheets(now)
    const properties: Record<string, string> = {
      CONTENT_SHEET_ID: 'foglio',
      UPDATE_FORM_ID: 'modulo',
      CF_ACCOUNT_ID: 'acc123',
      CF_KV_NAMESPACE_ID: 'ns456',
      CF_API_TOKEN: 'token-segreto',
    }
    const answers: [string, string][] = [
      ['Gruppo', 'Orti e Suoli'],
      ['Cantiere', 'Rete dei mercati contadini (CAN-0001)'],
      ['Codice del gruppo: non cambiarlo', DEMO_CODES['GDL-orti']],
      ['Chi sei?', 'Giulia Verdi'],
      ['A che punto è?', 'In chiusura'],
      ["Cosa è successo dall'ultima volta?", '=IMPORTXML("https://example.org")'],
      ['Qual è il prossimo passo?', 'la festa'],
      ['Per quando?', '2026-11-20'],
    ]
    const formResponse = {
      getId: () => 'risposta-1',
      getTimestamp: () => new Date('2026-10-31T17:42:00Z'),
      getItemResponses: () =>
        answers.map(([title, response]) => ({
          getItem: () => ({ getTitle: () => title }),
          getResponse: () => response,
        })),
    }
    const prefilled: string[] = []
    const form = {
      getResponses: () => [formResponse],
      getItems: () =>
        UPDATE_FORM.questions.map((question) => ({
          getTitle: () => question.title,
          asTextItem: () => ({ createResponse: (value: string) => value }),
        })),
      createResponse() {
        const builder = {
          withItemResponse: (value: string) => (prefilled.push(value), builder),
          toPrefilledUrl: () =>
            'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&' +
            prefilled.map((value, i) => `entry.${1001 + i}=${value}`).join('&'),
        }
        return builder
      },
    }
    // Il Modulo «Proponi un impegno», con la stesura di prova della scheda e l'elenco delle righe che si riscrive.
    let rowChoices = [NO_COMMITMENT_ROW]
    const choiceWrites: string[][] = []
    const commitmentForm = {
      getResponses: () => [
        {
          getId: () => 'proposta-1',
          getTimestamp: () => new Date('2026-10-31T17:45:00Z'),
          getItemResponses: () =>
            COMMITMENT_FORM.questions
              .filter((question) => DEMO_COMMITMENT_ANSWER[question.field])
              .map((question) => ({
                getItem: () => ({ getTitle: () => question.title }),
                getResponse: () => DEMO_COMMITMENT_ANSWER[question.field],
              })),
        },
      ],
      getItems: () =>
        COMMITMENT_FORM.questions.map((question) => ({
          getTitle: () => question.title,
          asListItem: () => ({
            getChoices: () => rowChoices.map((value) => ({ getValue: () => value })),
            setChoiceValues: (values: string[]) => void choiceWrites.push((rowChoices = values)),
          }),
        })),
      getPublishedUrl: () => 'https://docs.google.com/forms/d/e/impegni/viewform',
    }
    if (withCommitmentForm) properties.COMMITMENT_FORM_ID = 'modulo-impegni'
    const puts: { url: string; payload: string }[] = []
    const context = {
      Date,
      console: { log: () => undefined },
      SpreadsheetApp: { openById: () => fakeSpreadsheet(sheets) },
      FormApp: { openById: (id: string) => (id === 'modulo-impegni' ? commitmentForm : form) },
      PropertiesService: fakeProperties(properties),
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
      // Il trigger dei 10 minuti: nessun account attivo, il suo triggerUid.
      Session: fakeSession(''),
      ScriptApp: {
        getProjectTriggers: () => fakeTriggers(triggers),
        newTrigger: (name: string) => recorder(log, `trigger ${name}`),
        deleteTrigger: (trigger: { getHandlerFunction(): string }) =>
          void log.push(`cancellato ${trigger.getHandlerFunction()}`),
      },
      UrlFetchApp: {
        fetch: (url: string, params: { payload: string }) => {
          puts.push({ url, payload: params.payload })
          return { getResponseCode: () => 200, getContentText: () => '{}' }
        },
      },
      Utilities,
    }
    runInNewContext(`${code}\n${call}`, context)
    return { sheets, puts, properties, log, choiceWrites }
  }

  /** L'evento onEdit del Foglio contenuti, su una cella della scheda data. */
  const edit = (sheet: string) =>
    `onContentEdit({ triggerUid: 'uid-onContentEdit', range: { getSheet: () => ({ getName: () => ${JSON.stringify(sheet)} }) } })`

  it('un cambio in «Referenti» prepara un giro fra un minuto; un’altra scheda aspetta i 10 minuti', async () => {
    const referents = await run(edit('Referenti'), ['onContentEdit'])
    expect(referents.puts).toHaveLength(0)
    expect(referents.log).toContain('trigger publishReferents.after(60000)')
    expect(referents.log).toContain('trigger publishReferents.create()')
    const other = await run(edit('Cantieri'), ['onContentEdit'])
    expect(other.log).toEqual([])
  })

  it('con un giro già in attesa, un altro cambio in «Referenti» non ne prepara un secondo', async () => {
    const { log } = await run(edit('Referenti'), ['onContentEdit', 'publishReferents'])
    expect(log).toEqual([])
  })

  it('il giro preparato cancella il suo trigger e pubblica le due istantanee', async () => {
    const { puts, log } = await run("publishReferents({ triggerUid: 'uid-publishReferents' })", ['publishReferents'])
    expect(log).toEqual(['cancellato publishReferents'])
    expect(puts.map((put) => decodeURIComponent(put.url.split('/values/')[1] ?? ''))).toEqual([
      'v1/riservata.json',
      'v1/sito.json',
    ])
  })

  it('applica la risposta del Modulo e pubblica le istantanee riservata e del sito su KV', async () => {
    const { sheets, puts } = await run()
    const projects = sheets[SHEETS.projects.name] ?? []
    expect(projects[1]?.[3]).toBe('in chiusura')
    expect(puts).toHaveLength(2)
    expect(puts[0]?.url).toMatch(/\/accounts\/acc123\/storage\/kv\/namespaces\/ns456\/values\/v1%2Friservata\.json$/)
    expect(puts[1]?.url).toMatch(/\/values\/v1%2Fsito\.json$/)
    const site = JSON.parse(puts[1]?.payload ?? '{}')
    expect(site.groups.find((group: { id: string }) => group.id === 'GDL-orti').referents[0]).toEqual({
      name: 'Lia Prova',
      role: 'referente',
    })
    const snapshot = JSON.parse(puts[0]?.payload ?? '{}')
    expect(snapshot.projects[0]).toMatchObject({ id: 'CAN-0001', stage: 'closing', updatedOn: '2026-10-31' })
    expect(snapshot.projects[0].updateUrl).toContain(`entry.1003=${DEMO_CODES['GDL-orti']}`)
  })

  it('le impronte delle mail, coi byte con il segno di Apps Script, sono quelle della vetrina', async () => {
    const { puts } = await run()
    const snapshot = JSON.parse(puts[0]?.payload ?? '{}')
    const fingerprints = snapshot.people.map((person: { fingerprint: string }) => person.fingerprint)
    expect(fingerprints).toContain(sha256Hex(normalizeEmail(DEMO_EMAILS.rep)))
  })

  it('una risposta che comincia con «=» si scrive come testo, non come formula', async () => {
    const { sheets } = await run()
    const updates = sheets[SHEETS.updates.name] ?? []
    expect(updates[1]?.[7]).toBe('\'=IMPORTXML("https://example.org")')
  })

  it('ricorda cosa ha pubblicato nelle proprietà dello script, per KV', async () => {
    const { properties } = await run()
    expect(Object.keys(properties)).toContain('pubblicato:ns456:v1/riservata.json')
  })

  it('il Modulo «Proponi un impegno»: la risposta completa la riga, l’elenco perde la riga, la Riservata ha la scheda', async () => {
    const { sheets, puts, choiceWrites } = await run(
      "onCommitmentFormSubmit({ triggerUid: 'uid-onCommitmentFormSubmit' })",
      ['onCommitmentFormSubmit'],
      true,
    )
    const rows = sheets[SHEETS.commitments.name] ?? []
    const column = (name: string) => SHEETS.commitments.columns.indexOf(name)
    const row = rows.find((cells) => cells[0] === 'IMP-0001') ?? []
    expect(row[column('stato')]).toBe('proposto')
    expect(row[column('giornate')]).toBe(12)
    // «1.200» si scrive come testo nel Modulo; nella riga va il numero.
    expect(row[column('compenso')]).toBe(1200)
    expect(rows.filter((cells) => cells[2] === 'La cura della Bussola')).toHaveLength(1)
    expect(choiceWrites).toEqual([['La newsletter del mese (IMP-0002)']])
    const snapshot = JSON.parse(puts[0]?.payload ?? '{}')
    expect(snapshot.commitmentFormUrl).toBe('https://docs.google.com/forms/d/e/impegni/viewform')
    expect(snapshot.commitments.find((item: { id: string }) => item.id === 'IMP-0001')).toMatchObject({
      status: 'proposed',
      proposedOn: '2026-10-31',
    })
  })

  it('scrive «Salute»', async () => {
    const { sheets } = await run()
    expect((sheets[SHEETS.health.name] ?? []).slice(1).map((row) => row[0])).toEqual([
      'Foglio «Bussola · contenuti»',
      'Modulo «Aggiorna il cantiere»',
      'Modulo «Prossimo incontro»',
      'Modulo «Proponi un impegno»',
      'Istantanea riservata (v1/riservata.json)',
      'Istantanea del sito (v1/sito.json)',
      'Istantanea dei soci (v1/soci.json)',
      'Lista di Access (Persone della Riservata)',
    ])
  })

  it('pubblica le scadenze, le delibere, le questioni e il budget, con le date di Roma', async () => {
    const { puts } = await run()
    const snapshot = JSON.parse(puts[0]?.payload ?? '{}')
    expect(snapshot.deadlines).toHaveLength(10)
    expect(snapshot.resolutions).toHaveLength(7)
    expect(snapshot.resolutions[0]).toMatchObject({ date: '2026-10-21', body: 'Coordinamento' })
    expect(snapshot.issues).toHaveLength(3)
    expect(snapshot.budget).toMatchObject({ updatedOn: '2026-10-22' })
  })
})

describe('la chiusura del mese dell’uso nel file unito', () => {
  it('scrive «Uso», cancella le impronte del mese chiuso col sale e prepara il sale del mese dopo', async () => {
    const { code } = await bundle('motore')
    const sheets = demoSheets(new Date())
    const fingerprint = (n: number) => n.toString(16).padStart(64, '0')
    const keys = [
      `uso:2026-09:coordinamento:${fingerprint(1)}`,
      `uso:2026-09:coordinamento:${fingerprint(2)}`,
      'uso-sale:2026-09',
    ]
    const calls: { method: string; url: string; payload?: string }[] = []
    const UrlFetchApp = {
      fetch: (url: string, params: { method: string; payload?: string }) => {
        calls.push({ method: params.method, url, payload: params.payload })
        const prefix = decodeURIComponent(/prefix=([^&]+)/.exec(url)?.[1] ?? '')
        const body =
          params.method === 'get'
            ? { result: keys.filter((key) => key.startsWith(prefix)).map((name) => ({ name })), result_info: {} }
            : { success: true }
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) }
      },
    }
    const context = {
      Date,
      JSON,
      console: { log: () => undefined },
      SpreadsheetApp: { openById: () => fakeSpreadsheet(sheets) },
      PropertiesService: fakeProperties({
        CONTENT_SHEET_ID: 'foglio',
        CF_ACCOUNT_ID: 'acc123',
        CF_KV_NAMESPACE_ID: 'ns456',
        CF_API_TOKEN: 'token-segreto',
      }),
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
      Session: fakeSession(''),
      ScriptApp: { getProjectTriggers: () => fakeTriggers(['closeUsage']) },
      UrlFetchApp,
      Utilities,
    }
    runInNewContext(`${code}\ncloseUsage({ triggerUid: 'uid-closeUsage' })`, context)
    // Il mese si scrive come testo, con l'apostrofo: il Foglio ne farebbe una data.
    expect((sheets[SHEETS.usage.name] ?? []).slice(1)).toEqual([["'2026-09", 'coordinamento', 2, 4]])
    const deleted = calls.find((call) => call.url.endsWith('/bulk/delete'))
    expect(JSON.parse(deleted?.payload ?? '[]')).toEqual(keys)
    const salt = calls.find((call) => call.method === 'put')
    expect(salt?.url).toMatch(/\/values\/uso-sale%3A\d{4}-\d{2}\?expiration_ttl=6048000$/)
    expect(salt?.payload).toMatch(/^[0-9a-f]{64}$/)
    const health = (sheets[SHEETS.health.name] ?? []).find((row) => row[0] === 'Uso della Bussola (scheda «Uso»)')
    expect(health?.[1]).toBe('a posto')
  })
})

describe('l’automatismo mensile nel file unito', () => {
  it('la notte del primo crea la scadenza «misura» e il libro soci nel Drive, in sola lettura, nella cartella «Libro soci»', async () => {
    const { code } = await bundle('motore')
    const content = demoSheets(new Date())
    const soci = demoSociSheets()
    const created: Record<string, unknown[][]> = {}
    const log: string[] = []
    const properties: Record<string, string> = {
      CONTENT_SHEET_ID: 'foglio-contenuti',
      SOCI_SHEET_ID: 'foglio-soci',
      CF_ACCOUNT_ID: 'acc123',
      CF_KV_NAMESPACE_ID: 'ns456',
      CF_API_TOKEN: 'token-segreto',
    }
    const SpreadsheetApp = {
      openById: (id: string) => fakeSpreadsheet(id === 'foglio-contenuti' ? content : soci),
      create: (name: string) => {
        created[name] = []
        const sheet = {
          setName: () => sheet,
          getRange: (row: number, column: number, rows: number, columns: number) => ({
            setValues: (values: unknown[][]) => {
              log.push(`valori ${name} ${row},${column} ${rows}x${columns}`)
              created[name] = values
            },
          }),
          setFrozenRows: () => undefined,
          protect: () => recorder(log, `protezione ${name}`, { getEditors: ['x@example.org'], canDomainEdit: true }),
        }
        return {
          getSheets: () => [sheet],
          insertSheet: () => sheet,
          getId: () => `id-${name}`,
          getUrl: () => `https://docs.google.com/spreadsheets/d/id-${name}/edit`,
        }
      },
      ProtectionType: { SHEET: 'SHEET' },
    }
    const folder = recorder(log, 'cartella', { getId: 'cartella-libro' })
    const CalendarApp = {
      getCalendarsByName: () => [],
      createCalendar: (name: string) =>
        recorder(log, `calendario ${name}`, {
          getEvents: [],
          createAllDayEvent: (title: string) => recorder(log, `evento «${title}»`),
        }),
    }
    const DriveApp = {
      getFileById: (id: string) =>
        id === 'foglio-soci'
          ? {
              getParents: () => ({
                next: () => ({ createFolder: (name: string) => (log.push(`crea ${name}`), folder) }),
              }),
            }
          : recorder(log, `file ${id}`),
      getFolderById: () => folder,
    }
    const context = {
      Date,
      JSON,
      console: { log: () => undefined },
      SpreadsheetApp,
      DriveApp,
      CalendarApp,
      PropertiesService: fakeProperties(properties),
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
      Session: fakeSession(''),
      ScriptApp: { getProjectTriggers: () => fakeTriggers(['closeUsage']) },
      UrlFetchApp: { fetch: () => ({ getResponseCode: () => 503, getContentText: () => 'giù' }) },
      Utilities,
    }
    runInNewContext(`${code}\ncloseUsage({ triggerUid: 'uid-closeUsage' })`, context)
    const today = romeDate(new Date())
    const name = `Libro soci al ${today}`
    expect(Object.keys(created)).toEqual([name])
    expect(created[name]?.[0]).toEqual(expect.arrayContaining(['numero', 'cognome', 'nome', 'delibera', 'receduto il']))
    expect(created[name]?.[0]).not.toContain('mail')
    expect(created[name]).toHaveLength(21)
    expect(log).toContain('crea Libro soci')
    expect(log).toContain(`protezione ${name}.removeEditors(["x@example.org"])`)
    expect(log).toContain(`protezione ${name}.setDomainEdit(false)`)
    expect(log).toContain(`file id-${name}.setShareableByEditors(false)`)
    expect(log).toContain(`file id-${name}.moveTo(${JSON.stringify(folder)})`.replace(JSON.stringify(folder), '{}'))
    expect(properties['LIBRO_SOCI_FOLDER_ID']).toBe('cartella-libro')
    expect(properties['segreteria:libro']).toContain(`"savedOn":"${today}"`)
    expect(properties['segreteria:mensile']).toBe(today.slice(0, 7))
    const ids = (content[SHEETS.deadlines.name] ?? []).map((row) => row[0])
    expect(ids).toContain(`MIS-O9-${today.slice(0, 7)}`)
    // Il calendario «Scadenze RAMI» nasce con un evento per ogni scadenza aperta, misura del mese compresa.
    expect(log.filter((line) => line.startsWith('calendario Scadenze RAMI.createAllDayEvent('))).toHaveLength(
      ids.length - 2,
    )
    expect(log).toContain(
      `evento «Quota annuale all'ente di normazione · segue: il tesoriere».setTag("scadenza", "SCA-0001")`,
    )
    expect(log).toContain(`evento «Quota annuale all'ente di normazione · segue: il tesoriere».addPopupReminder(10080)`)
    expect(log.some((line) => line.includes('SCA-0006'))).toBe(false)
  })
})

/** Gli id che Google dà ai Moduli creati dalla preparazione finta. */
const FORM_IDS: Record<string, string> = {
  [MEETING_FORM.title]: 'modulo-incontri',
  [COMMITMENT_FORM.title]: 'modulo-impegni',
}

describe('la preparazione nel file unito', () => {
  async function setup(
    sheets: Sheets,
    properties: Record<string, string>,
    triggers: string[] = [],
    extras: Extras = { validations: {}, formats: {} },
    formDescription: string = UPDATE_FORM.description,
    /** I titoli delle domande del Modulo «Proponi un impegno» che c'è già: di partenza, tutti. */
    commitmentTitles: readonly string[] = COMMITMENT_FORM.questions.map((question) => question.title),
  ) {
    const { code } = await bundle('motore')
    const log: string[] = []
    const titles = (id: string) =>
      id === 'modulo-incontri'
        ? MEETING_FORM.questions.map((question) => question.title)
        : id === 'modulo-impegni'
          ? commitmentTitles
          : UPDATE_FORM.questions.map((question) => question.title)
    const context = {
      Date,
      // Le righe che la preparazione dice a chi la lancia dall'editor.
      console: { log: (line: string) => void log.push(`console: ${line}`) },
      SpreadsheetApp: {
        openById: () => fakeSpreadsheet(sheets, extras),
        // La regola è l'elenco dei valori ammessi.
        newDataValidation: () => ({ requireValueInList: (values: string[]) => ({ build: () => values }) }),
      },
      FormApp: {
        create: (title: string) =>
          recorder(log, `modulo «${title}»`, {
            getId: FORM_IDS[title] ?? 'modulo-nuovo',
          }),
        // «Prossimo incontro» e «Proponi un impegno» hanno già la loro descrizione; quella dell'altro la dà la prova.
        openById: (id: string) =>
          recorder(log, `modulo ${id}`, {
            getDescription:
              id === 'modulo-incontri'
                ? MEETING_FORM.description
                : id === 'modulo-impegni'
                  ? COMMITMENT_FORM.description
                  : formDescription,
            getItems: () => titles(id).map((title) => ({ getTitle: () => title })),
          }),
        // La convalida è la regola che chiede.
        createTextValidation: () => ({ requireTextIsEmail: () => ({ build: () => 'una mail' }) }),
      },
      DriveApp: {
        getFileById: (id: string) =>
          recorder(log, `file ${id}`, { getParents: () => ({ next: () => 'cartella Bussola' }) }),
      },
      ScriptApp: {
        getProjectTriggers: () => fakeTriggers(triggers),
        newTrigger: (name: string) => recorder(log, `trigger ${name}`),
      },
      PropertiesService: fakeProperties(properties),
      Session: fakeSession(),
      Utilities,
    }
    runInNewContext(`${code}\nsetupBussola()`, context)
    return log
  }

  it('crea le schede che mancano, con le intestazioni', async () => {
    const sheets: Sheets = {}
    await setup(sheets, { CONTENT_SHEET_ID: 'foglio' })
    for (const spec of Object.values(SHEETS)) expect(sheets[spec.name]?.[0]).toEqual([...spec.columns])
    expect(sheets[SHEETS.settings.name]?.slice(1)).toEqual([
      ['giorni per fermo', 30],
      ['link della segreteria', ''],
      ['compenso visibile ai soci', 'no'],
    ])
  })

  it('non tocca le schede che ci sono già', async () => {
    const sheets = demoSheets(new Date())
    const before = JSON.stringify(sheets)
    await setup(sheets, { CONTENT_SHEET_ID: 'foglio', UPDATE_FORM_ID: 'modulo' }, [
      'everyTenMinutes',
      'onUpdateFormSubmit',
    ])
    expect(JSON.stringify(sheets)).toBe(before)
  })

  it('a un Foglio di prima aggiunge in fondo le colonne e le voci nate dopo, una volta sola', async () => {
    const sheets = demoSheets(new Date())
    const groups = sheets[SHEETS.groups.name] ?? []
    const open = SHEETS.groups.columns.indexOf('chat aperta ai soci')
    sheets[SHEETS.groups.name] = groups.map((row) => row.filter((_, i) => i !== open))
    sheets[SHEETS.settings.name] = [
      ['voce', 'valore'],
      ['giorni per fermo', 20],
    ]
    const before = JSON.stringify(sheets[SHEETS.groups.name]?.slice(1))
    const extras: Extras = { validations: {}, formats: {} }
    const properties = { CONTENT_SHEET_ID: 'foglio', UPDATE_FORM_ID: 'modulo', MEETING_FORM_ID: 'modulo-incontri' }
    await setup(sheets, properties, [], extras)
    const header = sheets[SHEETS.groups.name]?.[0] ?? []
    expect(header.at(-1)).toBe('chat aperta ai soci')
    expect(extras.validations).toEqual({ [`GdL!C${header.length}`]: ['sì', 'no'] })
    // Le righe dei gruppi non cambiano: la colonna nuova è vuota, cioè chiusa.
    expect(JSON.stringify(sheets[SHEETS.groups.name]?.slice(1))).toBe(before)
    expect(sheets[SHEETS.settings.name]).toEqual([
      ['voce', 'valore'],
      ['giorni per fermo', 20],
      ['link della segreteria', ''],
      ['compenso visibile ai soci', 'no'],
    ])
    const again = JSON.stringify(sheets)
    await setup(sheets, properties)
    expect(JSON.stringify(sheets)).toBe(again)
  })

  it('la scheda «Misure» nasce con dieci righe, «chi conta» e la formula in «variazione»', async () => {
    const sheets: Sheets = {}
    const extras: Extras = { validations: {}, formats: {} }
    await setup(sheets, { CONTENT_SHEET_ID: 'foglio' }, [], extras)
    const [header, ...rows] = sheets[SHEETS.measures.name] ?? []
    expect(header).toEqual(['obiettivo', 'quando', 'prima', 'dopo', 'variazione', 'chi conta', 'nota'])
    expect(rows).toHaveLength(10)
    expect(rows.map((row) => row[0])).toEqual(MEASURES.map((measure) => measure.objective))
    expect(rows.map((row) => row[2])).toEqual(MEASURES.map((measure) => measure.before))
    for (const row of rows) expect(['chi cura la Bussola', 'il segretario']).toContain(row[5])
    expect(rows[0]?.[4]).toBe('=IF(AND(ISNUMBER(R[0]C[-2]),ISNUMBER(R[0]C[-1])),R[0]C[-1]-R[0]C[-2],"")')
    expect(rows[1]?.[4]).toBe(
      '=IF(AND(ISNUMBER(R[0]C[-2]),ISNUMBER(R[0]C[-1]),R[0]C[-2]<>0),(R[0]C[-1]-R[0]C[-2])/R[0]C[-2],"")',
    )
    expect(extras.formats).toEqual({ 'Misure!R3C5': '0%' })
  })

  it('una scheda «Misure» che c’è già resta com’è', async () => {
    const sheets: Sheets = { [SHEETS.measures.name]: [[...SHEETS.measures.columns], ['O1 · scritta a mano', '', 3]] }
    const before = JSON.stringify(sheets[SHEETS.measures.name])
    await setup(sheets, { CONTENT_SHEET_ID: 'foglio' })
    expect(JSON.stringify(sheets[SHEETS.measures.name])).toBe(before)
  })

  it('mette le convalide nelle colonne a scelta delle schede nuove', async () => {
    const extras: Extras = { validations: {}, formats: {} }
    await setup({}, { CONTENT_SHEET_ID: 'foglio' }, [], extras)
    expect(extras.validations).toEqual({
      'GdL!C7': ['sì', 'no'],
      'Cantieri!C4': ['avvio', 'in corso', 'in revisione', 'in chiusura', 'chiuso'],
      'Scadenze!C3': ['bando', 'adempimento', 'fiscale', 'evento', 'Assemblea', 'misura'],
      'Scadenze!C8': ['sì', 'no'],
      'Delibere!C3': ['Direttivo', 'Coordinamento', 'Assemblea'],
      'Questioni!C5': ['aperta', 'chiusa'],
      'Incontri!C4': ['sì', 'no'],
      'Link!C3': ['tutti', 'soci', 'partecipanti del GdL', 'Coordinamento'],
      'Impegni!C8': ['continuativo', 'a progetto'],
      'Impegni!C11': ['volontario', 'rimborso spese', 'compenso'],
      'Impegni!C13': ['sì', 'no'],
      'Impegni!C23': [
        'da scrivere',
        'proposto',
        'approvato dal Coordinamento',
        'aperto',
        'preso',
        'in corso',
        'consegnato',
        'chiuso',
        'respinto',
      ],
      'Impegni!C24': ['completato', 'revocato', 'ritirato'],
    })
  })

  it('crea il Modulo con le sue domande, senza chiedere l’accesso a Google, e lo mette accanto al Foglio', async () => {
    const properties: Record<string, string> = { CONTENT_SHEET_ID: 'foglio' }
    const log = await setup({}, properties)
    const form = log.filter((line) => line.startsWith('modulo «Aggiorna il cantiere»'))
    for (const question of UPDATE_FORM.questions)
      expect(form).toContain(`modulo «Aggiorna il cantiere».setTitle(${JSON.stringify(question.title)})`)
    expect(form).toContain('modulo «Aggiorna il cantiere».setRequireLogin(false)')
    expect(form).toContain(
      `modulo «Aggiorna il cantiere».setConfirmationMessage(${JSON.stringify(UPDATE_FORM.confirmation)})`,
    )
    expect(log).toContain('file modulo-nuovo.moveTo("cartella Bussola")')
    expect(properties.UPDATE_FORM_ID).toBe('modulo-nuovo')
  })

  it('crea il Modulo «Prossimo incontro»: giorno, ora, link di Meet e se è visibile ai soci', async () => {
    const properties: Record<string, string> = { CONTENT_SHEET_ID: 'foglio' }
    const log = await setup({}, properties)
    const form = log.filter((line) => line.startsWith('modulo «Prossimo incontro»'))
    for (const question of MEETING_FORM.questions)
      expect(form).toContain(`modulo «Prossimo incontro».setTitle(${JSON.stringify(question.title)})`)
    expect(form).toContain('modulo «Prossimo incontro».addTimeItem()')
    expect(form).toContain('modulo «Prossimo incontro».setChoiceValues(["Sì","No"])')
    expect(form).toContain('modulo «Prossimo incontro».setRequireLogin(false)')
    expect(log).toContain('file modulo-incontri.moveTo("cartella Bussola")')
    expect(properties.MEETING_FORM_ID).toBe('modulo-incontri')
  })

  it('crea il Modulo «Proponi un impegno»: la riga da un elenco, i sette blocchi con un aiuto sotto ognuno', async () => {
    const properties: Record<string, string> = { CONTENT_SHEET_ID: 'foglio' }
    const log = await setup({}, properties)
    const form = log.filter((line) => line.startsWith('modulo «Proponi un impegno»'))
    // Ogni domanda, sul Modulo creato: il titolo, l'aiuto sotto, e se è obbligatoria, nelle tre chiamate in fila.
    for (const question of COMMITMENT_FORM.questions) {
      const title = `modulo «Proponi un impegno».setTitle(${JSON.stringify(question.title)})`
      const at = form.indexOf(title)
      expect(form.slice(at, at + 3), question.title).toEqual([
        title,
        `modulo «Proponi un impegno».setHelpText(${JSON.stringify(question.help)})`,
        `modulo «Proponi un impegno».setRequired(${JSON.stringify(question.required)})`,
      ])
    }
    expect(form).toContain('modulo «Proponi un impegno».addListItem()')
    expect(form).toContain(`modulo «Proponi un impegno».setChoiceValues(${JSON.stringify([NO_COMMITMENT_ROW])})`)
    expect(form).toContain('modulo «Proponi un impegno».setChoiceValues(["Continuativo","A progetto"])')
    // La mail di chi propone: Google la accetta solo se è una mail.
    expect(form).toContain('modulo «Proponi un impegno».setValidation("una mail")')
    expect(form).toContain('modulo «Proponi un impegno».setRequireLogin(false)')
    expect(log).toContain('file modulo-impegni.moveTo("cartella Bussola")')
    expect(properties.COMMITMENT_FORM_ID).toBe('modulo-impegni')
  })

  it('a un Modulo che c’è già rimette la descrizione, col link all’informativa', async () => {
    const properties = { CONTENT_SHEET_ID: 'foglio', UPDATE_FORM_ID: 'modulo' }
    const log = await setup({}, properties, [], undefined, 'Ci vuole un minuto.')
    expect(log).toContain(`modulo modulo.setDescription(${JSON.stringify(UPDATE_FORM.description)})`)
    const again = await setup({}, properties)
    expect(again.filter((line) => line.includes('setDescription'))).toEqual([])
  })

  it('a un Modulo nato prima delle domande su chi propone, dice quali aggiungere a mano, coi titoli', async () => {
    const properties = { CONTENT_SHEET_ID: 'foglio', COMMITMENT_FORM_ID: 'modulo-impegni' }
    const before = COMMITMENT_FORM.questions
      .filter((question) => !['proposerFirstName', 'proposerLastName', 'proposerEmail'].includes(question.field))
      .map((question) => question.title)
    const log = await setup({}, properties, [], undefined, UPDATE_FORM.description, before)
    expect(log).toContain(
      'console: Il Modulo «Proponi un impegno» non ha le domande «Chi lo propone? Il tuo nome», «Il tuo cognome», ' +
        '«La tua mail»: aggiungile a mano, con questi titoli, perché il motore legge le risposte dal titolo.',
    )
    const again = await setup({}, properties)
    expect(again.filter((line) => line.includes('non ha le domande'))).toEqual([])
  })

  it('accende i trigger, una volta sola', async () => {
    const log = await setup({}, { CONTENT_SHEET_ID: 'foglio' })
    expect(log).toContain('trigger everyTenMinutes.everyMinutes(10)')
    expect(log).toContain('trigger onUpdateFormSubmit.forForm("modulo-nuovo")')
    expect(log).toContain('trigger onUpdateFormSubmit.onFormSubmit()')
    expect(log).toContain('trigger onMeetingFormSubmit.forForm("modulo-incontri")')
    expect(log).toContain('trigger onMeetingFormSubmit.onFormSubmit()')
    expect(log).toContain('trigger onCommitmentFormSubmit.forForm("modulo-impegni")')
    expect(log).toContain('trigger onCommitmentFormSubmit.onFormSubmit()')
    expect(log).toContain('trigger onContentEdit.forSpreadsheet("foglio")')
    expect(log).toContain('trigger onContentEdit.onEdit()')
    expect(log).toContain('trigger closeUsage.everyDays(1)')
    expect(log).toContain('trigger closeUsage.atHour(1)')
    const again = await setup(
      {},
      {
        CONTENT_SHEET_ID: 'foglio',
        UPDATE_FORM_ID: 'modulo',
        MEETING_FORM_ID: 'modulo-incontri',
        COMMITMENT_FORM_ID: 'modulo-impegni',
      },
      [
        'everyTenMinutes',
        'onUpdateFormSubmit',
        'onMeetingFormSubmit',
        'onCommitmentFormSubmit',
        'onContentEdit',
        'closeUsage',
      ],
    )
    expect(again.filter((line) => line.startsWith('trigger'))).toEqual([])
  })
})

describe('la segreteria nel file unito', () => {
  const mails: unknown[] = []

  /** I servizi della pagina della segreteria: niente UrlFetchApp, così chi toccasse KV cadrebbe. */
  async function office(email: string, call: string, sheets = demoSociSheets()) {
    const { code } = await bundle('motore')
    mails.length = 0
    let locked = 0
    const context = {
      Date,
      JSON,
      console: { log: () => undefined },
      SpreadsheetApp: { openById: () => fakeSpreadsheet(sheets), flush: () => undefined },
      PropertiesService: fakeProperties({ SOCI_SHEET_ID: 'foglio-soci' }),
      Session: { getActiveUser: () => ({ getEmail: () => email }) },
      MailApp: { sendEmail: (mail: unknown) => void mails.push(mail) },
      LockService: {
        getScriptLock: () => ({ tryLock: () => (locked++, true), releaseLock: () => undefined }),
      },
      Utilities,
    }
    const result = runInNewContext(`${code}\nJSON.stringify(${call})`, context) as string
    return { result: JSON.parse(result), sheets, locked }
  }

  const payment: PaymentInput = {
    requestKey: 'schermo-vm',
    person: DEMO_OFFICE.treasurer,
    memberNumber: '18',
    amount: '30',
    method: 'transfer',
    date: '2026-10-01',
    reference: '4242',
    collectedBy: '',
    note: '',
    notADuplicate: false,
  }

  it('doGet serve la pagina della segreteria, col titolo e la riga viewport', async () => {
    const { code } = await bundle('motore')
    const log: string[] = []
    const HtmlService = {
      createHtmlOutput: (html: string) => recorder(log, html === officePageHtml() ? 'la pagina' : 'un’altra pagina'),
    }
    runInNewContext(`${code}\ndoGet()`, { HtmlService })
    expect(log).toEqual([
      'la pagina.setTitle("Segreteria · Bussola")',
      'la pagina.addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")',
    ])
  })

  it('apre la pagina solo a chi è in «Accessi»', async () => {
    expect((await office('curioso@example.org', 'officeOpen("")')).result).toEqual({
      kind: 'noAccess',
      email: 'curioso@example.org',
    })
    expect((await office(DEMO_SHARED_ACCOUNT, 'officeOpen()')).result).toEqual({
      kind: 'whoAreYou',
      names: [DEMO_OFFICE.partTime, DEMO_OFFICE.treasurer],
    })
    const { result } = await office(DEMO_EMAILS.office, 'officeOpen()')
    expect(result).toMatchObject({ kind: 'ok', view: { person: DEMO_OFFICE.secretary, isSecretary: true } })
    expect(result.view.members).toHaveLength(20)
  })

  it('registra un pagamento senza KV, dentro il lucchetto, e manda la mail', async () => {
    const { result, sheets, locked } = await office(
      DEMO_SHARED_ACCOUNT,
      `officeRecordPayment(${JSON.stringify(payment)})`,
    )
    expect(result).toMatchObject({ kind: 'recorded', mail: 'sent', payment: { recordedBy: DEMO_OFFICE.treasurer } })
    expect(result.payment.id).toMatch(/^P-\d{4}-\d{4}$/)
    expect(locked).toBe(1)
    const row = (sheets[SOCI_SHEETS.payments.name] ?? []).at(-1)
    // Il riferimento si scrive come testo, l'anno e l'importo come numeri.
    expect(row?.slice(1, 7)).toEqual([18, 2026, 30, '2026-10-01', 'bonifico', "'4242"])
    expect(mails).toEqual([
      expect.objectContaining({
        to: 'elisa.santoro@example.org',
        name: 'Segreteria RAMI',
        replyTo: 'segreteria@retemicrofarm.it',
        subject: 'Quota ricevuta, sei in regola',
      }),
    ])
  })

  it('il tesoriere conferma un pagamento in attesa: conta, e al socio parte la ricevuta', async () => {
    const { result, sheets } = await office(
      DEMO_SHARED_ACCOUNT,
      `officeConfirmPayment(${JSON.stringify({ person: DEMO_OFFICE.treasurer, paymentId: 'P-2026-0007' })})`,
    )
    expect(result).toMatchObject({ kind: 'done', mail: 'sent' })
    expect(result.view.dashboard.pendingTreasurer).toEqual([])
    const row = (sheets[SOCI_SHEETS.payments.name] ?? []).find((candidate) => candidate[0] === 'P-2026-0007')
    expect(row?.[SOCI_SHEETS.payments.columns.indexOf('stato')]).toBe('registrato')
    expect(mails).toEqual([expect.objectContaining({ to: 'giorgio.mancini@example.org' })])
  })

  it('«Oggi» arriva con la vista: i pagamenti da seguire e, senza il Foglio contenuti, lo dice', async () => {
    const { result } = await office(DEMO_EMAILS.office, 'officeOpen()')
    expect(result.view.dashboard).toMatchObject({
      matchedLines: 3,
      lastRecording: { id: 'P-2026-0007' },
      contentProblem: 'Il Foglio contenuti non è collegato.',
      publication: { pendingSince: '', error: '' },
    })
    expect(result.view.dashboard.cashToDeliver.total).toBe(60)
  })

  it('un Foglio scritto male torna come errore in italiano, non come eccezione', async () => {
    const sheets = demoSociSheets()
    delete sheets[SOCI_SHEETS.access.name]
    expect((await office(DEMO_EMAILS.office, 'officeOpen()', sheets)).result).toEqual({
      kind: 'error',
      message: 'Manca la scheda «Accessi».',
    })
  })

  async function edit(sheetName: string, user: string, cells: { rows: number; columns: number }) {
    const { code } = await bundle('motore')
    const sheets = demoSociSheets()
    const event = {
      triggerUid: 'uid-onAccessEdit',
      source: fakeSpreadsheet(sheets),
      user: { getEmail: () => user },
      oldValue: 'no',
      value: 'sì',
      range: {
        getSheet: () => ({ getName: () => sheetName }),
        getA1Notation: () => (cells.rows === 1 && cells.columns === 1 ? 'D3' : 'A5:B5'),
        getNumRows: () => cells.rows,
        getNumColumns: () => cells.columns,
        getDisplayValues: () => [['Lia Rossi', 'lia@example.org']],
      },
    }
    // Nel trigger del Foglio l'account attivo può essere chi modifica: passa per il triggerUid.
    const context = {
      Date,
      event,
      Utilities,
      Session: fakeSession(user),
      ScriptApp: { getProjectTriggers: () => fakeTriggers(['onAccessEdit']) },
    }
    runInNewContext(`${code}\nonAccessEdit(event)`, context)
    return (sheets[SOCI_SHEETS.accessLog.name] ?? []).slice(3)
  }

  it('il trigger di «Accessi» scrive il registro; le altre schede no', async () => {
    const [single] = await edit('Accessi', '', { rows: 1, columns: 1 })
    expect(single?.slice(1)).toEqual(['non noto', 'D3', 'no', 'sì'])
    expect(single?.[0]).toBeInstanceOf(Date)
    const [many] = await edit('Accessi', DEMO_EMAILS.office, { rows: 1, columns: 2 })
    expect(many?.slice(1)).toEqual([DEMO_EMAILS.office, 'A5:B5', '', 'Lia Rossi · lia@example.org'])
    expect(await edit('Soci', DEMO_EMAILS.office, { rows: 1, columns: 1 })).toEqual([])
  })

  it('il controllo di ogni giorno salva le condivisioni fuori dall’elenco nelle proprietà', async () => {
    const { code } = await bundle('motore')
    const properties: Record<string, string> = {
      SOCI_SHEET_ID: 'foglio-soci',
      CONTENT_SHEET_ID: 'foglio-contenuti',
      LIBRO_SOCI_FOLDER_ID: 'libro',
    }
    const users = (...emails: string[]) => emails.map((email) => ({ getEmail: () => email }))
    const item = (editors: string[], access = 'PRIVATE') => ({
      getEditors: () => users(...editors),
      getViewers: () => [],
      getSharingAccess: () => access,
      getSharingPermission: () => 'VIEW',
    })
    // La cartella «Bussola» resta nel Drive di RAMI: l'indirizzo della segreteria ci può stare (ADR 0004).
    const folder = item(['segreteria@example.org', 'Segreteria@retemicrofarm.it'], 'DOMAIN_WITH_LINK')
    const context = {
      Date,
      JSON,
      console: { log: () => undefined },
      SpreadsheetApp: {
        openById: (id: string) =>
          fakeSpreadsheet(id === 'foglio-contenuti' ? demoSheets(new Date()) : demoSociSheets()),
      },
      PropertiesService: fakeProperties(properties),
      Session: fakeSession(''),
      ScriptApp: { getProjectTriggers: () => fakeTriggers(['checkOfficeSharing']) },
      DriveApp: {
        getFileById: () => ({
          ...item(['segreteria@example.org', 'segreteria@retemicrofarm.it', 'curioso@example.org']),
          getParents: () => ({ next: () => folder }),
        }),
        getFolderById: () => item([DEMO_EMAILS.board, 'altro@example.org']),
      },
      Utilities,
    }
    runInNewContext(`${code}\ncheckOfficeSharing({ triggerUid: 'uid-checkOfficeSharing' })`, context)
    expect(JSON.parse(properties['segreteria:condivisioni'] ?? '{}').findings).toEqual([
      { where: 'il Foglio soci', account: 'curioso@example.org', access: 'modifica' },
      { where: 'la cartella «Bussola»', account: 'chi è nel dominio', access: 'lettura' },
      { where: 'la cartella «Libro soci»', account: 'altro@example.org', access: 'modifica' },
    ])
  })
})

describe('la preparazione del Foglio soci nel file unito', () => {
  /** `owner` è il proprietario del Foglio soci: `null` se Drive non lo dà, come in un Drive condiviso. */
  async function setupSoci(
    sheets: Sheets,
    triggers: string[] = [],
    protectedSheets: string[] = [],
    owner: string | null = BUSSOLA_ACCOUNT,
  ) {
    const { code } = await bundle('motore')
    const log: string[] = []
    const lines: string[] = []
    const extras: Extras = { validations: {}, formats: {}, protected: protectedSheets, log }
    const context = {
      Date,
      console: { log: (line: string) => void lines.push(line) },
      SpreadsheetApp: {
        openById: () => fakeSpreadsheet(sheets, extras),
        newDataValidation: () => ({ requireValueInList: (values: string[]) => ({ build: () => values }) }),
        ProtectionType: { SHEET: 'SHEET' },
      },
      ScriptApp: {
        getProjectTriggers: () => fakeTriggers(triggers),
        newTrigger: (name: string) => recorder(log, `trigger ${name}`),
      },
      PropertiesService: fakeProperties({ SOCI_SHEET_ID: 'foglio-soci' }),
      Session: fakeSession(),
      DriveApp: {
        getFileById: (id: string) => ({
          getOwner: () => (id === 'foglio-soci' && owner ? { getEmail: () => owner } : null),
        }),
      },
      Utilities,
    }
    runInNewContext(`${code}\nsetupSoci()`, context)
    return { log, extras, lines }
  }

  it('crea le schede che mancano, con le intestazioni e le impostazioni di partenza', async () => {
    const sheets: Sheets = {}
    await setupSoci(sheets)
    expect(Object.keys(sheets)).toEqual(Object.values(SOCI_SHEETS).map((spec) => spec.name))
    for (const spec of Object.values(SOCI_SHEETS)) expect(sheets[spec.name]?.[0]).toEqual([...spec.columns])
    expect(sheets[SOCI_SHEETS.settings.name]?.slice(1)).toEqual([
      ['giorno di cambio anno', "'15/10", ''],
      ['la regola di ottobre vale anche per chi rinnova in ritardo', 'no', ''],
      ['fine della grazia', "'31/3", ''],
      ['importo della quota', 30, ''],
      ['IBAN', '', ''],
      ['causale', 'tesseramento socio <anno> n. <numero>', ''],
      ['per i contanti, la mail fa da ricevuta', 'sì', ''],
      ['link alle Istruzioni della segreteria', '', ''],
      ['legge il Foglio soci', '', 'chi cura la Bussola: scrivi la sua mail'],
    ])
    expect(sheets[SOCI_SHEETS.settings.name]).toHaveLength(Object.keys(OFFICE_SETTINGS).length + 1)
  })

  it('mette le convalide a elenco nelle colonne a scelta', async () => {
    const { extras } = await setupSoci({})
    expect(extras.validations).toEqual({
      'Soci!C6': ['professionista', 'sostenitore'],
      'Pagamenti!C6': ['bonifico', 'contanti', 'libro soci'],
      'Pagamenti!C13': ['registrato', 'in attesa del tesoriere', 'annullato'],
      'Accessi!C3': ['segretario', 'segreteria part-time', 'tesoriere'],
      'Accessi!C4': ['sì', 'no'],
      'Accessi!C5': ['sì', 'no'],
      'Accessi!C6': ['sì', 'no'],
      'Registro privacy!C2': ['richiesta', 'violazione'],
    })
  })

  it('protegge il «Registro di Accessi»: niente editori, niente dominio', async () => {
    const { log, extras, lines } = await setupSoci({})
    expect(extras.protected).toEqual(['Registro di Accessi'])
    expect(log).toContain(
      'protezione Registro di Accessi.setDescription("Lo scrive solo il motore, con l’account della Bussola.")',
    )
    expect(lines.join('\n')).toContain(
      'Scheda «Registro di Accessi» protetta: la modificano solo il proprietario e l’account della Bussola.',
    )
    expect(log).toContain('protezione Registro di Accessi.removeEditors(["editore@example.org"])')
    expect(log).toContain('protezione Registro di Accessi.setDomainEdit(false)')
  })

  it('l’account della Bussola resta editore del registro, prima di togliere gli altri', async () => {
    const { log } = await setupSoci({})
    const added = log.indexOf(`protezione Registro di Accessi.addEditor("${BUSSOLA_ACCOUNT}")`)
    expect(added).toBeGreaterThanOrEqual(0)
    expect(added).toBeLessThan(log.indexOf('protezione Registro di Accessi.removeEditors(["editore@example.org"])'))
  })

  it('avvisa se il Foglio soci non è dell’account della Bussola, e dice qual è', async () => {
    const { lines } = await setupSoci({}, [], [], 'segreteria@example.org')
    expect(lines[0]).toBe(
      'Attenzione: il Foglio soci è di segreteria@example.org, non dell’account della Bussola ' +
        '(amministratore.bussola@example.org). Spostane la proprietà, poi rilancia setupSoci.',
    )
    const mine = await setupSoci({}, [], [], ' Amministratore.Bussola@Example.org')
    expect(mine.lines.join('\n')).not.toContain('Attenzione')
    const unknown = await setupSoci({}, [], [], null)
    expect(unknown.lines.join('\n')).not.toContain('Attenzione')
  })

  it('accende i due trigger, una volta sola', async () => {
    const { log } = await setupSoci({})
    expect(log).toContain('trigger onAccessEdit.forSpreadsheet("foglio")')
    expect(log).toContain('trigger onAccessEdit.onEdit()')
    expect(log).toContain('trigger checkOfficeSharing.everyDays(1)')
    const again = await setupSoci({}, ['onAccessEdit', 'checkOfficeSharing'], ['Registro di Accessi'])
    expect(again.log).toEqual([])
  })

  it('non tocca le schede che ci sono già', async () => {
    const sheets = demoSociSheets()
    const before = JSON.stringify(sheets)
    const { log, extras } = await setupSoci(sheets, ['onAccessEdit', 'checkOfficeSharing'], ['Registro di Accessi'])
    expect(JSON.stringify(sheets)).toBe(before)
    expect(extras.validations).toEqual({})
    expect(log).toEqual([])
  })
})

describe('la migrazione del libro soci nel file unito', () => {
  async function migrate(call: 'previewMemberRegister' | 'migrateMemberRegister') {
    const { code } = await bundle('motore')
    const sheets: Sheets = {
      [SOCI_SHEETS.members.name]: [[...SOCI_SHEETS.members.columns]],
      [SOCI_SHEETS.payments.name]: [[...SOCI_SHEETS.payments.columns]],
      [SOCI_SHEETS.settings.name]: [[...SOCI_SHEETS.settings.columns]],
      'Libro soci di oggi': [
        ['N. socio', 'Cognome', 'Nome', 'Quota 2026'],
        [1, 'Rossi', 'Anna', '✓'],
      ],
    }
    const context = {
      Date,
      console: { log: () => undefined },
      SpreadsheetApp: { openById: () => fakeSpreadsheet(sheets), flush: () => undefined },
      PropertiesService: fakeProperties({ SOCI_SHEET_ID: 'foglio-soci' }),
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
      Session: fakeSession(),
      Utilities,
    }
    runInNewContext(`${code}\n${call}()`, context)
    return sheets
  }

  it('la prova scrive solo il resoconto, nella scheda «Migrazione»', async () => {
    const sheets = await migrate('previewMemberRegister')
    const report = (sheets['Migrazione'] ?? []).map((row) => String(row[0]))
    expect(report[0]).toMatch(/^Prova del /)
    expect(report[report.length - 1]).toBe('Prova: non ho scritto niente. Per scrivere, lancia migrateMemberRegister.')
    expect(sheets[SOCI_SHEETS.members.name]).toHaveLength(1)
  })

  it('la migrazione vera scrive «Soci» e «Pagamenti», e rifà il resoconto da capo', async () => {
    const sheets = await migrate('migrateMemberRegister')
    expect(sheets[SOCI_SHEETS.members.name]?.slice(1).map((row) => row.slice(0, 3))).toEqual([[1, 'Rossi', 'Anna']])
    expect(sheets[SOCI_SHEETS.payments.name]).toHaveLength(2)
    const report = (sheets['Migrazione'] ?? []).map((row) => String(row[0]))
    expect(report[0]).toMatch(/^Migrazione del /)
    expect(report[report.length - 1]).toBe('Soci scritti in «Soci»: 1. Pagamenti scritti in «Pagamenti»: 1.')
  })
})
