// La pagina della segreteria e il motore si parlano con `google.script.run`: qui ci sono le chiamate e le risposte.
// Valgono per la pagina (nel browser, dentro la cornice di Google) e per office.ts (in Apps Script). Ogni chiamata
// rifà il controllo di «Accessi» con l'account di Google: la pagina non è mai una prova di chi sei.
import type {
  CalendarDate,
  MemberCounts,
  MemberStatus,
  PaymentMethod,
  PaymentStatus,
  Renewals,
} from '@bussola/condiviso'
import type { OfficeDeadline } from './agenda.ts'
import type { MembersPublication } from './members-snapshot.ts'
import type { BankLine, ToMatch } from './reconcile.ts'
import type { RegisterState } from './register.ts'

/** Le funzioni globali che la pagina chiama: sono esportazioni di motore.ts, coi parametri di sotto. */
export const OFFICE_CALLS = [
  'officeOpen',
  'officePreview',
  'officeRecordPayment',
  'officeCancelPayment',
  'officeChangeYear',
  'officeConfirmPayment',
  'officeCashReceived',
  'officeAssignMember',
  'officeImportBank',
  'officeIgnoreBankLine',
  'officeDeadlineDone',
  'officeSaveRegister',
] as const
export type OfficeCall = (typeof OFFICE_CALLS)[number]

export type OfficePayment = {
  /** `P-2026-0042`: è anche il numero della ricevuta. Le quote del libro soci hanno `L-2026-0001`. */
  id: string
  /** Vuoto se il pagamento è senza socio. */
  memberNumber: string
  validYear: number
  amount: number
  date: CalendarDate | ''
  method: PaymentMethod
  reference: string
  /** Solo per i contanti: chi ha incassato davvero. */
  collectedBy: string
  /** La persona di «Accessi» che l'ha registrato (dal «Chi sei?» se l'account è condiviso). */
  recordedBy: string
  recordedOn: CalendarDate | ''
  /** Solo per i contanti: il giorno in cui chi può confermare li ha avuti in cassa; vuoto finché sono da consegnare. */
  cashReceivedOn: CalendarDate | ''
  status: PaymentStatus
  /** Motivo o nota, anche quelli dell'annullamento e del cambio d'anno, uno per riga. */
  note: string
}

export type OfficeMember = {
  number: string
  lastName: string
  firstName: string
  email: string
  phone: string
  type: 'producer' | 'supporter' | ''
  admittedOn: CalendarDate | ''
  leftOn: CalendarDate | ''
  status: MemberStatus
  /** Dal più recente: prima l'anno di validità più alto, poi la data. Anche gli annullati. */
  payments: OfficePayment[]
}

/** Una riga del «Registro di Accessi». */
export type AccessChange = { when: string; who: string; cells: string; before: string; after: string }

export type SharingFinding = {
  /** «il Foglio soci», «la cartella «Bussola»», «la cartella «Libro soci»». */
  where: string
  /** La mail, oppure «chiunque abbia il link», «chi è nel dominio». */
  account: string
  access: 'modifica' | 'lettura'
}

/** Un pagamento col nome del socio, per gli elenchi di «Oggi» e Pagamenti; vuoto se senza socio. */
export type PaymentWithMember = OfficePayment & { memberName: string }

/** Una riga di «Salute» del Foglio contenuti, come si legge. */
export type HealthLine = { piece: string; status: string; checkedOn: string; updatedOn: string; note: string }

/** Una riga della banca messa da parte, col perché. */
export type SetAsideLine = { line: BankLine; why: string }

