import { describe, expect, it } from 'vitest'
import {
  addMinutes,
  COORDINATION_ID,
  isLinkUrl,
  isLocalDateTime,
  isMeetUrl,
  nextMeeting,
  parseSiteSnapshot,
  recentlyUpdated,
  romeDateTime,
  upcomingDeadlines,
  type SiteDeadline,
  type SiteSnapshot,
} from './index.ts'

const snapshot: SiteSnapshot = {
  version: 1,
  publishedAt: '2026-10-31T10:00:00.000Z',
  officeUrl: 'https://docs.google.com/forms/d/e/segreteria/viewform',
  groups: [
    {
      id: 'GDL-orti',
      name: 'Orti e Suoli',
      mission: 'Orti vivi.',
      howToJoin: 'Vieni a un incontro.',
      whereWhen: 'Online, il primo giovedì del mese.',
      chatUrl: 'https://chat.example.org/orti',
      referents: [
        { name: 'Lia Prova', role: 'referente' },
        { name: null, role: 'co-referente' },
      ],
    },
  ],
  meetings: [{ groupId: 'GDL-orti', startsAt: '2026-11-05T18:30', meetUrl: 'https://meet.google.com/abc-defg-hij' }],
  links: [
    {
      title: 'Cartella del gruppo',
      url: 'https://drive.google.com/drive/folders/x',
      audience: 'group',
      groupId: 'GDL-orti',
    },
  ],
  deadlines: [{ id: 'SCA-0002', what: 'Assemblea', kind: 'assembly', dueOn: '2026-11-12' }],
  firstDay: [{ title: 'Scegli un gruppo', text: 'Guarda i Gruppi.', url: null }],
  commitments: [
    {
      id: 'IMP-0007',
      title: 'Banco dei semi agli scambi',
      what: '',
      forLabel: 'Semi e Biodiversità',
      groupId: 'GDL-semi',
      status: 'taken',
      days: 6,
      until: '2027-03-31',
      term: 'ongoing',
      pay: 'expenses',
      fee: null,
      assigneeNumber: '34',
      assigneeRole: 'una persona di Semi e Biodiversità',
    },
  ],
}

