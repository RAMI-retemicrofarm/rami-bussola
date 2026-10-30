import { describe, expect, it } from 'vitest'
import {
  bankLineKey,
  memberNumberInReason,
  reconcile,
  referenceMatches,
  splitPasted,
  type BankLine,
  type ReconcilePayment,
} from './reconcile.ts'

const today = '2026-11-05'
let seq = 0
const line = (fields: Partial<BankLine> & { date: string; amount: number | null }): BankLine => ({
  index: ++seq,
  reason: 'Quota RAMI 2026',
  reference: '',
  matchedTo: '',
  ignoredWhy: '',
  ...fields,
})
const payment = (fields: Partial<ReconcilePayment> & { id: string }): ReconcilePayment => ({
  memberNumber: '2',
  validYear: 2026,
  amount: 30,
  date: '2026-10-20',
  method: 'transfer',
  reference: '',
  status: 'recorded',
  recordedBy: 'Ugo Bassi',
  recordedOn: '2026-10-21',
  ...fields,
})
const ids = (result: ReturnType<typeof reconcile>) => ({
  matched: result.matched.map((match) => [match.line.index, match.paymentIds, match.how]),
  toMatch: result.toMatch.map((item) =>
    item.kind === 'bankWithoutPayment' ? ['banca', item.line.index, item.memberNumber] : [item.kind, item.payment.id],
  ),
  sameLines: result.sameLines.map((group) => group.map((same) => same.index)),
  amountMismatch: result.amountMismatch.map(({ line, paymentIds, registered, how }) => [
    line.index,
    paymentIds,
    registered,
    how,
  ]),
  ignored: result.ignored.map((ignored) => [ignored.line.index, ignored.why]),
})