/** Ciò che «Oggi» e Pagamenti mostrano, calcolato dal motore a ogni apertura. */
export type OfficeDashboard = {
  /** Da gennaio ad aprile, la riga dei rinnovi (O8); null negli altri mesi. */
  renewals: Renewals | null
  /** «Rinnovi 2027: 150 su 260 (58%) · bersaglio: oltre il 92% al 31/3», vuota senza la riga. */
  renewalsLabel: string
  /** «Da abbinare»: i bonifici in banca senza registrazione, le registrazioni senza banca, i pagamenti senza socio. */
  toMatch: ToMatch[]
  /** Le righe della banca abbinate. */
  matchedLines: number
  bank: {
    lines: number
    /** Le uscite e gli importi a zero: non sono quote di soci, si contano e non vanno in «Da controllare». */
    outflows: number
    /** Le iscrizioni al Raduno, messe da parte dall'abbinamento: hanno un bonifico loro, non sono quote. */
    raduno: SetAsideLine[]
    /** Le righe segnate «Non è una quota» da chi registra, col suo motivo. */
    notDues: SetAsideLine[]
    /** La data più recente fra le righe. */
    lastDate: CalendarDate | ''
  }
  pendingTreasurer: PaymentWithMember[]
  cashToDeliver: { payments: PaymentWithMember[]; total: number }
  /** L'ultima registrazione fatta da una persona (le quote del libro soci non contano); null se nessuna. */
  lastRecording: { id: string; on: CalendarDate; daysAgo: number } | null
  /** Le scadenze da guardare: in ritardo in cima, poi le prossime 30 giorni. */
  deadlines: OfficeDeadline[]
  /** «Da controllare», una frase per voce; vuoto se non c'è niente. */
  toCheck: string[]
  /** «Salute» del Foglio contenuti, una riga per pezzo. */
  health: HealthLine[]
  register: RegisterState
  publication: MembersPublication
  /** Il Foglio contenuti non si legge, o non è collegato: le scadenze e «Salute» mancano per questo. */
  contentProblem: string
  /** Da T6: le righe di «Impegni» che aspettano la scheda; null se la scheda non c'è o non si legge. */
  commitmentsToWrite: number | null
  /** Le voci di «Accessi», solo per il segretario; null per gli altri. */
  access: {
    /** Gli ultimi 30 giorni, dal più recente. */
    accessChanges: AccessChange[]
    /** Il controllo di ogni giorno: vuoto se non è ancora girato. */
    sharingCheckedOn: CalendarDate | ''
    sharing: SharingFinding[]
  } | null
}

export type OfficeView = {
  today: CalendarDate
  year: number
  /** Chi sta usando la pagina, dal «Chi sei?» o dall'account. */
  person: string
  /** I nomi di «Accessi» sullo stesso account: con più di uno la pagina mostra «Registri come [nome] · Cambia». */
  names: string[]
  canRecord: boolean
  /** «può confermare pagamenti»: conferma e «Ricevuti». */
  canConfirm: boolean
  isSecretary: boolean
  /** L'importo della quota, per il campo «Importo». */
  amount: number
  /** Il documento «Istruzioni della segreteria», per il piede; vuoto se non c'è ancora. */
  instructionsUrl: string
  counts: MemberCounts
  /** Per cognome e nome. */
  members: OfficeMember[]
  dashboard: OfficeDashboard
}

/** `email` è l'account di chi guarda, già senza maiuscole e spazi. */
export type NoAccess = { kind: 'noAccess'; email: string }
/** Un problema del Foglio o di Google, detto in italiano, senza codici. */
export type OfficeError = { kind: 'error'; message: string }

export type OfficeOpenResult =
  NoAccess | OfficeError | { kind: 'whoAreYou'; names: string[] } | { kind: 'ok'; view: OfficeView }

export type PaymentInput = {
  /** Uno per schermo di registrazione: la stessa registrazione ripetuta vale una. */
  requestKey: string
  /** Dal «Chi sei?»; il motore lo controlla con l'account. */
  person: string
  /** Vuoto per «Registra senza socio». */
  memberNumber: string
  /** Come l'ha scritto la persona: «30», «30,00». */
  amount: string
  method: 'transfer' | 'cash'
  date: CalendarDate
  reference: string
  collectedBy: string
  note: string
  /** «È un altro pagamento»: si registra anche se sembra un doppione. Vuole la nota. */
  notADuplicate: boolean
}

