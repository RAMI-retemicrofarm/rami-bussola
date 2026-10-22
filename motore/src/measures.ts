// La scheda «Misure» del Foglio contenuti: per ogni obiettivo, quando si misura, da dove si parte e chi scrive il
// numero, perché ogni KPI si misuri anche dopo la consegna. Nasce in T2 con la preparazione (google.ts), con dieci
// righe; poi la cura chi la scrive. «chi conta» nomina una persona sola, per ruolo.

export type Measure = {
  /** Il codice e il nome breve dell'obiettivo. */
  objective: string
  when: string
  /** Il valore di partenza; vuoto finché non si conta. */
  before: number | ''
  whoCounts: string
  note: string
  /** Come si calcola «variazione»: dopo meno prima, o in percentuale sul prima (O2, −70%). */
  change: 'difference' | 'relative'
}

const KEEPER = 'chi cura la Bussola'

export const MEASURES: readonly Measure[] = [
  {
    objective: 'O1 · Il socio si orienta da solo',
    when: 'metà aprile 2027, la prova col cronometro',
    before: '',
    whoCounts: KEEPER,
    note: 'Minuti per una domanda di orientamento: la mediana della prova con 5–8 soci. Bersaglio: meno di 2.',
    change: 'difference',
  },
  {
    objective: 'O2 · Meno domande ripetute nelle chat',
    when: 'metà aprile 2027, 4 settimane senza feste',
    before: '',
    whoCounts: KEEPER,
    note:
      'Domande di orientamento nelle chat in 4 settimane, contate dai moderatori, che danno il numero al segretario. ' +
      'Il «prima» si conta dal 16/11 al 13/12/2026. Bersaglio: −70%.',
    change: 'relative',
  },
  {
    objective: 'O3 · Più soci partecipano ai GdL',
    when: 'gennaio 2028, il check-up dei GdL',
    before: 13.6,
    whoCounts: KEEPER,
    note:
      '% dei soci in regola attivi in almeno un GdL, col numero del check-up del Coordinamento. ' +
      'Prima: 37 su 272 al 1/10/2026. Bersaglio: +10 punti.',
    change: 'difference',
  },
  {
    objective: 'O4 · La vita associativa si segue',
    when: 'ogni mese dalla fine di novembre 2026, dalla Riservata',
    before: '',
    whoCounts: KEEPER,
    note:
      '% dei cantieri aperti aggiornati da meno di 30 giorni: si copia da «Cantieri aggiornati da meno di 30 giorni» ' +
      'della Riservata, alla data. Bersaglio: almeno 80.',
    change: 'difference',
  },
  {
    objective: 'O5 · La Bussola si usa',
    when: 'fine febbraio 2027 (Coordinamento) e metà aprile 2027 (soci), dalla scheda «Uso»',
    before: 0,
    whoCounts: KEEPER,
    note:
      '% di chi apre la Bussola in un mese: il Coordinamento (15 rappresentanti e il Direttivo) e i soci in regola. ' +
      'Si copia dalla Riservata alla data. Bersaglio: Coordinamento almeno 80, soci almeno 40.',
    change: 'difference',
  },
  {
    objective: 'O6 · La segreteria sa chi è in regola',
    when: 'dalla versione di fine novembre 2026, la prova col cronometro del segretario',
    before: '',
    whoCounts: KEEPER,
    note: 'Minuti per sapere quanti soci sono in regola. Bersaglio: meno di 1.',
    change: 'difference',
  },
  {
    objective: 'O7 · L’associazione è in regola',
    when: '31/12/2027, lo scadenziario',
    before: '',
    whoCounts: KEEPER,
    note:
      'Adempimenti fatti dopo la scadenza nel 2027: si copia da «Adempimenti fatti in ritardo nel 2027» della ' +
      'Riservata, che la mostra fino al 31/1/2028. Bersaglio: 0.',
    change: 'difference',
  },
  {
    objective: 'O8 · I soci rinnovano',
    when: '31/3/2027, la riga dei rinnovi',
    before: 91.6,
    whoCounts: KEEPER,
    note:
      '% dei soci 2026 che rinnovano entro il 31/3. Prima: 185 su 202 entro marzo 2026, da confermare col ' +
      'tesoriere. Si copia dalla Riservata alla data. Bersaglio: oltre 92.',
    change: 'difference',
  },
  {
    objective: 'O9 · Nessun messaggio resta senza risposta',
    when: 'ogni mese dalla fine di novembre 2026',
    before: '',
    whoCounts: 'il segretario',
    note:
      'Messaggi su mail della segreteria e Instagram senza risposta da più di 5 giorni, contati una volta al mese ' +
      'dalla pagina della segreteria. Bersaglio: 0.',
    change: 'difference',
  },
  {
    objective: 'O10 · Gli impegni si scrivono e si prendono',
    when: '15/1/2027 per le prime schede, giugno 2027 per il resto',
    before: '',
    whoCounts: KEEPER,
    note:
      '% degli impegni previsti con una scheda approvata e una persona: si copia dalla Riservata alla data. ' +
      'Bersaglio: almeno 80, e nessun compenso senza scheda (da confermare).',
    change: 'difference',
  },
]

/** Una riga della scheda, per nome di colonna: «dopo» e «variazione» restano vuote. */
export const measureCells = (measure: Measure): Record<string, unknown> => ({
  obiettivo: measure.objective,
  quando: measure.when,
  prima: measure.before,
  'chi conta': measure.whoCounts,
  nota: measure.note,
})

/**
 * La formula di «variazione», scritta in R1C1 dalla colonna stessa: «prima» è due colonne a sinistra, «dopo» una.
 * Resta vuota finché i due numeri non ci sono.
 */
export const CHANGE_FORMULAS: Record<Measure['change'], string> = {
  difference: '=IF(AND(ISNUMBER(R[0]C[-2]),ISNUMBER(R[0]C[-1])),R[0]C[-1]-R[0]C[-2],"")',
  relative: '=IF(AND(ISNUMBER(R[0]C[-2]),ISNUMBER(R[0]C[-1]),R[0]C[-2]<>0),(R[0]C[-1]-R[0]C[-2])/R[0]C[-2],"")',
}
