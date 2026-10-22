import { normalizeEmail, romeDate } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { bundle } from './build.ts'
import { CALLER_REFUSED } from './src/callers.ts'
import { SHEETS } from './src/content.ts'
import { DEMO_CODES, DEMO_EMAILS, demoSheets } from './src/demo.ts'
import { DEMO_OFFICE, DEMO_SHARED_ACCOUNT, demoSociSheets } from './src/demo-soci.ts'
import { UPDATE_FORM } from './src/form.ts'
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
      'doGet',
      'everyTenMinutes',
      'migrateMemberRegister',
      'officeCancelPayment',
      'officeChangeYear',
      'officeOpen',
      'officePreview',
      'officeRecordPayment',
      'onAccessEdit',
      'onUpdateFormSubmit',
      'previewMemberRegister',
      'publishHello',
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
  formatDate: (date: Date) => romeDate(date),
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

/** L'account che fa girare lo script: la web app e i trigger sono «Esegui come: io» di segreteria@. */
const SECRETARY = 'segreteria@example.org'

/** Session: dall'editor l'account attivo è segreteria@; da `google.script.run` o da un trigger può essere un altro. */
function fakeSession(active: string = SECRETARY) {
  return {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => SECRETARY }),
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
  const TRIGGERS = ['checkOfficeSharing', 'everyTenMinutes', 'onAccessEdit', 'onUpdateFormSubmit']
  // Le funzioni che si lanciano solo dall'editor, con l'account della segreteria.
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
      ScriptApp: { getProjectTriggers: () => fakeTriggers(TRIGGERS), newTrigger: () => beyond },
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

  it('dall’editor, con l’account della segreteria, passano tutte', async () => {
    for (const name of [...TRIGGERS, ...EDITOR])
      expect([name, await call(name, ' Segreteria@Example.org', {})]).toEqual([name, PASSED])
  })
})

