import { MEMBERS_KEY, parseMembersSnapshot, romeDate } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readTable } from './content.ts'
import { DEMO_SOCI_COUNTS, DEMO_SOCI_TODAY, demoSociSheets } from './demo-soci.ts'
import { readMembers, readOfficeSettings, readPayments, SOCI_SHEETS } from './members.ts'
import {
  buildMembersSnapshot,
  MEMBERS_PUBLICATION_KEY,
  MEMBERS_SHAPE,
  publishMembersSnapshot,
  readMembersPublication,
  readMembersSheets,
} from './members-snapshot.ts'
import { memoryKv, memoryState, memoryWorkbook } from './memory.ts'
import { findViolations } from './snapshots.ts'

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const workbook = memoryWorkbook(demoSociSheets())
const members = readMembers(readTable(workbook, SOCI_SHEETS.members), romeDate)
const payments = readPayments(readTable(workbook, SOCI_SHEETS.payments), romeDate)
const settings = readOfficeSettings(readTable(workbook, SOCI_SHEETS.settings), romeDate)

describe('buildMembersSnapshot', () => {
  it('porta i conteggi per stato del conto a mano e, da gennaio ad aprile, la riga dei rinnovi', () => {
    const content = buildMembersSnapshot(members, payments, settings.dues, DEMO_SOCI_TODAY)
    expect(content).toEqual({ version: 1, asOf: DEMO_SOCI_TODAY, counts: DEMO_SOCI_COUNTS, renewals: null })
    const february = buildMembersSnapshot(members, payments, settings.dues, '2027-02-01')
    // I soci 2026 non receduti sono 13 (11 in regola e i 2 con la quota 2026 e 2027: Pace; Galli e Greco no):
    // 1, 3, 6, 11, 12, 13, 14, 15, 16, 19, 20; con la quota 2027 entro il 31/3 solo Pace (16).
    expect(february.renewals).toEqual({ year: 2027, renewed: 1, base: 11, percent: 9, until: '03-31' })
  })

  it('non contiene nomi, mail, telefoni né numeri socio: solo numeri aggregati', () => {
    const content = buildMembersSnapshot(members, payments, settings.dues, '2027-02-01')
    const text = JSON.stringify(content)
    for (const member of members) {
      expect(text).not.toContain(member.lastName)
      expect(text).not.toContain(member.firstName)
      if (member.email) expect(text).not.toContain(member.email)
    }
    expect(text).not.toContain('@')
    expect(findViolations({ ...content, publishedAt: new Date().toISOString() }, MEMBERS_SHAPE)).toEqual([])
    expect(parseMembersSnapshot({ ...content, publishedAt: new Date().toISOString() })).not.toBeNull()
  })

  it('un campo fuori dalla lista ammessa, come un elenco di nomi, ferma la pubblicazione', () => {
    const content = buildMembersSnapshot(members, payments, settings.dues, DEMO_SOCI_TODAY)
    const wrong = { ...content, names: ['Anna Esposito'] }
    expect(findViolations({ ...wrong, publishedAt: new Date().toISOString() }, MEMBERS_SHAPE)).toEqual([
      'names: campo fuori dalla lista ammessa',
    ])
    const kv = memoryKv()
    const state = memoryState()
    const result = publishMembersSnapshot(
      { kv, state, sha256Hex, now: new Date('2026-11-05T10:00:00Z'), scope: 'prova', today: DEMO_SOCI_TODAY },
      wrong,
    )
    expect(result.status).toBe('failed')
    expect(kv.writes).toEqual([])
    expect(readMembersPublication(state)).toMatchObject({ pendingSince: DEMO_SOCI_TODAY })
    expect(readMembersPublication(state).error).toContain('names')
  })

  describe('con righe vere nel Registro privacy', () => {
    // Una richiesta e una violazione come le scriverebbe la segreteria: nomi, fatti e date che non devono uscire.
    const { privacyLog } = SOCI_SHEETS
    const privacyRows = [
      ['2026-09-14', 'richiesta', 'socio n. 12, Marta Bianchi', 'Cancellato il telefono dal libro soci', '2026-09-16'],
      ['2026-10-03', 'violazione', 'Mail ai soci con i destinatari in chiaro', 'Avvisati i 41 soci, Garante no', ''],
    ]
    const privacyTexts = privacyRows.flatMap((row) => row.slice(1).filter((cell) => cell.length > 3))
    const sheets = demoSociSheets()
    const withPrivacy = memoryWorkbook({ ...sheets, [privacyLog.name]: [[...privacyLog.columns], ...privacyRows] })

    it('dal Foglio a KV, l’istantanea non porta niente del registro', () => {
      expect(readTable(withPrivacy, privacyLog).rows).toHaveLength(2)
      const read = readMembersSheets(withPrivacy, romeDate)
      const kv = memoryKv()
      for (const today of [DEMO_SOCI_TODAY, '2027-02-01']) {
        const content = buildMembersSnapshot(read.members, read.payments, read.settings.dues, today)
        const result = publishMembersSnapshot(
          { kv, state: memoryState(), sha256Hex, now: new Date(`${today}T10:00:00Z`), scope: 'prova', today },
          content,
        )
        expect(result.status).toBe('written')
        const published = kv.values.get(MEMBERS_KEY) ?? ''
        for (const text of privacyTexts) expect(published).not.toContain(text)
        for (const date of ['2026-09-14', '2026-09-16', '2026-10-03']) expect(published).not.toContain(date)
      }
    })

    it('un campo che ne viene ferma la pubblicazione, anche dentro un campo ammesso', () => {
      const content = buildMembersSnapshot(members, payments, settings.dues, '2027-02-01')
      const renewals = content.renewals ?? { year: 2027, renewed: 0, base: 0, percent: 0, until: '03-31' }
      for (const wrong of [
        { ...content, privacy: privacyRows },
        { ...content, renewals: { ...renewals, until: privacyTexts[1] ?? '' } },
      ]) {
        const kv = memoryKv()
        const state = memoryState()
        const deps = {
          kv,
          state,
          sha256Hex,
          now: new Date('2027-02-01T10:00:00Z'),
          scope: 'prova',
          today: '2027-02-01',
        }
        expect(publishMembersSnapshot(deps, wrong).status).toBe('failed')
        expect(kv.writes).toEqual([])
        for (const text of privacyTexts) expect(readMembersPublication(state).error).not.toContain(text)
      }
    })
  })

  it('legge le tre schede del Foglio soci in un colpo', () => {
    const sheets = readMembersSheets(workbook, romeDate)
    expect(sheets.members).toEqual(members)
    expect(sheets.payments).toEqual(payments)
    expect(sheets.settings).toEqual(settings)
  })
})

