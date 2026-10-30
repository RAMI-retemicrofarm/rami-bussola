import { describe, expect, it } from 'vitest'
import {
  commitmentCoverage,
  coverageLabel,
  isCovered,
  isPublicStatus,
  parseReservedCommitment,
  parseSiteCommitment,
  toCover,
  type CommitmentStatus,
  type ReservedCommitment,
  type SiteCommitment,
} from './commitments.ts'

const commitment = (status: CommitmentStatus, outcome: ReservedCommitment['outcome'] = null, year = 2026) => ({
  status,
  outcome,
  year,
})

/** I sette impegni dell'anno dei criteri di T6. */
const SEVEN = [
  commitment('toWrite'),
  commitment('proposed'),
  commitment('rejected'),
  commitment('open'),
  commitment('taken'),
  commitment('closed', 'completed'),
  commitment('closed', 'withdrawn'),
]

describe('da coprire e coperti', () => {
  it('dati sette impegni dell’anno: da coprire 5, coperti 2', () => {
    expect(SEVEN.filter(toCover)).toHaveLength(5)
    expect(SEVEN.filter(isCovered)).toHaveLength(2)
    expect(commitmentCoverage(SEVEN, 2026)).toEqual({ covered: 2, toCover: 5, percent: 40 })
    expect(coverageLabel(commitmentCoverage(SEVEN, 2026))).toBe('Impegni coperti: 2 su 5 (40%)')
  })

  it('i revocati e i ritirati escono da entrambi i termini; «da scrivere» si deve coprire', () => {
    for (const outcome of ['revoked', 'withdrawn'] as const) {
      expect(toCover(commitment('closed', outcome))).toBe(false)
      expect(isCovered(commitment('closed', outcome))).toBe(false)
    }
    expect(toCover(commitment('toWrite'))).toBe(true)
    expect(isCovered(commitment('toWrite'))).toBe(false)
  })

  it('coperto è preso, in corso, consegnato, o chiuso completato', () => {
    for (const status of ['taken', 'ongoing', 'delivered'] as const) expect(isCovered(commitment(status))).toBe(true)
    for (const status of ['toWrite', 'proposed', 'approved', 'open', 'rejected'] as const)
      expect(isCovered(commitment(status))).toBe(false)
  })

  it('un impegno vivo conta nell’anno in corso, anche se è degli anni prima; un chiuso solo nel suo anno', () => {
    const before = [
      commitment('taken', null, 2025),
      commitment('toWrite', null, 2025),
      commitment('closed', 'completed', 2025),
      commitment('rejected', null, 2025),
    ]
    expect(commitmentCoverage([...SEVEN, ...before], 2026)).toEqual({ covered: 3, toCover: 7, percent: 43 })
    // Un impegno scritto per l'anno dopo non conta ancora.
    expect(commitmentCoverage([...SEVEN, commitment('taken', null, 2027)], 2026).toCover).toBe(5)
    expect(commitmentCoverage([], 2026)).toEqual({ covered: 0, toCover: 0, percent: null })
  })

  it('sul sito solo aperto, preso, in corso e consegnato: i chiusi restano nella Riservata', () => {
    expect(
      (
        ['toWrite', 'proposed', 'approved', 'open', 'taken', 'ongoing', 'delivered', 'closed', 'rejected'] as const
      ).filter(isPublicStatus),
    ).toEqual(['open', 'taken', 'ongoing', 'delivered'])
  })
})

const reserved: ReservedCommitment = {
  id: 'IMP-0001',
  year: 2026,
  title: 'La cura della Bussola',
  status: 'proposed',
  outcome: null,
  rejectionReason: '',
  what: 'Tenere in ordine la piattaforma.',
  forLabel: 'Comunicazione',
  groupId: 'GDL-comunicazione',
  days: 12,
  until: '2027-06-30',
  term: 'ongoing',
  deliverables: 'Un resoconto ogni tre mesi.',
  verifierNumber: '12',
  pay: 'paid',
  fee: 1200,
  feeVisible: false,
  proposedBy: '34',
  proposedOn: '2026-10-20',
  coordinationOn: null,
  ratifiedOn: null,
  howToLeave: 'Con un mese di preavviso.',
  howToRevoke: 'Il Direttivo, sentito il Coordinamento.',
  assigneeNumber: null,
  assigneeRole: '',
  substituteNumber: null,
  planned: 1200,
  spent: null,
}

describe('la forma degli impegni da KV', () => {
  it('un impegno della Riservata si rilegge com’è', () => {
    expect(parseReservedCommitment(JSON.parse(JSON.stringify(reserved)))).toEqual(reserved)
  })

  it('uno stato, un tipo o una retribuzione sconosciuti scartano l’impegno', () => {
    expect(parseReservedCommitment({ ...reserved, status: 'sospeso' })).toBeNull()
    expect(parseReservedCommitment({ ...reserved, term: 'ogni tanto' })).toBeNull()
    expect(parseReservedCommitment({ ...reserved, pay: 'in natura' })).toBeNull()
  })

  it('sul sito solo gli stati che vedono i soci, e il compenso solo se c’è', () => {
    const site: SiteCommitment = {
      id: 'IMP-0007',
      title: 'Banco dei semi',
      what: 'Curare il banco agli scambi.',
      forLabel: 'Semi e Biodiversità',
      groupId: 'GDL-semi',
      status: 'taken',
      days: 6,
      until: '2027-03-31',
      term: 'project',
      pay: 'expenses',
      fee: null,
      assigneeNumber: '34',
      assigneeRole: 'una persona di Semi e Biodiversità',
    }
    expect(parseSiteCommitment(JSON.parse(JSON.stringify(site)))).toEqual(site)
    expect(parseSiteCommitment({ ...site, status: 'proposed' })).toBeNull()
    expect(parseSiteCommitment({ ...site, status: 'closed', outcome: 'revoked' })).toBeNull()
  })
})