describe('reconcile', () => {
  it('abbina per riferimento già registrato, anche con una data lontana e due quote sullo stesso bonifico', () => {
    const lines = [line({ date: '2026-11-02', amount: 60, reference: 'TRN 55001' })]
    const payments = [
      payment({ id: 'P-2026-0008', memberNumber: '13', date: '2026-02-20', reference: '55001' }),
      payment({ id: 'P-2026-0009', memberNumber: '14', date: '2026-02-20', reference: ' trn 55001 ' }),
      payment({ id: 'P-2026-0010', memberNumber: '15', date: '2026-02-20', reference: '55002' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0008', 'P-2026-0009'], 'reference']])
    expect(ids(result).toMatch).toEqual([])
    expect(ids(result).amountMismatch).toEqual([])
  })

  it('col riferimento di un pagamento ma un altro importo la riga non si abbina, nemmeno per socio: è da controllare', () => {
    const lines = [
      line({ date: '2026-10-21', amount: 25, reason: 'quota socio n. 2', reference: 'TRN 90001' }),
      line({ date: '2026-10-22', amount: 30.5, reason: 'quota', reference: 'TRN 90002' }),
    ]
    const payments = [
      payment({ id: 'P-2026-0014', memberNumber: '2', date: '2026-10-20', reference: '90001' }),
      payment({ id: 'P-2026-0015', memberNumber: '3', date: '2026-10-20', amount: 30.5, reference: '90002' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).amountMismatch).toEqual([[lines[0]?.index, ['P-2026-0014'], 30, 'reference']])
    expect(ids(result).matched).toEqual([[lines[1]?.index, ['P-2026-0015'], 'reference']])
    expect(ids(result).toMatch).toEqual([])
  })

  it('abbina per «socio n. 123» nella causale, con una data entro 7 giorni', () => {
    const lines = [
      line({ date: '2026-10-27', amount: 30, reason: 'Quota RAMI 2026 socio n. 2', reference: 'X1' }),
      line({ date: '2026-10-27', amount: 30, reason: 'quota socio n.7', reference: 'X2' }),
      line({ date: '2026-10-29', amount: 30, reason: 'socio n. 9 quota', reference: 'X3' }),
    ]
    const payments = [
      payment({ id: 'P-2026-0014', memberNumber: '2', date: '2026-10-20', reference: '0014' }),
      payment({ id: 'P-2026-0004', memberNumber: '7', date: '2026-10-20', reference: '0004' }),
      payment({ id: 'P-2026-0001', memberNumber: '9', date: '2026-01-15', reference: '0001' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([
      [lines[0]?.index, ['P-2026-0014'], 'member'],
      [lines[1]?.index, ['P-2026-0004'], 'member'],
    ])
    // Il socio 9 ha un bonifico di gennaio: a ottobre è un altro pagamento, da registrare.
    expect(ids(result).toMatch).toEqual([['banca', lines[2]?.index, '9']])
  })

  it('per «socio n.» l’importo deve tornare: con un altro importo la riga è da controllare, non abbinata', () => {
    const lines = [line({ date: '2026-10-21', amount: 300, reason: 'quota socio n. 2' })]
    const payments = [payment({ id: 'P-2026-0014', memberNumber: '2', date: '2026-10-20', reference: '' })]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([])
    expect(ids(result).amountMismatch).toEqual([[lines[0]?.index, ['P-2026-0014'], 30, 'member']])
    expect(ids(result).toMatch).toEqual([])
  })

  it('per «socio n.» un bonifico per due quote dello stesso socio torna con la somma, e prende tutte e due', () => {
    const lines = [line({ date: '2026-04-03', amount: 60, reason: 'quote 2026 e 2027 socio n. 16' })]
    const payments = [
      payment({ id: 'P-2026-0011', memberNumber: '16', date: '2026-04-02', reference: '' }),
      payment({ id: 'P-2026-0012', memberNumber: '16', validYear: 2027, date: '2026-04-02', reference: '' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0011', 'P-2026-0012'], 'member']])
    expect(ids(result).amountMismatch).toEqual([])
    // Con l'importo di una quota sola, prende la prima e lascia l'altra.
    const one = [line({ date: '2026-04-03', amount: 30, reason: 'quota socio n. 16' })]
    expect(ids(reconcile(one, payments, { today })).matched).toEqual([[one[0]?.index, ['P-2026-0011'], 'member']])
  })

  it('un bonifico in banca senza registrazione va in «Da abbinare», col numero socio se la causale lo dice', () => {
    const lines = [line({ date: '2026-11-02', amount: 30, reason: 'quota Verdi' })]
    const result = reconcile(lines, [], { today })
    expect(ids(result).toMatch).toEqual([['banca', lines[0]?.index, null]])
  })

  it('il riferimento vince sulla causale: lo stesso pagamento non si abbina due volte', () => {
    const lines = [
      line({ date: '2026-10-21', amount: 30, reason: 'socio n. 2', reference: 'AAAAA' }),
      line({ date: '2026-10-22', amount: 30, reason: 'altro', reference: '00014' }),
    ]
    const payments = [payment({ id: 'P-2026-0014', memberNumber: '2', date: '2026-10-20', reference: '00014' })]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([[lines[1]?.index, ['P-2026-0014'], 'reference']])
    expect(ids(result).toMatch).toEqual([['banca', lines[0]?.index, '2']])
  })

  it('una registrazione di bonifico senza riga in banca va in «Da abbinare» dopo 45 giorni', () => {
    const lines = [line({ date: '2026-09-01', amount: 30, reference: 'Z' }), line({ date: '2026-11-04', amount: 30 })]
    const payments = [
      payment({ id: 'P-2026-0020', date: '2026-09-21', reference: '9020' }),
      payment({ id: 'P-2026-0021', date: '2026-09-10', reference: '9021' }),
      // Dentro i 45 giorni: la banca può ancora arrivare.
      payment({ id: 'P-2026-0022', date: '2026-10-25', reference: '9022' }),
      // Prima dell'estratto conto importato: non si può controllare.
      payment({ id: 'P-2026-0019', date: '2026-08-01', reference: '9019' }),
      // I contanti e le quote del libro soci non passano dalla banca.
      payment({ id: 'P-2026-0023', date: '2026-09-01', method: 'cash', reference: '' }),
      payment({ id: 'L-2026-0001', date: '', method: 'register', reference: '' }),
      payment({ id: 'P-2026-0024', date: '2026-09-01', reference: '9024', status: 'cancelled' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).toMatch).toEqual([
      ['banca', lines[0]?.index, null],
      ['banca', lines[1]?.index, null],
      ['paymentWithoutBank', 'P-2026-0021'],
      ['paymentWithoutBank', 'P-2026-0020'],
    ])
    const item = result.toMatch.find(
      (candidate) => candidate.kind === 'paymentWithoutBank' && candidate.payment.id === 'P-2026-0020',
    )
    expect(item?.kind === 'paymentWithoutBank' && item.daysAgo).toBe(45)
  })

  it('senza righe della banca nessuna registrazione è «senza riga in banca»', () => {
    const payments = [payment({ id: 'P-2026-0020', date: '2026-01-21', reference: '9020' })]
    expect(ids(reconcile([], payments, { today })).toMatch).toEqual([])
  })

  it('i pagamenti registrati senza socio vanno in «Da abbinare», anche se la banca torna', () => {
    const lines = [line({ date: '2026-10-25', amount: 30, reference: '00015' })]
    const payments = [
      payment({ id: 'P-2026-0015', memberNumber: '', date: '2026-10-25', reference: '00015' }),
      payment({ id: 'P-2026-0016', memberNumber: '', date: '2026-10-26', method: 'cash', reference: '' }),
      payment({ id: 'P-2026-0017', memberNumber: '', date: '2026-10-26', reference: '', status: 'cancelled' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0015'], 'reference']])
    expect(ids(result).toMatch).toEqual([
      ['paymentWithoutMember', 'P-2026-0015'],
      ['paymentWithoutMember', 'P-2026-0016'],
    ])
  })

  it('nella scheda ogni riga conta: due righe uguali, anche col riferimento, entrano tutte e due e sono da controllare', () => {
    const lines = [
      line({ date: '2026-10-21', amount: 30, reason: 'Quota socio n. 2', reference: '00014' }),
      line({ date: '2026-10-21', amount: 30, reason: ' quota SOCIO n. 2 ', reference: '00014' }),
      line({ date: '2026-10-21', amount: 30, reason: 'Quota socio n. 2', reference: '00015' }),
    ]
    const payments = [payment({ id: 'P-2026-0014', memberNumber: '2', date: '2026-10-20', reference: '00014' })]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).sameLines).toEqual([[lines[0]?.index, lines[1]?.index]])
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0014'], 'reference']])
    expect(ids(result).toMatch).toEqual([
      ['banca', lines[1]?.index, '2'],
      ['banca', lines[2]?.index, '2'],
    ])
    expect(bankLineKey(lines[0] as BankLine)).toBe(bankLineKey(lines[1] as BankLine))
  })

  it('due righe uguali possono essere due bonifici veri: entrano tutte e due, e sono da controllare; le uscite no', () => {
    const lines = [
      line({ date: '2026-11-02', amount: 30, reason: 'Quota RAMI 2026' }),
      line({ date: '2026-11-02', amount: 30, reason: 'quota rami 2026' }),
      line({ date: '2026-11-03', amount: -1.5, reason: 'Commissione' }),
      line({ date: '2026-11-03', amount: -1.5, reason: 'Commissione' }),
    ]
    const result = reconcile(lines, [], { today })
    // Due commissioni uguali lo stesso giorno sono normali: non sono pagamenti di soci.
    expect(ids(result).sameLines).toEqual([[lines[0]?.index, lines[1]?.index]])
    expect(ids(result).toMatch).toEqual([
      ['banca', lines[0]?.index, null],
      ['banca', lines[1]?.index, null],
    ])
    expect(ids(result).ignored).toEqual([
      [lines[2]?.index, 'è un’uscita'],
      [lines[3]?.index, 'è un’uscita'],
    ])
  })

  it('due righe uguali abbinate tutte e due non sono più da controllare', () => {
    const lines = [
      line({ date: '2026-11-03', amount: 30, reason: 'quota socio n. 16' }),
      line({ date: '2026-11-03', amount: 30, reason: 'quota socio n. 16' }),
    ]
    const payments = [
      payment({ id: 'P-2026-0011', memberNumber: '16', date: '2026-11-02', reference: '' }),
      payment({ id: 'P-2026-0012', memberNumber: '16', validYear: 2027, date: '2026-11-02', reference: '' }),
    ]
    const both = reconcile(lines, payments, { today })
    expect(ids(both).matched).toEqual([
      [lines[0]?.index, ['P-2026-0011'], 'member'],
      [lines[1]?.index, ['P-2026-0012'], 'member'],
    ])
    expect(ids(both).sameLines).toEqual([])
    // Con un pagamento solo, una delle due resta da abbinare, e le righe uguali sono da controllare.
    expect(ids(reconcile(lines, payments.slice(0, 1), { today })).sameLines).toEqual([
      [lines[0]?.index, lines[1]?.index],
    ])
  })

  it('due righe uguali che non si abbinano mai sono da controllare solo per 45 giorni, poi resta «Da abbinare»', () => {
    // Senza riferimento né «socio n.» non si abbinano mai: senza un limite «Niente da controllare» non tornerebbe più.
    const pair = (date: string) => [
      line({ date, amount: 30, reason: 'Bonifico quota' }),
      line({ date, amount: 30, reason: 'Bonifico quota' }),
    ]
    const recent = pair('2026-09-21')
    const old = pair('2026-09-20')
    const result = reconcile([...recent, ...old], [], { today })
    expect(ids(result).sameLines).toEqual([[recent[0]?.index, recent[1]?.index]])
    // Le righe vecchie non spariscono: restano in «Da abbinare».
    expect(ids(result).toMatch.map((item) => item[1])).toEqual([...recent, ...old].map((same) => same.index))
    expect(ids(reconcile(recent, [], { today: '2026-11-06' })).sameLines).toEqual([])
  })

  it('«socio n. 007» trova il socio 7, e un numero socio registrato con gli zeri davanti vale lo stesso', () => {
    const lines = [
      line({ date: '2026-10-21', amount: 30, reason: 'quota socio n. 007' }),
      line({ date: '2026-10-21', amount: 30, reason: 'quota socio n. 8' }),
    ]
    const payments = [
      payment({ id: 'P-2026-0007', memberNumber: '7', date: '2026-10-20' }),
      payment({ id: 'P-2026-0008', memberNumber: '008', date: '2026-10-20' }),
    ]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([
      [lines[0]?.index, ['P-2026-0007'], 'member'],
      [lines[1]?.index, ['P-2026-0008'], 'member'],
    ])
    expect(ids(reconcile([lines[0] as BankLine], [], { today })).toMatch).toEqual([['banca', lines[0]?.index, '7']])
  })

  it('le righe che non si leggono e le uscite sono ignorate, col perché', () => {
    const lines = [
      line({ date: '', amount: 30 }),
      line({ date: '2026-10-21', amount: null }),
      line({ date: '2026-10-21', amount: -12.5, reason: 'canone' }),
      line({ date: '2026-10-21', amount: 0 }),
    ]
    const result = reconcile(lines, [], { today })
    expect(ids(result).ignored).toEqual([
      [lines[0]?.index, 'la data non si legge'],
      [lines[1]?.index, 'l’importo non si legge'],
      [lines[2]?.index, 'è un’uscita'],
      [lines[3]?.index, 'l’importo è zero'],
    ])
    expect(ids(result).toMatch).toEqual([])
  })

  it('il riferimento della banca può essere più lungo di quello registrato: «TRN 55001» vale per «55001»', () => {
    expect(referenceMatches('TRN 55001', '55001')).toBe(true)
    expect(referenceMatches('55001', 'trn 55001')).toBe(true)
    expect(referenceMatches('155001', '55001')).toBe(false)
    expect(referenceMatches('', '')).toBe(false)
  })

  it('un riferimento di meno di 5 segni abbina solo se è uguale: dentro uno più lungo è troppo comune', () => {
    expect(referenceMatches('TRN 5501', '5501')).toBe(false)
    expect(referenceMatches('5501', ' 5501 ')).toBe(true)
    expect(referenceMatches('TRN 55', '55')).toBe(false)
    expect(referenceMatches(' 55001 ', '55001')).toBe(true)
  })

  it('un bonifico registrato col riferimento di 4 segni della banca si abbina alla sua riga', () => {
    // «Registra questo bonifico» copia il riferimento della riga: deve tornare su quella riga.
    const lines = [line({ date: '2026-11-02', amount: 30, reason: 'quota', reference: '8841' })]
    const payments = [payment({ id: 'P-2026-0030', memberNumber: '18', date: '2026-11-02', reference: '8841' })]
    const result = reconcile(lines, payments, { today })
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0030'], 'reference']])
    expect(ids(result).toMatch).toEqual([])
  })

  it('il numero socio nella causale', () => {
    expect(memberNumberInReason('Quota RAMI 2027 socio n. 123')).toBe('123')
    expect(memberNumberInReason('Quota socio n. 007')).toBe('7')
    expect(memberNumberInReason('QUOTA SOCIO N.7')).toBe('7')
    expect(memberNumberInReason('socio n° 42 quota')).toBe('42')
    expect(memberNumberInReason('socio numero 9')).toBe('9')
    expect(memberNumberInReason('quota 2027')).toBeNull()
    expect(memberNumberInReason('bonifico a socio')).toBeNull()
  })

  it('l’anno fra «socio» e «n.» non è il numero: «tesseramento socio 2027 n. 12» è il socio 12', () => {
    expect(memberNumberInReason('tesseramento socio 2027 n. 12')).toBe('12')
    expect(memberNumberInReason('TESSERAMENTO SOCIO 2027 NR 7')).toBe('7')
    expect(memberNumberInReason('tesseramento socio 2027')).toBeNull()
    expect(memberNumberInReason('socio 2027')).toBeNull()
    expect(memberNumberInReason('socio n. 007')).toBe('7')
    // «socio n 2027» resta il socio 2027: dopo «n» il numero è il numero socio.
    expect(memberNumberInReason('tesseramento socio n 2027')).toBe('2027')
  })

  it('il numero socio anche al femminile: «socia n. 12» è la socia 12', () => {
    expect(memberNumberInReason('socia n. 12 raduno')).toBe('12')
    expect(memberNumberInReason('tesseramento socia 2027 n° 3')).toBe('3')
    expect(memberNumberInReason('Rossi Maria socia')).toBeNull()
  })

  it('«tesseramento socio 2027 n. 12» si abbina per socio, senza riferimento uguale', () => {
    const lines = [
      line({ date: '2026-12-10', amount: 30, reason: 'tesseramento socio 2027 n. 12', reference: 'CRO 1' }),
    ]
    const payments = [payment({ id: 'P-2026-0040', memberNumber: '12', date: '2026-12-09', reference: 'CRO 99999' })]
    expect(ids(reconcile(lines, payments, { today: '2026-12-12' })).matched).toEqual([
      [lines[0]?.index, ['P-2026-0040'], 'member'],
    ])
  })
})

describe('il Raduno e le righe che non sono quote', () => {
  const raduno = 'raduno rete microfarm 2027 (solo soci)'
  const kinds = (result: ReturnType<typeof reconcile>) =>
    result.ignored.map((ignored) => [ignored.line.index, ignored.why, ignored.kind])

  it('l’iscrizione al Raduno si mette da parte col suo motivo: non va in «Da abbinare» né fra le righe uguali', () => {
    const lines = [
      line({ date: '2026-12-10', amount: 30, reason: raduno, reference: 'CRO 777' }),
      line({ date: '2026-12-10', amount: 45, reason: 'BONIFICO DA ROSSI MARIO RADUNO RETE MICROFARM 2027' }),
      line({ date: '2026-12-11', amount: 45, reason: raduno }),
      line({ date: '2026-12-11', amount: 45, reason: raduno }),
    ]
    const payments = [payment({ id: 'P-2026-0041', memberNumber: '7', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(kinds(result)).toEqual(lines.map((one) => [one.index, 'Iscrizione al Raduno', 'raduno']))
    expect(ids(result).matched).toEqual([])
    expect(ids(result).toMatch).toEqual([])
    expect(ids(result).sameLines).toEqual([])
  })

  it('una causale con «raduno» e una parola della quota segue l’abbinamento: se l’importo non torna, è da controllare', () => {
    const lines = [
      line({ date: '2026-12-10', amount: 75, reason: 'raduno 2027 e tesseramento socio 2027 n. 7' }),
      line({ date: '2026-12-10', amount: 75, reason: 'Quota e raduno 2027' }),
      line({ date: '2026-12-10', amount: 75, reason: 'raduno + tessera Bianchi' }),
    ]
    const payments = [payment({ id: 'P-2026-0042', memberNumber: '7', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(ids(result).ignored).toEqual([])
    expect(ids(result).amountMismatch).toEqual([[lines[0]?.index, ['P-2026-0042'], 30, 'member']])
    expect(ids(result).toMatch).toEqual([
      ['banca', lines[1]?.index, null],
      ['banca', lines[2]?.index, null],
    ])
  })

  it('si mette da parte solo ciò che è chiaramente il Raduno: con un segnale di quota la riga segue l’abbinamento', () => {
    const aside = (reason: string) =>
      reconcile([line({ date: '2026-12-10', amount: 45, reason })], [], { today: '2026-12-12' }).ignored.map(
        (ignored) => ignored.kind,
      )
    for (const reason of [
      raduno,
      'RADUNO RETE MICROFARM 2027',
      'iscrizione raduno rete microfarm 2027',
      'iscrizione al raduno di Cervia',
      'raduno Cervia, Rossi e Bianchi (soci)',
    ])
      expect(aside(reason), reason).toEqual(['raduno'])
    for (const reason of [
      'Raduno e rinnovo socio 12',
      'raduno socio 7',
      'raduno socio',
      'iscrizione socio 12 e raduno',
      'rinnovo iscrizione RAMI 2027 e raduno',
      'raduno cervia adesione RAMI 2027',
      'raduno rete microfarm 2027 quota partecipazione',
      'raduno e iscrizione 2027',
      // Al femminile, iscritto e associato, e il numero progressivo: la causale del Raduno non li ha.
      'socia n. 12 raduno',
      'Rossi Maria socia raduno',
      'Mario Rossi iscritto raduno',
      'Bianchi iscritta raduno 2027',
      'Rossi Mario associato raduno',
      'Rossi contributo associativo 2027 raduno',
      'Rossi n. 12 raduno',
      'raduno Verdi nr 40',
      'raduno numero 7',
    ])
      expect(aside(reason), reason).toEqual([])
  })

  it('«socia n. 12» con «raduno» si abbina alla quota registrata della socia 12', () => {
    const lines = [line({ date: '2027-01-10', amount: 30, reason: 'socia n. 12 raduno' })]
    const payments = [payment({ id: 'P-2027-0001', memberNumber: '12', validYear: 2027, date: '2027-01-09' })]
    const result = reconcile(lines, payments, { today: '2027-01-12' })
    expect(ids(result).ignored).toEqual([])
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2027-0001'], 'member']])
  })

  it('un’iscrizione al Raduno che era una quota, senza riferimento: corretta la causale nel Foglio, torna fra le quote', () => {
    const before = line({ date: '2026-12-10', amount: 30, reason: 'Rossi 2027 raduno' })
    expect(ids(reconcile([before], [], { today: '2026-12-12' })).ignored).toEqual([
      [before.index, 'Iscrizione al Raduno'],
    ])
    // La cella dice ancora «Iscrizione al Raduno» fino alla prossima importazione: è un perché dell'abbinamento.
    const after = { ...before, reason: 'Rossi 2027 quota', ignoredWhy: 'Iscrizione al Raduno' }
    const result = reconcile([after], [], { today: '2026-12-12' })
    expect(ids(result).ignored).toEqual([])
    expect(ids(result).toMatch).toEqual([['banca', after.index, null]])
  })

  it('una quota registrata pagata insieme al Raduno non sparisce: si abbina o è da controllare', () => {
    const lines = [
      line({ date: '2026-11-10', amount: 30, reason: 'Raduno e rinnovo socio 12' }),
      line({ date: '2026-11-10', amount: 75, reason: 'raduno socio n. 8 e quota' }),
    ]
    const payments = [
      payment({ id: 'P-2026-0050', memberNumber: '12', date: '2026-11-10' }),
      payment({ id: 'P-2026-0051', memberNumber: '8', date: '2026-11-10' }),
    ]
    const result = reconcile(lines, payments, { today: '2026-11-12' })
    expect(ids(result).ignored).toEqual([])
    expect(ids(result).amountMismatch).toEqual([[lines[1]?.index, ['P-2026-0051'], 30, 'member']])
    // «socio 12» senza «n.» non è un numero socio: la riga resta in «Da abbinare», dove si vede.
    expect(ids(result).toMatch).toEqual([['banca', lines[0]?.index, null]])
  })

  it('il riferimento viene prima del Raduno: un bonifico già registrato con quel riferimento si abbina', () => {
    const lines = [line({ date: '2026-11-10', amount: 30, reason: 'raduno', reference: 'CRO 55555' })]
    const payments = [payment({ id: 'P-2026-0052', memberNumber: '7', date: '2026-11-10', reference: 'CRO 55555' })]
    const result = reconcile(lines, payments, { today: '2026-11-12' })
    expect(ids(result).ignored).toEqual([])
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0052'], 'reference']])
    const cancelled = [{ ...(payments[0] as ReconcilePayment), status: 'cancelled' as const }]
    expect(ids(reconcile(lines, cancelled, { today: '2026-11-12' })).ignored).toEqual([
      [lines[0]?.index, 'Iscrizione al Raduno'],
    ])
  })

  it('«Iscrizione al Raduno» nella scheda è un perché dell’abbinamento: corretta la causale, la riga si abbina', () => {
    const lines = [
      line({
        date: '2026-12-10',
        amount: 30,
        reason: 'tesseramento socio 2027 n. 12',
        ignoredWhy: 'Iscrizione al Raduno',
      }),
    ]
    const payments = [payment({ id: 'P-2026-0053', memberNumber: '12', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(ids(result).ignored).toEqual([])
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0053'], 'member']])
  })

  it('«Da abbinare» e «Da controllare» seguono l’ordine del Foglio, anche con le righe che parlano del Raduno', () => {
    const lines = [
      line({ date: '2026-12-10', amount: 30, reason: 'raduno socio n. 8' }),
      line({ date: '2026-12-10', amount: 30, reason: 'bonifico a' }),
      line({ date: '2026-12-10', amount: 99, reason: 'raduno socio n. 9' }),
      line({ date: '2026-12-10', amount: 98, reason: 'socio n. 9' }),
    ]
    const payments = [payment({ id: 'P-2026-0054', memberNumber: '9', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(ids(result).toMatch).toEqual([
      ['banca', lines[0]?.index, '8'],
      ['banca', lines[1]?.index, null],
    ])
    expect(ids(result).amountMismatch.map(([index]) => index)).toEqual([lines[2]?.index, lines[3]?.index])
  })

  it('il Raduno col numero socio e l’importo della quota non prende il posto della quota dello stesso socio', () => {
    const lines = [
      line({ date: '2026-12-10', amount: 30, reason: `${raduno} socio n. 7`, reference: 'CRO 780' }),
      line({ date: '2026-12-11', amount: 30, reason: 'tesseramento socio 2027 n. 7', reference: 'CRO 781' }),
    ]
    const payments = [payment({ id: 'P-2026-0043', memberNumber: '7', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(ids(result).matched).toEqual([[lines[1]?.index, ['P-2026-0043'], 'member']])
    expect(ids(result).toMatch).toEqual([['banca', lines[0]?.index, '7']])
  })

  it('una riga segnata «Non è una quota» resta da parte col suo motivo, anche se la causale ha un socio che torna', () => {
    const lines = [
      line({ date: '2026-12-10', amount: 30, reason: 'socio n. 7 magliette', ignoredWhy: 'magliette' }),
      line({ date: '2026-12-10', amount: 3850, reason: 'erogazione liberale', ignoredWhy: ' donazione ' }),
    ]
    const payments = [payment({ id: 'P-2026-0044', memberNumber: '7', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(kinds(result)).toEqual([
      [lines[0]?.index, 'magliette', 'notDues'],
      [lines[1]?.index, 'donazione', 'notDues'],
    ])
    expect(ids(result).matched).toEqual([])
    expect(ids(result).toMatch).toEqual([])
  })

  it('un perché scritto dall’abbinamento che non vale più si lascia: la cella corretta si abbina di nuovo', () => {
    const lines = [
      // La data era illeggibile, ora è corretta: «la data non si legge» nella scheda è vecchio.
      line({ date: '2026-12-10', amount: 30, reason: 'socio n. 7', ignoredWhy: 'la data non si legge' }),
      line({ date: '2026-12-10', amount: -4, reason: 'Commissione', ignoredWhy: 'è un’uscita' }),
      line({ date: '2026-12-10', amount: 0, reason: 'Storno', ignoredWhy: '' }),
      line({ date: '', amount: 30, reason: 'quota', ignoredWhy: 'donazione' }),
    ]
    const payments = [payment({ id: 'P-2026-0045', memberNumber: '7', date: '2026-12-10' })]
    const result = reconcile(lines, payments, { today: '2026-12-12' })
    expect(ids(result).matched).toEqual([[lines[0]?.index, ['P-2026-0045'], 'member']])
    expect(kinds(result)).toEqual([
      [lines[1]?.index, 'è un’uscita', 'outflow'],
      [lines[2]?.index, 'l’importo è zero', 'outflow'],
      [lines[3]?.index, 'la data non si legge', 'unreadable'],
    ])
  })
})

describe('splitPasted', () => {
  const block = (rows: [string, number, string, string][]) =>
    rows.map(([date, amount, reason, reference]) => line({ date, amount, reason, reference }))
  const noReference: [string, number, string, string][] = [
    ['2026-11-03', 30, 'Quota RAMI 2026', ''],
    ['2026-11-04', 30, 'Quota RAMI 2026', ''],
    ['2026-11-05', 30, 'Quota RAMI 2026', ''],
  ]
  const counts = (result: ReturnType<typeof splitPasted>) => [result.fresh.length, result.alreadyPasted.length]

  it('lo stesso estratto senza riferimento incollato due volte: la seconda volta è tutto già incollato', () => {
    const first = splitPasted([], block(noReference))
    expect(counts(first)).toEqual([3, 0])
    expect(counts(splitPasted(first.fresh, block(noReference)))).toEqual([0, 3])
  })

  it('due bonifici veri uguali nello stesso estratto entrano tutte e due, e reincollati non si raddoppiano', () => {
    const twice = block([
      ['2026-11-03', 30, 'Quota RAMI 2026', ''],
      ['2026-11-03', 30, ' quota rami 2026 ', ''],
    ])
    const first = splitPasted([], twice)
    expect(counts(first)).toEqual([2, 0])
    expect(counts(splitPasted(first.fresh, block([['2026-11-03', 30, 'Quota RAMI 2026', '']])))).toEqual([0, 1])
  })

  it('una riga col riferimento entra una volta sola: due copie nello stesso blocco sono un doppione', () => {
    // Un CRO o un TRN è unico per operazione: due righe uguali col riferimento sono la stessa incollata due volte.
    const one: [string, number, string, string][] = [
      ['2026-11-03', 30, 'Bonifico da ROSSI', 'REF77001'],
      ['2026-11-04', 45, 'Bonifico da BIANCHI', 'REF77002'],
    ]
    const first = splitPasted([], block([...one, ...one]))
    expect(first.fresh.map((fresh) => fresh.reference)).toEqual(['REF77001', 'REF77002'])
    expect(counts(first)).toEqual([2, 2])
    expect(counts(splitPasted(first.fresh, block([...one, ...one])))).toEqual([0, 4])
  })

  it('un estratto che si sovrappone al vecchio aggiunge solo le righe in più, anche una uguale a una vecchia', () => {
    const old = splitPasted([], block(noReference)).fresh
    const overlapping = block([
      ['2026-11-04', 30, 'Quota RAMI 2026', ''],
      ['2026-11-05', 30, 'Quota RAMI 2026', ''],
      ['2026-11-05', 30, 'Quota RAMI 2026', ''],
      ['2026-11-06', 30, 'Quota RAMI 2026', 'TRN 66001'],
    ])
    const result = splitPasted(old, overlapping)
    expect(result.fresh.map((fresh) => [fresh.date, fresh.reference])).toEqual([
      ['2026-11-05', ''],
      ['2026-11-06', 'TRN 66001'],
    ])
    expect(result.alreadyPasted.map((pasted) => pasted.date)).toEqual(['2026-11-04', '2026-11-05'])
  })
})
