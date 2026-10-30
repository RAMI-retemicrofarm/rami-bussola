// /, la Home: il prossimo incontro con «Entra su Meet» (per il rappresentante quello del suo GdL, col tasto per
// aggiornarlo e aggiungerne uno), le quattro domande, «Il primo giorno» a un tocco, «Cosa succede» coi tre cantieri
// aggiornati più di recente, le scadenze dei soci dei prossimi 90 giorni, i link della persona e la ricerca. Ogni
// risposta sta al più a due tocchi: sulla Home stessa, o sulla pagina a cui porta la domanda, o una pagina più in là.
import {
  COORDINATION_ID,
  nextMeeting,
  projectSignals,
  recentlyUpdated,
  SITE_DEADLINE_DAYS,
  upcomingDeadlines,
  type CalendarDate,
  type LocalDateTime,
  type ReservedPerson,
  type ReservedSnapshot,
  type SiteSnapshot,
} from '@bussola/condiviso'
import { SearchForm } from './cerca.tsx'
import { repGroupId } from './identity.ts'
import { linksFor } from './link.tsx'
import { formatDay, KIND_LABELS, MeetingCard, sinceUpdate } from './ui.tsx'

/** Le quattro domande di chi si orienta, ognuna con dove trova la risposta. */
export const QUESTIONS = [
  { question: 'Cosa si sta facendo?', answer: 'I cantieri dei gruppi, a che punto sono', href: '/cantieri' },
  {
    question: 'Chi fa cosa, e come lo contatto?',
    answer: 'I gruppi, chi li segue e come si partecipa',
    href: '/gruppi',
  },
  { question: 'Quando ci si vede?', answer: 'Il prossimo incontro, col link di Meet', href: '#incontro' },
  { question: 'Dove trovo chat e documenti?', answer: 'I link, con chi li può aprire', href: '/link' },
] as const

/** I link che si vedono sulla Home; gli altri stanno su /link. */
const HOME_LINKS = 4

function NextMeeting(props: {
  site: SiteSnapshot | null
  reserved: ReservedSnapshot | null
  person: ReservedPerson | null
  now: LocalDateTime
  today: CalendarDate
}) {
  const { site, reserved, now, today } = props
  const myGroupId = repGroupId(props.person)
  const myGroup = myGroupId ? reserved?.groups.find((group) => group.id === myGroupId) : undefined
  // Il Coordinamento non è un GdL: si chiama col suo nome.
  const label = (id: string) =>
    id === COORDINATION_ID ? COORDINATION_ID : `GdL ${site?.groups.find((group) => group.id === id)?.name ?? id}`

  // Il rappresentante vede il suo gruppo: il prossimo incontro, anche se non è visibile ai soci (l'istantanea
  // riservata li ha tutti), e i suoi tasti.
  if (reserved && myGroup) {
    const meeting = nextMeeting(reserved.meetings, now, myGroup.id)
    return (
      <section class="card mia" id="incontro" aria-labelledby="mio-gruppo">
        <h2 id="mio-gruppo">Il mio gruppo: GdL {myGroup.name}</h2>
        {meeting ? (
          <MeetingCard meeting={meeting} internal={!meeting.membersCanSee} today={today} />
        ) : (
          <p>Nessun incontro in calendario nei prossimi 60 giorni.</p>
        )}
        <a class="btn sec" href="/cantieri?filtro=mio">
          Aggiorna il tuo gruppo
        </a>
        {myGroup.newMeetingUrl && (
          <a class="btn sec" href={myGroup.newMeetingUrl}>
            Aggiungi un incontro
          </a>
        )}
      </section>
    )
  }

  const meeting = site ? nextMeeting(site.meetings, now) : null
  return (
    <section class="card" id="incontro" aria-labelledby="prossimo-incontro">
      <h2 id="prossimo-incontro">Prossimo incontro</h2>
      {meeting ? (
        <MeetingCard meeting={meeting} groupName={label(meeting.groupId)} today={today} />
      ) : (
        <p>Nessun incontro aperto ai soci nei prossimi 60 giorni.</p>
      )}
    </section>
  )
}

export function HomePage(props: {
  site: SiteSnapshot | null
  reserved: ReservedSnapshot | null
  person: ReservedPerson | null
  now: LocalDateTime
  today: CalendarDate
}) {
  const { site, reserved, today } = props
  const groupName = (id: string) =>
    site?.groups.find((group) => group.id === id)?.name ?? reserved?.groups.find((group) => group.id === id)?.name ?? id
  const recent = reserved ? recentlyUpdated(reserved.projects) : []
  const updated = (project: ReservedSnapshot['projects'][number]) => {
    const days = projectSignals(project, today, reserved?.staleDays ?? 30).daysSinceUpdate
    return days === null ? sinceUpdate(days) : `aggiornato ${sinceUpdate(days)}`
  }
  const deadlines = site ? upcomingDeadlines(site.deadlines, today) : []
  const links = site ? linksFor(site.links, props.person).slice(0, HOME_LINKS) : []

  return (
    <>
      <h1>Bussola</h1>
      <p class="sub">Per orientarsi in RAMI: chi fa cosa, quando ci si vede, dove trovare le cose.</p>
      <NextMeeting {...props} />

      <h2>Le quattro domande</h2>
      <ul class="domande">
        {QUESTIONS.map((item) => (
          <li>
            <a class="voce domanda" href={item.href}>
              <span>{item.question}</span>
              <span class="small">{item.answer}</span>
            </a>
          </li>
        ))}
      </ul>
      <a class="btn sec" href="/primo-giorno">
        Il primo giorno: come si entra in un gruppo
      </a>

      <h2 id="cosa-succede">Cosa succede</h2>
      <div class="card">
        {!reserved && <p role="status">I cantieri non sono ancora arrivati dal Foglio.</p>}
        {reserved && recent.length === 0 && <p>Non ci sono cantieri aperti.</p>}
        {recent.map((project) => (
          <article class="riga">
            <div>
              <h3>{project.title}</h3>
              <p class="small">
                GdL {groupName(project.groupId)} · {updated(project)}
              </p>
              {project.lastNews && <p>{project.lastNews}</p>}
            </div>
          </article>
        ))}
        {reserved && (
          <a class="voce" href="/cantieri">
            Tutti i cantieri
          </a>
        )}
      </div>

      <h2>Prossime scadenze</h2>
      <div class="card">
        {!site && <p role="status">Le scadenze non sono ancora arrivate dal Foglio.</p>}
        {site && deadlines.length === 0 && <p>Nessuna scadenza nei prossimi {SITE_DEADLINE_DAYS} giorni.</p>}
        {deadlines.map((deadline) => (
          <article class="riga">
            <div>
              <h3>{deadline.what}</h3>
              <p class="small">
                {KIND_LABELS[deadline.kind]} · {formatDay(deadline.dueOn, today)}
              </p>
            </div>
          </article>
        ))}
      </div>

      <h2>I tuoi link</h2>
      <div class="card">
        {!site && <p role="status">I link non sono ancora arrivati dal Foglio.</p>}
        {links.map((link) => (
          <a class="voce" href={link.url}>
            {link.title}
          </a>
        ))}
        {site && (
          <a class="voce" href="/link">
            Tutti i link, con chi li può aprire
          </a>
        )}
      </div>

      <SearchForm />
    </>
  )
}