export type InvalidField = {
  kind: 'invalid'
  field:
    | 'member'
    | 'amount'
    | 'date'
    | 'reference'
    | 'collectedBy'
    | 'note'
    | 'reason'
    | 'validYear'
    | 'payment'
    | 'measure'
    | 'bank'
    | 'deadline'
  message: string
}

export type PreviewResult =
  | NoAccess
  | OfficeError
  | InvalidField
  | {
      kind: 'preview'
      validYear: number
      /** Vuoto se senza socio. */
      memberName: string
      hasEmail: boolean
      /** Chi registra non ha «può registrare pagamenti»: va «In attesa del tesoriere». */
      pending: boolean
      /** Il socio è receduto: la pagina lo dice prima di registrare. Vuoto se no, o senza socio. */
      leftOn: CalendarDate | ''
    }

/** `none` quando la mail non deve partire: senza socio, in attesa del tesoriere, o un cambio che non la vuole. */
export type MailOutcome = 'sent' | 'noEmail' | 'failed' | 'none'

export type RecordResult =
  | NoAccess
  | OfficeError
  | InvalidField
  | {
      kind: 'recorded'
      payment: OfficePayment
      memberName: string
      pending: boolean
      /** Lo stato del socio dopo questo pagamento, per una conferma che dica il vero; `null` senza socio. */
      status: MemberStatus | null
      mail: MailOutcome
      view: OfficeView
    }
  | {
      kind: 'duplicate'
      existing: OfficePayment
      memberName: string
      /** «dal tesoriere», «dalla segreteria part-time», oppure «da [nome]». */
      recordedByText: string
      /** L'anno per cui si registra se si sceglie «È un altro pagamento». */
      yearIfAnother: number
    }

export type CancelInput = { person: string; paymentId: string; reason: string }
export type ChangeYearInput = { person: string; paymentId: string; validYear: number; reason: string }
/** «Conferma» e «Ricevuti». */
export type PaymentActionInput = { person: string; paymentId: string }
/** «Abbina a un socio» un pagamento registrato senza socio. */
export type AssignMemberInput = { person: string; paymentId: string; memberNumber: string }
/** Le righe della banca, incollate o dal CSV. */
export type ImportBankInput = { person: string; text: string }
/**
 * «Non è una quota» su una riga della banca in «Da abbinare», col motivo. La riga si riconosce dalla sua posizione nella
 * scheda e da data, importo, causale e riferimento, come la mostra la pagina: se nel Foglio è cambiata, non si tocca.
 */
export type IgnoreBankLineInput = {
  person: string
  line: Pick<BankLine, 'index' | 'date' | 'amount' | 'reason' | 'reference'>
  reason: string
}
/** «Fatta»: per la misura del mese anche il numero, come l'ha scritto la persona. */
export type DeadlineDoneInput = { person: string; deadlineId: string; measure?: string }
export type SaveRegisterInput = { person: string }

/** Il cambio è fatto e la vista è rifatta; `mail` dice se al socio è partita la ricevuta. */
export type ChangeResult = NoAccess | OfficeError | InvalidField | { kind: 'done'; view: OfficeView; mail: MailOutcome }

export type ImportResult =
  | NoAccess
  | OfficeError
  | InvalidField
  | {
      kind: 'imported'
      /** Le righe nuove scritte in «Estratto conto», abbinate o no. */
      added: number
      /** Le righe uguali a una già nella scheda: scartate. */
      alreadyPasted: number
      /** Fra le aggiunte, quelle che non si leggono, le uscite e le iscrizioni al Raduno. */
      ignored: number
      /** Fra le aggiunte, quelle abbinate a un pagamento registrato. */
      matched: number
      view: OfficeView
    }
