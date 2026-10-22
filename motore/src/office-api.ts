// La pagina della segreteria e il motore si parlano con `google.script.run`: qui ci sono le chiamate e le risposte.
// Valgono per la pagina (nel browser, dentro la cornice di Google) e per office.ts (in Apps Script). Ogni chiamata
// rifà il controllo di «Accessi» con l'account di Google: la pagina non è mai una prova di chi sei.
import type { CalendarDate, MemberCounts, MemberStatus, PaymentMethod, PaymentStatus } from '@bussola/condiviso'

/** Le funzioni globali che la pagina chiama: sono esportazioni di motore.ts, coi parametri di sotto. */
export const OFFICE_CALLS = [
  'officeOpen',
  'officePreview',
  'officeRecordPayment',
  'officeCancelPayment',
  'officeChangeYear',
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

export type OfficeView = {
  today: CalendarDate
  year: number
  /** Chi sta usando la pagina, dal «Chi sei?» o dall'account. */
  person: string
  /** I nomi di «Accessi» sullo stesso account: con più di uno la pagina mostra «Registri come [nome] · Cambia». */
  names: string[]
  canRecord: boolean
  isSecretary: boolean
  /** L'importo della quota, per il campo «Importo». */
  amount: number
  /** Il documento «Istruzioni della segreteria», per il piede; vuoto se non c'è ancora. */
  instructionsUrl: string
  counts: MemberCounts
  /** Per cognome e nome. */
  members: OfficeMember[]
  /** Le prime due voci di «Oggi»: solo per il segretario, null per gli altri. */
  todayForSecretary: {
    /** Gli ultimi 30 giorni, dal più recente. */
    accessChanges: AccessChange[]
    /** Il controllo di ogni giorno: vuoto se non è ancora girato. */
    sharingCheckedOn: CalendarDate | ''
    sharing: SharingFinding[]
  } | null
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
  field: 'member' | 'amount' | 'date' | 'reference' | 'collectedBy' | 'note' | 'reason' | 'validYear' | 'payment'
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
      /** `none` quando non deve partire: senza socio o in attesa del tesoriere. */
      mail: 'sent' | 'noEmail' | 'failed' | 'none'
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
export type ChangeResult = NoAccess | OfficeError | InvalidField | { kind: 'done'; view: OfficeView }