describe('publishMembersSnapshot', () => {
  const content = buildMembersSnapshot(members, payments, settings.dues, DEMO_SOCI_TODAY)
  const now = new Date('2026-11-05T10:00:00Z')

  it('scrive v1/soci.json su KV, e la seconda volta uguale non scrive', () => {
    const kv = memoryKv()
    const state = memoryState()
    const deps = { kv, state, sha256Hex, now, scope: 'prova', today: DEMO_SOCI_TODAY }
    expect(publishMembersSnapshot(deps, content)).toEqual({ key: MEMBERS_KEY, status: 'written' })
    expect(JSON.parse(kv.values.get(MEMBERS_KEY) ?? '{}')).toEqual({ ...content, publishedAt: now.toISOString() })
    expect(publishMembersSnapshot(deps, content)).toEqual({ key: MEMBERS_KEY, status: 'unchanged' })
    expect(readMembersPublication(state)).toEqual({ pendingSince: '', error: '' })
  })

  it('con KV irraggiungibile ricorda da quando, e al primo giro buono lo cancella', () => {
    const kv = memoryKv()
    const state = memoryState()
    kv.down = true
    const deps = { kv, state, sha256Hex, now, scope: 'prova', today: DEMO_SOCI_TODAY }
    expect(publishMembersSnapshot(deps, content).status).toBe('failed')
    expect(readMembersPublication(state)).toEqual({
      pendingSince: DEMO_SOCI_TODAY,
      error: 'KV ha risposto 503 scrivendo v1/soci.json: Service Unavailable',
    })
    // Un altro tentativo caduto tiene il primo giorno.
    expect(publishMembersSnapshot({ ...deps, today: '2026-11-06' }, content).status).toBe('failed')
    expect(readMembersPublication(state).pendingSince).toBe(DEMO_SOCI_TODAY)
    kv.down = false
    expect(publishMembersSnapshot({ ...deps, today: '2026-11-06' }, content).status).toBe('written')
    expect(readMembersPublication(state)).toEqual({ pendingSince: '', error: '' })
    expect(state.get(MEMBERS_PUBLICATION_KEY) ?? '').toBe('')
  })
})
