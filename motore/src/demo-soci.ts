// Il Foglio «Bussola · soci» con dati inventati, per i test della segreteria: nomi finti, mail @example.org, date fisse.
// Nessun dato vero di soci. Il giorno delle prove è il 5/11/2026, con le impostazioni di partenza (cambio anno il
// 15/10, la regola di ottobre solo per i nuovi soci).
//
// Il conto a mano degli stati al 5/11/2026 (office.test.ts lo ritrova nella vista):
// - receduto (1): 5 Esposito, receduto il 30/6/2026;
// - in regola (11): 1 Abate, 3 Carli, 6 Fabbri (contanti), 11 Marino e 12 Moretti (libro soci), 13 e 14 Neri (un
//   bonifico di 60 € per due quote, stesso riferimento), 15 Orlando (contanti, senza mail), 16 Pace (anche il 2027),
//   19 Testa, 20 Villa (rinnovo in ritardo del 20/10: vale per il 2026);
// - già in regola per il 2027 (2): 7 Galli e 8 Greco, nuovi soci che hanno pagato dopo il 15/10;
// - da rinnovare (4): 2 Bellini (2024 e 2025), 9 Leone (il 2026 è annullato), 10 Mancini (il 2026 è in attesa del
//   tesoriere), 18 Santoro;
// - non in regola (2): 4 Donati (solo il 2024), 17 Riva (nessun pagamento: è un nuovo socio, ammesso il 30/10/2026);
// - soci non receduti: 11 + 2 + 4 + 2 = 19, su 20 righe.
// 30 pagamenti: 29 con un socio, più P-2026-0015 senza socio («Da abbinare»). Il prossimo numero è P-2026-0016.
// I contanti incassati dal tesoriere sono già «ricevuti»; da consegnare restano P-2026-0003 (Luisa) e P-2026-0007
// (la part-time, in attesa del tesoriere): 60 €. L'ultima registrazione è P-2026-0007, del 30/10.
// «Estratto conto»: quattro righe, tre abbinate (per riferimento a P-2026-0014 e P-2026-0015, per «socio n. 7» a
// P-2026-0004) e una senza registrazione («quota Verdi»): in «Da abbinare» quella e P-2026-0015, che è senza socio.
import { DEMO_EMAILS } from './demo.ts'
import { OFFICE_SETTINGS, SOCI_SHEETS } from './members.ts'

export const DEMO_SOCI_TODAY = '2026-11-05'
export const DEMO_SOCI_NOW = new Date('2026-11-05T10:00:00Z')

export const DEMO_SOCI_COUNTS = {
  inGoodStanding: 11,
  paidAhead: 2,
  dueForRenewal: 4,
  notInGoodStanding: 2,
  left: 1,
  members: 19,
} as const

export const DEMO_SHARED_ACCOUNT = 'segreteria.condivisa@example.org'

/** Le persone di «Accessi». */
export const DEMO_OFFICE = {
  secretary: 'Carla Segre',
  partTime: 'Paola Ricci',
  treasurer: 'Ugo Bassi',
  former: 'Dario Conti',
} as const

export const DEMO_INSTRUCTIONS_URL = 'https://docs.google.com/document/d/demo-istruzioni/edit'

const row = (columns: readonly string[], values: Record<string, unknown>) => columns.map((name) => values[name] ?? '')