describe('un giro del motore nel file unito', () => {
  const now = new Date('2026-10-31T17:50:00Z')
  const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

  async function run() {
    const { code } = await bundle('motore')
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
    const puts: { url: string; payload: string }[] = []
    const context = {
      Date,
      console: { log: () => undefined },
      SpreadsheetApp: { openById: () => fakeSpreadsheet(sheets) },
      FormApp: { openById: () => form },
      PropertiesService: fakeProperties(properties),
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
      // Il trigger dei 10 minuti: nessun account attivo, il suo triggerUid.
      Session: fakeSession(''),
      ScriptApp: { getProjectTriggers: () => fakeTriggers(['everyTenMinutes']) },
      UrlFetchApp: {
        fetch: (url: string, params: { payload: string }) => {
          puts.push({ url, payload: params.payload })
          return { getResponseCode: () => 200, getContentText: () => '{}' }
        },
      },
      Utilities,
    }
    runInNewContext(`${code}\neveryTenMinutes({ triggerUid: 'uid-everyTenMinutes' })`, context)
    return { sheets, puts, properties }
  }

  it('applica la risposta del Modulo e pubblica l’istantanea riservata su KV', async () => {
    const { sheets, puts } = await run()
    const projects = sheets[SHEETS.projects.name] ?? []
    expect(projects[1]?.[3]).toBe('in chiusura')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.url).toMatch(/\/accounts\/acc123\/storage\/kv\/namespaces\/ns456\/values\/v1%2Friservata\.json$/)
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

  it('scrive «Salute»', async () => {
    const { sheets } = await run()
    expect((sheets[SHEETS.health.name] ?? []).slice(1).map((row) => row[0])).toEqual([
      'Foglio «Bussola · contenuti»',
      'Modulo «Aggiorna il cantiere»',
      'Istantanea riservata (v1/riservata.json)',
      'Lista di Access (Persone della Riservata)',
    ])
  })

  it('pubblica le scadenze, le delibere, le questioni e il budget, con le date di Roma', async () => {
    const { puts } = await run()
    const snapshot = JSON.parse(puts[0]?.payload ?? '{}')
    expect(snapshot.deadlines).toHaveLength(8)
    expect(snapshot.resolutions).toHaveLength(7)
    expect(snapshot.resolutions[0]).toMatchObject({ date: '2026-10-21', body: 'Coordinamento' })
    expect(snapshot.issues).toHaveLength(3)
    expect(snapshot.budget).toMatchObject({ updatedOn: '2026-10-22' })
  })
})

describe('la preparazione nel file unito', () => {
  async function setup(
    sheets: Sheets,
    properties: Record<string, string>,
    triggers: string[] = [],
    extras: Extras = { validations: {}, formats: {} },
    formDescription: string = UPDATE_FORM.description,
  ) {
    const { code } = await bundle('motore')
    const log: string[] = []
    const context = {
      Date,
      console: { log: () => undefined },
      SpreadsheetApp: {
        openById: () => fakeSpreadsheet(sheets, extras),
        // La regola è l'elenco dei valori ammessi.
        newDataValidation: () => ({ requireValueInList: (values: string[]) => ({ build: () => values }) }),
      },
      FormApp: {
        create: (title: string) => recorder(log, `modulo «${title}»`, { getId: 'modulo-nuovo' }),
        openById: (id: string) => recorder(log, `modulo ${id}`, { getDescription: formDescription }),
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
    expect(sheets[SHEETS.settings.name]?.[1]).toEqual(['giorni per fermo', 30])
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
      'Cantieri!C4': ['avvio', 'in corso', 'in revisione', 'in chiusura', 'chiuso'],
      'Scadenze!C3': ['bando', 'adempimento', 'fiscale', 'evento', 'Assemblea', 'misura'],
      'Delibere!C3': ['Direttivo', 'Coordinamento', 'Assemblea'],
      'Questioni!C5': ['aperta', 'chiusa'],
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

  it('a un Modulo che c’è già rimette la descrizione, col link all’informativa', async () => {
    const properties = { CONTENT_SHEET_ID: 'foglio', UPDATE_FORM_ID: 'modulo' }
    const log = await setup({}, properties, [], undefined, 'Ci vuole un minuto.')
    expect(log).toContain(`modulo modulo.setDescription(${JSON.stringify(UPDATE_FORM.description)})`)
    const again = await setup({}, properties)
    expect(again.filter((line) => line.includes('setDescription'))).toEqual([])
  })

  it('accende i due trigger, una volta sola', async () => {
    const log = await setup({}, { CONTENT_SHEET_ID: 'foglio' })
    expect(log).toContain('trigger everyTenMinutes.everyMinutes(10)')
    expect(log).toContain('trigger onUpdateFormSubmit.onFormSubmit()')
    const again = await setup({}, { CONTENT_SHEET_ID: 'foglio', UPDATE_FORM_ID: 'modulo' }, [
      'everyTenMinutes',
      'onUpdateFormSubmit',
    ])
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
        subject: 'Quota ricevuta, sei in regola',
      }),
    ])
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
    const folder = item(['segreteria@example.org'], 'DOMAIN_WITH_LINK')
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
          ...item(['segreteria@example.org', 'curioso@example.org']),
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
    owner: string | null = SECRETARY,
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
      ['causale', 'Quota RAMI <anno> socio n. <numero>', ''],
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
    const { log, extras } = await setupSoci({})
    expect(extras.protected).toEqual(['Registro di Accessi'])
    expect(log).toContain('protezione Registro di Accessi.removeEditors(["editore@example.org"])')
    expect(log).toContain('protezione Registro di Accessi.setDomainEdit(false)')
  })

  it('l’account della segreteria resta editore del registro, prima di togliere gli altri', async () => {
    const { log } = await setupSoci({})
    const added = log.indexOf(`protezione Registro di Accessi.addEditor("${SECRETARY}")`)
    expect(added).toBeGreaterThanOrEqual(0)
    expect(added).toBeLessThan(log.indexOf('protezione Registro di Accessi.removeEditors(["editore@example.org"])'))
  })

  it('avvisa se il Foglio soci non è dell’account della segreteria', async () => {
    const { lines } = await setupSoci({}, [], [], 'presidente@example.org')
    expect(lines[0]).toBe(
      'Attenzione: il Foglio soci è di presidente@example.org, non dell’account della segreteria. ' +
        'Spostane la proprietà, poi rilancia setupSoci.',
    )
    const mine = await setupSoci({}, [], [], ' Segreteria@Example.org')
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
