// /riservata, nell'ordine della schermata 4 e del cartamodello: i tre numeri in cima e i salti alle sezioni (dalla
// prova in cinque del 26/10: si scorreva troppo), i cantieri fermi o in ritardo
// con la quota degli aggiornati (O4), chi chiede aiuto, le scadenze a 30 giorni con gli adempimenti fatti in ritardo
// (O7), da T6 le schede da approvare e gli impegni coi coperti (O10), i numeri dei soci con la riga dei rinnovi (O8,
// da T4), le ultime delibere, le questioni aperte e il budget per cantiere e impegno. Chi segue è un ruolo, mai un
// nome: lo controlla il motore (readRole), la pagina mostra il ruolo così com'è. Dei soci arrivano solo i numeri
// (v1/soci.json): mai un nome né una mail.
import {
  deadlineCounts,
  deadlinesToWatch,
  freshProjects,
  lateDutiesDone,
  lateDutiesYears,
  projectSignals,
  recentResolutions,
  RENEWAL_TARGET_PERCENT,
  renewalsLabel,
  type BudgetLine,
  type CalendarDate,
  type MembersSnapshot,
  type ReservedBudget,
  type ReservedProject,
  type ReservedResolution,
  type ReservedSnapshot,
  type WatchedDeadline,
} from '@bussola/condiviso'
import { Commitments, ToApprove } from './impegni.tsx'
import {
  formatDay,
  formatInstant,
  KIND_LABELS,
  lateLabel,
  pastLabel,
  plannedAndSpent,
  Signal,
  staleLabel,
} from './ui.tsx'

/** Le delibere che si vedono subito; le altre stanno dietro un «details». */
const SHOWN_RESOLUTIONS = 5

/** Il bersaglio di O4: almeno l'80% dei cantieri aperti aggiornati da meno di 30 giorni. */
const FRESH_TARGET = 80

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** «Segue: il tesoriere», oppure il triangolo rosso: una cosa senza nessuno chiede una persona. */
function Owner({ role }: { role: string }) {
  return role.trim() ? (
    <p>Segue: {role}</p>
  ) : (
    <Signal tone="bad" shape="tri">
      Nessuno la segue
    </Signal>
  )
}

/** Il nome del tasto del verbale dice di quale delibera, così i link non si confondono. */
/** Una scadenza: cosa, tipo e data, il ritardo a parole e chi la segue. */
function DeadlineRow({ item: { deadline, signals }, today }: { item: WatchedDeadline; today: CalendarDate }) {
  return (
    <article class="riga">
      <div>
        <h3>{deadline.what}</h3>
        <p class="small">
          {KIND_LABELS[deadline.kind]} · {formatDay(deadline.dueOn, today)}
        </p>
        {signals.lateByDays !== null && (
          <Signal tone="bad" shape="tri">
            {lateLabel(signals.lateByDays)}
          </Signal>
        )}
        {signals.overdueByDays !== null && (
          <Signal tone="warn" shape="dot">
            {pastLabel(signals.overdueByDays)}
          </Signal>
        )}
        <Owner role={deadline.ownerRole} />
      </div>
    </article>
  )
}

function Resolution({ resolution, today }: { resolution: ReservedResolution; today: CalendarDate }) {
  return (
    <article class="riga">
      <div>
        <h3>{resolution.subject}</h3>
        <p class="small">
          {resolution.body} · {formatDay(resolution.date, today)}
          {resolution.ratifiedOn && ` · ratificata il ${formatDay(resolution.ratifiedOn, today)}`}
        </p>
        {!resolution.minutesUrl && (
          <Signal tone="warn" shape="dot">
            Verbale non ancora nel Drive
          </Signal>
        )}
      </div>
      {resolution.minutesUrl && (
        <a class="btn sec mini" href={resolution.minutesUrl} aria-label={`Apri il verbale: ${resolution.subject}`}>
          Apri il verbale
        </a>
      )}
    </article>
  )
}

/** La somma di una colonna, ai centesimi; null se nessuna riga ha l'importo. */
function total(lines: readonly BudgetLine[], column: 'planned' | 'spent'): number | null {
  const amounts = lines.map((line) => line[column]).filter((amount): amount is number => amount !== null)
  return amounts.length ? Math.round(amounts.reduce((sum, amount) => sum + amount, 0) * 100) / 100 : null
}

// Niente tabella a più colonne: a 320 px e con lo zoom al 200% ogni riga va a capo e non scorre.
function Budget({ budget, today }: { budget: ReservedBudget; today: CalendarDate }) {
  if (!budget.lines.length)
    return (
      <div class="card">
        <p>Il tesoriere non ha ancora inserito i numeri.</p>
      </div>
    )
  const totals = { planned: total(budget.lines, 'planned'), spent: total(budget.lines, 'spent') }
  return (
    <div class="card">
      {budget.lines.map((line) => (
        <article class="riga">
          <div>
            <h3>{line.label}</h3>
            <p>Previsto {plannedAndSpent(line)}</p>
          </div>
        </article>
      ))}
      <p class="totale">
        <b>Totale:</b> previsto {plannedAndSpent(totals)}
      </p>
      {budget.updatedOn && <p class="small">Aggiornato dal tesoriere il {formatDay(budget.updatedOn, today)}.</p>}
    </div>
  )
}