export function demoSociSheets(): Record<string, unknown[][]> {
  const { members, payments, access, accessLog, bank, privacyLog, settings } = SOCI_SHEETS
  const member = (
    numero: number,
    cognome: string,
    nome: string,
    values: { tipo?: string; ammesso?: string; receduto?: string; mail?: string | null } = {},
  ) =>
    row(members.columns, {
      numero,
      cognome,
      nome,
      mail: values.mail === null ? '' : (values.mail ?? `${nome}.${cognome}@example.org`.toLowerCase()),
      tipo: values.tipo ?? 'sostenitore',
      'ammesso il': values.ammesso ?? '2020-03-14',
      'receduto il': values.receduto ?? '',
    })
  const payment = (id: string, socio: number | '', anno: number, data: string, values: Record<string, unknown> = {}) =>
    row(payments.columns, {
      id,
      'numero socio': socio,
      "vale per l'anno": anno,
      importo: 30,
      data,
      modo: 'bonifico',
      riferimento: id.replace(/\D/g, '').slice(-5),
      'registrato da': DEMO_OFFICE.treasurer,
      account: DEMO_SHARED_ACCOUNT,
      'registrato il': data,
      stato: 'registrato',
      ...values,
    })
  const bySecretary = { 'registrato da': DEMO_OFFICE.secretary, account: DEMO_EMAILS.office }
  const cash = (who: string) => ({ modo: 'contanti', riferimento: '', 'chi incassa': who })
  /** I contanti incassati dal tesoriere, che può confermare: nascono già ricevuti. */
  const treasurerCash = (data: string) => ({ ...cash(DEMO_OFFICE.treasurer), 'contanti ricevuti il': data })

  return {
    [members.name]: [
      [...members.columns],
      member(1, 'Abate', 'Lucia', { tipo: 'professionista' }),
      member(2, 'Bellini', 'Marco'),
      member(3, 'Carli', 'Sara', { tipo: 'professionista' }),
      member(4, 'Donati', 'Paolo'),
      member(5, 'Esposito', 'Anna', { receduto: '2026-06-30' }),
      member(6, 'Fabbri', 'Luca', { tipo: 'professionista' }),
      member(7, 'Galli', 'Marta', { ammesso: '2026-10-20' }),
      member(8, 'Greco', 'Davide', { tipo: 'professionista', ammesso: '2026-10-28' }),
      member(9, 'Leone', 'Chiara'),
      member(10, 'Mancini', 'Giorgio'),
      member(11, 'Marino', 'Elena', { tipo: 'professionista' }),
      member(12, 'Moretti', 'Fabio'),
      member(13, 'Neri', 'Giulia', { tipo: 'professionista' }),
      member(14, 'Neri', 'Tommaso'),
      member(15, 'Orlando', 'Ivo', { mail: null }),
      member(16, 'Pace', 'Rita'),
      member(17, 'Riva', 'Bruno', { ammesso: '2026-10-30' }),
      member(18, 'Santoro', 'Elisa', { tipo: 'professionista' }),
      member(19, 'Testa', 'Nicola'),
      member(20, 'Villa', 'Irene'),
    ],
    [payments.name]: [
      [...payments.columns],
      payment('P-2024-0001', 4, 2024, '2024-02-10', { 'registrato da': 'Franco Neri', account: 'franco@example.org' }),
      payment('P-2024-0002', 19, 2024, '2024-03-02', { 'registrato da': 'Franco Neri', account: 'franco@example.org' }),
      payment('P-2024-0003', 2, 2024, '2024-03-20', { 'registrato da': 'Franco Neri', account: 'franco@example.org' }),
      payment('P-2025-0001', 1, 2025, '2025-01-20'),
      payment('P-2025-0002', 2, 2025, '2025-02-03'),
      payment('P-2025-0003', 5, 2025, '2025-02-15'),
      payment('P-2025-0004', 9, 2025, '2025-03-01'),
      payment('P-2025-0005', 10, 2025, '2025-03-08'),
      payment('P-2025-0006', 18, 2025, '2025-03-12'),
      payment('P-2025-0007', 19, 2025, '2025-03-30'),
      payment('P-2025-0008', 20, 2025, '2025-04-11'),
      payment('P-2025-0009', 3, 2025, '2025-05-05'),
      payment('P-2025-0010', 6, 2025, '2025-06-21', treasurerCash('2025-06-21')),
      // Le quote venute dal libro soci con la migrazione: senza data, senza chi le ha registrate.
      payment('L-2026-0001', 11, 2026, '', {
        modo: 'libro soci',
        riferimento: '',
        importo: '',
        'registrato da': '',
        account: '',
        'registrato il': '2026-10-19',
      }),
      payment('L-2026-0002', 12, 2026, '', {
        modo: 'libro soci',
        riferimento: '',
        importo: '',
        'registrato da': '',
        account: '',
        'registrato il': '2026-10-19',
      }),
      payment('P-2026-0001', 1, 2026, '2026-01-15', bySecretary),
      payment('P-2026-0002', 3, 2026, '2026-02-02', bySecretary),
      payment('P-2026-0003', 6, 2026, '2026-05-23', cash('Luisa al banchetto del raduno')),
      // Due nuovi soci dopo il 15/10: la quota vale per il 2027.
      payment('P-2026-0004', 7, 2027, '2026-10-20', bySecretary),
      payment('P-2026-0005', 8, 2027, '2026-10-28', treasurerCash('2026-10-28')),
      payment('P-2026-0006', 9, 2026, '2026-03-04', {
        stato: 'annullato',
        'motivo o nota': 'Annullato il 10/03/2026 da Ugo Bassi: il bonifico era stato restituito',
      }),
      payment('P-2026-0007', 10, 2026, '2026-10-30', {
        ...cash(DEMO_OFFICE.partTime),
        'registrato da': DEMO_OFFICE.partTime,
        stato: 'in attesa del tesoriere',
      }),
      // Un bonifico di 60 € per due quote: stesso riferimento, soci diversi, non è un doppione.
      payment('P-2026-0008', 13, 2026, '2026-02-20', {
        riferimento: '55001',
        'motivo o nota': 'bonifico di 60 € per due quote',
      }),
      payment('P-2026-0009', 14, 2026, '2026-02-20', {
        riferimento: '55001',
        'motivo o nota': 'bonifico di 60 € per due quote',
      }),
      payment('P-2026-0010', 15, 2026, '2026-05-23', treasurerCash('2026-05-23')),
      payment('P-2026-0011', 16, 2026, '2026-04-02', bySecretary),
      payment('P-2026-0012', 16, 2027, '2026-04-02', { ...bySecretary, 'motivo o nota': 'quota di due anni' }),
      payment('P-2026-0013', 19, 2026, '2026-03-15'),
      // Un rinnovo in ritardo dopo il 15/10: vale per il 2026, perché la regola di ottobre è dei nuovi soci.
      payment('P-2026-0014', 20, 2026, '2026-10-20', bySecretary),
      payment('P-2026-0015', '', 2026, '2026-10-25', { 'motivo o nota': 'causale «quota Rossi», nessun socio Rossi' }),
    ],
    [access.name]: [
      [...access.columns],
      [DEMO_OFFICE.secretary, DEMO_EMAILS.office, 'segretario', 'sì', 'sì', 'no'],
      [DEMO_OFFICE.partTime, DEMO_SHARED_ACCOUNT, 'segreteria part-time', 'sì', 'no', 'no'],
      [DEMO_OFFICE.treasurer, DEMO_SHARED_ACCOUNT, 'tesoriere', 'sì', 'sì', 'sì'],
      [DEMO_OFFICE.former, 'dario.conti@example.org', 'segreteria part-time', 'no', 'no', 'no'],
    ],
    [accessLog.name]: [
      [...accessLog.columns],
      [new Date('2026-10-05T08:12:00Z'), DEMO_EMAILS.office, 'D5', 'sì', 'no'],
      [new Date('2026-10-26T15:40:00Z'), DEMO_EMAILS.office, 'A4:F4', '', 'Ugo Bassi · ' + DEMO_SHARED_ACCOUNT],
    ],
    [bank.name]: [
      [...bank.columns],
      ['2026-10-20', 30, 'Bonifico da VILLA IRENE Quota RAMI 2026 socio n. 20', 'TRN 60014', '', ''],
      ['2026-10-21', 30, 'Quota RAMI 2027 socio n. 7', 'TRN 77001', '', ''],
      ['2026-10-25', 30, 'quota Rossi', 'TRN 60015', '', ''],
      ['2026-11-02', 30, 'quota Verdi', 'TRN 90210', '', ''],
    ],
    [privacyLog.name]: [[...privacyLog.columns]],
    [settings.name]: [
      [...settings.columns],
      ...Object.values(OFFICE_SETTINGS).map(({ voce, partenza }) => [
        voce,
        voce === OFFICE_SETTINGS.instructions.voce
          ? DEMO_INSTRUCTIONS_URL
          : voce === OFFICE_SETTINGS.reader.voce
            ? DEMO_EMAILS.keeper
            : partenza,
        voce === OFFICE_SETTINGS.reader.voce ? 'chi cura la Bussola' : '',
      ]),
    ],
  }
}
