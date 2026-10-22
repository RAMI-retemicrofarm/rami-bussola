import type { ReservedPerson, ReservedSnapshot } from '@bussola/condiviso'

export type BussolaEnv = {
  Bindings: CloudflareBindings
  Variables: {
    /** La mail del JWT di Access; in locale, quella di prova. Non esce dalla Function. */
    accessEmail: string
    reserved: ReservedSnapshot | null
    /** La persona di «Persone della Riservata», se c'è. */
    person: ReservedPerson | null
  }
}