/** I numeri dei soci: i conteggi per stato e, da gennaio ad aprile, la riga dei rinnovi. Solo numeri. */
function Members({ members, today }: { members: MembersSnapshot | null; today: CalendarDate }) {
  if (!members)
    return (
      <div class="card">
        <p>I numeri dei soci non sono ancora arrivati dalla segreteria.</p>
      </div>
    )
  const { counts, renewals } = members
  const year = Number(members.asOf.slice(0, 4))
  return (
    <>
      <div class="numeri">
        <p class="card">
          <b>{counts.inGoodStanding}</b> in regola
        </p>
        <p class="card">
          <b>{counts.dueForRenewal}</b> da rinnovare
        </p>
        <p class="card">
          <b>{counts.notInGoodStanding}</b> non in regola
        </p>
        <p class="card">
          <b>{counts.paidAhead}</b> già in regola per il {year + 1}
        </p>
      </div>
      <div class="card">
        <p class="riga">
          Soci non receduti: {counts.members} · receduti: {counts.left}
        </p>
        {renewals && (
          <>
            <p class="quota">
              <b>{renewalsLabel(renewals)}</b>
            </p>
            {renewals.percent > RENEWAL_TARGET_PERCENT ? (
              <Signal tone="ok" shape="pieno">
                Obiettivo raggiunto
              </Signal>
            ) : (
              <Signal tone="warn" shape="dot">
                Obiettivo: oltre il {RENEWAL_TARGET_PERCENT}% al {Number(renewals.until.slice(3))}/
                {Number(renewals.until.slice(0, 2))}
              </Signal>
            )}
          </>
        )}
        <p class="small">
          Contati il {formatDay(members.asOf, today)}: chi è in regola si calcola dai pagamenti registrati.
        </p>
      </div>
    </>
  )
}