describe('parseSiteSnapshot', () => {
  it('un’istantanea di prima di T6 si legge senza impegni; uno non ratificato non passa', () => {
    const { commitments, ...before } = snapshot
    expect(parseSiteSnapshot(before)?.commitments).toEqual([])
    const proposed = { ...commitments[0], status: 'proposed' }
    // Un chiuso non va sul sito: la vetrina non lo legge nemmeno per sbaglio.
    const closed = { ...commitments[0], id: 'IMP-0009', status: 'closed', outcome: 'revoked' }
    expect(parseSiteSnapshot({ ...snapshot, commitments: [...commitments, proposed, closed] })?.commitments).toEqual(
      commitments,
    )
  })

  it('accetta l’istantanea scritta dal motore', () => {
    expect(parseSiteSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('rifiuta ciò che non ha la forma giusta', () => {
    expect(parseSiteSnapshot(null)).toBeNull()
    expect(parseSiteSnapshot({ ...snapshot, version: 2 })).toBeNull()
    expect(parseSiteSnapshot({ ...snapshot, groups: 'no' })).toBeNull()
  })

  it('scarta le righe rovinate e i link che non si possono aprire', () => {
    const parsed = parseSiteSnapshot({
      ...snapshot,
      meetings: [...snapshot.meetings, { groupId: 'GDL-orti', startsAt: 'domani', meetUrl: 'x' }],
      links: [...snapshot.links, { title: 'Chiama', url: 'tel:+39333', audience: 'all', groupId: null }],
      groups: [{ ...snapshot.groups[0], chatUrl: 'mailto:gruppo@example.org' }],
    })
    expect(parsed?.meetings).toHaveLength(1)
    expect(parsed?.links).toHaveLength(1)
    expect(parsed?.groups[0]?.chatUrl).toBeNull()
  })

  it('un referente senza consenso resta solo col ruolo', () => {
    expect(parseSiteSnapshot(snapshot)?.groups[0]?.referents[1]).toEqual({ name: null, role: 'co-referente' })
  })
})

describe('i link', () => {
  it('solo https, senza mail né telefoni', () => {
    expect(isLinkUrl('https://drive.google.com/drive/folders/x')).toBe(true)
    expect(isLinkUrl('http://example.org')).toBe(false)
    expect(isLinkUrl('mailto:a@example.org')).toBe(false)
    expect(isLinkUrl('https://utente@example.org')).toBe(false)
    expect(isLinkUrl('https://wa.me/393331234567')).toBe(false)
    expect(isLinkUrl('https://api.whatsapp.com/send?phone=393331234567')).toBe(false)
    expect(isLinkUrl('https://example.org/a b')).toBe(false)
  })

  it('il calendario Google di un gruppo e i profili con la chiocciola passano', () => {
    expect(isLinkUrl('https://calendar.google.com/calendar/embed?src=abc123@group.calendar.google.com')).toBe(true)
    expect(isLinkUrl('https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com')).toBe(true)
    expect(isLinkUrl('https://mastodon.social/@rami')).toBe(true)
  })

  it('una mail dentro il link non passa, nemmeno scritta come %40', () => {
    expect(isLinkUrl('https://calendar.google.com/calendar/embed?src=nome.cognome@gmail.com')).toBe(false)
    expect(isLinkUrl('https://calendar.google.com/calendar/embed?src=nome.cognome%40gmail.com')).toBe(false)
    expect(isLinkUrl('https://example.org/contatti?mail=nome%40example.org')).toBe(false)
    // La chiocciola del calendario di gruppo non apre la strada a una mail nello stesso link.
    expect(
      isLinkUrl('https://calendar.google.com/calendar/embed?src=a@group.calendar.google.com&x=b@example.org'),
    ).toBe(false)
  })

  it('Meet è solo meet.google.com', () => {
    expect(isMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(isMeetUrl('https://zoom.us/j/1')).toBe(false)
  })
})

describe('l’ora di Roma', () => {
  it('scrive giorno e ora, anche con l’ora legale', () => {
    expect(romeDateTime(new Date('2026-07-01T16:30:00Z'))).toBe('2026-07-01T18:30')
    expect(romeDateTime(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-02T00:30')
    expect(isLocalDateTime('2026-12-02T00:30')).toBe(true)
    expect(isLocalDateTime('2026-12-02 00:30')).toBe(false)
    expect(isLocalDateTime('2026-02-30T10:00')).toBe(false)
  })

  it('somma i minuti sul calendario', () => {
    expect(addMinutes('2026-11-01T00:30', -60)).toBe('2026-10-31T23:30')
  })
})

describe('il prossimo incontro', () => {
  const meetings = [
    { groupId: 'GDL-semi', startsAt: '2026-11-10T18:00', meetUrl: 'https://meet.google.com/a' },
    { groupId: 'GDL-orti', startsAt: '2026-11-05T18:30', meetUrl: 'https://meet.google.com/b' },
    { groupId: 'GDL-orti', startsAt: '2026-11-01T09:00', meetUrl: 'https://meet.google.com/c' },
  ]

  it('è il primo che non è ancora finito, anche fra i gruppi', () => {
    expect(nextMeeting(meetings, '2026-11-01T09:40')?.meetUrl).toBe('https://meet.google.com/c')
    expect(nextMeeting(meetings, '2026-11-01T10:01')?.meetUrl).toBe('https://meet.google.com/b')
  })

  it('di un gruppo solo, se si chiede', () => {
    expect(nextMeeting(meetings, '2026-11-06T00:00', 'GDL-orti')).toBeNull()
    expect(nextMeeting(meetings, '2026-11-06T00:00', 'GDL-semi')?.meetUrl).toBe('https://meet.google.com/a')
  })
})

describe('le prossime scadenze dei soci', () => {
  const at = (id: string, dueOn: string): SiteDeadline => ({ id, what: id, kind: 'event', dueOn })

  it('quelle dei prossimi 90 giorni, dalla più vicina; a 91 giorni no, e le passate no', () => {
    const list = [at('a', '2027-01-30'), at('b', '2026-11-01'), at('c', '2027-01-31'), at('d', '2026-10-31')]
    expect(upcomingDeadlines(list, '2026-11-01').map((deadline) => deadline.id)).toEqual(['b', 'a'])
  })
})

describe('i cantieri aggiornati più di recente', () => {
  it('sono i primi tre per data di aggiornamento; quelli mai aggiornati in fondo', () => {
    const projects = [
      { id: '1', title: 'A', updatedOn: '2026-10-01' },
      { id: '2', title: 'B', updatedOn: null },
      { id: '3', title: 'C', updatedOn: '2026-10-20' },
      { id: '4', title: 'D', updatedOn: '2026-10-10' },
      { id: '5', title: 'E', updatedOn: '2026-10-20' },
    ]
    expect(recentlyUpdated(projects).map((project) => project.id)).toEqual(['3', '5', '4'])
  })
})

describe('il Coordinamento', () => {
  it('ha un suo nome negli incontri, che non è un GdL', () => {
    expect(COORDINATION_ID).toBe('Coordinamento')
  })
})