export function RiservataPage(props: {
  snapshot: ReservedSnapshot | null
  /** I numeri dei soci (da T4); null finché la segreteria non li ha pubblicati. */
  members?: MembersSnapshot | null
  today: CalendarDate
}) {
  const { snapshot, today } = props
  const heading = (
    <>
      <h1>Riservata</h1>
      <p class="sub">
        Il quadro dell’associazione. Cantieri e richieste d’aiuto li aggiornano i rappresentanti dei GdL, gli impegni
        chi li propone e chi li prende, il resto la segreteria e il tesoriere.
      </p>
    </>
  )
  if (!snapshot)
    return (
      <>
        {heading}
        <p role="status">I dati della Riservata non sono ancora arrivati dal Foglio. Riprova fra qualche minuto.</p>
      </>
    )

  const groups = new Map(snapshot.groups.map((group) => [group.id, group.name]))
  const groupName = (project: ReservedProject) => `GdL ${groups.get(project.groupId) ?? project.groupId}`
  const flagged = snapshot.projects
    .map((project) => ({ project, signals: projectSignals(project, today, snapshot.staleDays) }))
    .filter(({ signals }) => signals.needsUpdate)
    .sort(
      (a, b) =>
        (b.signals.lateByDays ?? -1) - (a.signals.lateByDays ?? -1) ||
        (b.signals.daysSinceUpdate ?? Infinity) - (a.signals.daysSinceUpdate ?? Infinity),
    )
  const helpWanted = snapshot.projects.filter((project) => project.helpWanted)
  const fresh = freshProjects(snapshot.projects, today)
  const counts = deadlineCounts(snapshot.deadlines, today)
  const watched = deadlinesToWatch(snapshot.deadlines, today)
  // Le passate (gli adempimenti in ritardo e le misure) e le prossime: il numero in cima conta le prossime.
  const past = watched.filter(({ signals }) => signals.daysLeft < 0)
  const upcoming = watched.filter(({ signals }) => signals.daysLeft >= 0)
  const lateDuties = watched.filter(({ signals }) => signals.lateByDays !== null).length
  const row = (item: WatchedDeadline) => <DeadlineRow item={item} today={today} />
  const noUpcoming = <p>Nessuna scadenza nei prossimi 30 giorni.</p>
  const resolutions = recentResolutions(snapshot.resolutions, today)
  const hidden = resolutions.slice(SHOWN_RESOLUTIONS)

  return (
    <>
      {heading}
      <div class="numeri">
        <p class="card">
          <b>{flagged.length}</b> {plural(flagged.length, 'cantiere fermo o in ritardo', 'cantieri fermi o in ritardo')}
        </p>
        <p class="card">
          <b>{counts.next}</b>{' '}
          {plural(counts.next, 'scadenza nei prossimi 30 giorni', 'scadenze nei prossimi 30 giorni')}
        </p>
        <p class={counts.unowned ? 'card allerta' : 'card'}>
          <b>{counts.unowned}</b> {plural(counts.unowned, 'scadenza senza nessuno', 'scadenze senza nessuno')}
        </p>
      </div>
      {lateDuties > 0 && (
        <Signal tone="bad" shape="tri">
          {plural(lateDuties, '1 adempimento in ritardo', `${lateDuties} adempimenti in ritardo`)}
        </Signal>
      )}
      <nav class="salti" aria-label="Su questa pagina">
        <a href="#cantieri">Cantieri fermi</a>
        <a href="#aiuto">Chiedono aiuto</a>
        <a href="#scadenze">Scadenze</a>
        <a href="#approvare">Da approvare</a>
        <a href="#impegni">Impegni</a>
        <a href="#soci">Soci</a>
        <a href="#delibere">Delibere</a>
        <a href="#questioni">Questioni aperte</a>
        <a href="#budget">Budget</a>
      </nav>

      <h2 id="cantieri">Cantieri fermi o in ritardo</h2>
      {fresh.percent === null ? (
        <p>Nessun cantiere aperto.</p>
      ) : (
        <>
          <p class="quota">
            <b>{`Cantieri aggiornati da meno di 30 giorni: ${fresh.fresh} su ${fresh.open} (${fresh.percent}%)`}</b>
          </p>
          {fresh.percent >= FRESH_TARGET ? (
            <Signal tone="ok" shape="pieno">
              Obiettivo raggiunto
            </Signal>
          ) : (
            <Signal tone="warn" shape="dot">
              Obiettivo: almeno l’{FRESH_TARGET}%
            </Signal>
          )}
        </>
      )}
      <div class="card">
        {flagged.length === 0 && <p>Nessun cantiere fermo o in ritardo.</p>}
        {flagged.map(({ project, signals }) => (
          <article class="riga">
            <div>
              <h3>{project.title}</h3>
              <p class="small">{groupName(project)}</p>
              {signals.lateByDays !== null && (
                <Signal tone="bad" shape="tri">
                  {lateLabel(signals.lateByDays)}
                </Signal>
              )}
              {signals.stale && (
                <Signal tone="warn" shape="dot">
                  {staleLabel(signals.daysSinceUpdate)}
                </Signal>
              )}
            </div>
          </article>
        ))}
      </div>

      <h2 id="aiuto">Chiedono aiuto</h2>
      <div class="card">
        {helpWanted.length === 0 && <p>Nessun cantiere chiede aiuto.</p>}
        {helpWanted.map((project) => (
          <article class="riga">
            <div>
              <h3>{project.title}</h3>
              <p class="small">{groupName(project)}</p>
              <p>
                <span class="etichetta">Serve aiuto:</span> {project.helpWanted}
              </p>
            </div>
          </article>
        ))}
      </div>

      <h2 id="scadenze">Scadenze dei prossimi 30 giorni</h2>
      <div class="card">
        {past.length > 0 ? (
          <>
            <p class="gruppo">In ritardo</p>
            {past.map(row)}
            <p class="gruppo">Nei prossimi 30 giorni</p>
            {upcoming.length ? upcoming.map(row) : noUpcoming}
          </>
        ) : upcoming.length ? (
          upcoming.map(row)
        ) : (
          noUpcoming
        )}
        {lateDutiesYears(today).map((year) => (
          <p class="totale">
            Adempimenti fatti in ritardo nel {year}: {lateDutiesDone(snapshot.deadlines, year)}
          </p>
        ))}
      </div>

      <h2 id="approvare">Da approvare</h2>
      <ToApprove snapshot={snapshot} today={today} />

      <h2 id="impegni">Impegni</h2>
      <Commitments snapshot={snapshot} today={today} />

      <h2 id="soci">Soci</h2>
      <Members members={props.members ?? null} today={today} />

      <h2 id="delibere">Ultime delibere</h2>
      <div class="card">
        {resolutions.length === 0 && <p>Nessuna delibera negli ultimi 12 mesi.</p>}
        {resolutions.slice(0, SHOWN_RESOLUTIONS).map((resolution) => (
          <Resolution resolution={resolution} today={today} />
        ))}
        {hidden.length > 0 && (
          <details class="altre">
            <summary>
              {hidden.length === 1
                ? 'L’altra delibera degli ultimi 12 mesi'
                : `Le altre ${hidden.length} delibere degli ultimi 12 mesi`}
            </summary>
            {hidden.map((resolution) => (
              <Resolution resolution={resolution} today={today} />
            ))}
          </details>
        )}
      </div>

      <h2 id="questioni">Questioni aperte</h2>
      <div class="card">
        {snapshot.issues.length === 0 && <p>Nessuna questione aperta.</p>}
        {snapshot.issues.map((issue) => (
          <article class="riga">
            <div>
              <h3>{issue.what}</h3>
              {issue.since && <p class="small">Aperta dal {formatDay(issue.since, today)}</p>}
              <Owner role={issue.ownerRole} />
            </div>
          </article>
        ))}
      </div>

      <h2 id="budget">Budget per cantiere e impegno</h2>
      <Budget budget={snapshot.budget} today={today} />

      <p class="small">Aggiornato il {formatInstant(snapshot.publishedAt)}.</p>
    </>
  )
}
