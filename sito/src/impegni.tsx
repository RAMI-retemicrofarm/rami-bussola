// Gli impegni nella Riservata (T6): «Da approvare», diviso fra chi aspetta il Coordinamento e chi aspetta il
// Direttivo, coi respinti e il loro motivo; «Impegni», con la quota dei coperti (O10) e il compenso pagato senza scheda
// approvata; la scheda di un impegno in sette blocchi, a /riservata/impegni/:id. Chi prende un impegno si dice col GdL
// o col ruolo, mai col nome; chi verifica e chi propone col numero socio e il ruolo nella Riservata.
import {
  commitmentCoverage,
  COMMITMENT_OUTCOME_LABELS,
  COMMITMENT_PAY_LABELS,
  COMMITMENT_STATUS_LABELS,
  COMMITMENT_TERM_LABELS,
  COVERAGE_TARGET_PERCENT,
  coverageLabel,
  type CalendarDate,
  type ReservedCommitment,
  type ReservedSnapshot,
  type Role,
} from '@bussola/condiviso'
import { formatDay, formatEuro, plannedAndSpent, Signal } from './ui.tsx'

/**
 * Denaro uscito prima della ratifica: c'è dello speso, e la scheda non è approvata dal Direttivo. Vale per ogni
 * impegno, anche senza la retribuzione scritta o ancora «da scrivere»: «nessun compenso senza scheda».
 */
export const paidWithoutApproval = (commitment: ReservedCommitment) =>
  (commitment.spent ?? 0) > 0 && commitment.ratifiedOn === null

/** «Preso · una persona di Semi e Biodiversità», «Preso · GdL Orti e Suoli», «Chiuso · completato». */
export function statusText(commitment: ReservedCommitment, groupName: (id: string) => string | undefined): string {
  const label = COMMITMENT_STATUS_LABELS[commitment.status]
  if (commitment.status === 'closed')
    return commitment.outcome ? `${label} · ${COMMITMENT_OUTCOME_LABELS[commitment.outcome]}` : label
  if (commitment.status !== 'taken' && commitment.status !== 'ongoing' && commitment.status !== 'delivered')
    return label
  const group = commitment.groupId ? groupName(commitment.groupId) : undefined
  // Senza ruolo né GdL, il cantiere o l'organo come è scritto: «Preso · Coordinamento». Un valore che il motore non
  // riconosce è già in «Da controllare».
  const who = commitment.assigneeRole || (group ? `GdL ${group}` : commitment.forLabel)
  return who ? `${label} · ${who}` : label
}

const groupNames = (snapshot: ReservedSnapshot) => {
  const names = new Map(snapshot.groups.map((group) => [group.id, group.name]))
  return (id: string) => names.get(id)
}

/** Il cantiere o GdL, come la segreteria l'ha scritto o come l'ha riconosciuto il motore. */
const forText = (commitment: ReservedCommitment, groupName: (id: string) => string | undefined) => {
  const group = commitment.groupId ? groupName(commitment.groupId) : undefined
  return group && group === commitment.forLabel ? `GdL ${group}` : commitment.forLabel
}

function OpenLink({ commitment }: { commitment: ReservedCommitment }) {
  return (
    <a
      class="btn sec mini"
      href={`/riservata/impegni/${encodeURIComponent(commitment.id)}`}
      aria-label={`Apri la scheda: ${commitment.title}`}
    >
      Apri la scheda
    </a>
  )
}

/** Una scheda che aspetta: il titolo, per chi, e la data da cui aspetta. */
function Waiting(props: {
  commitment: ReservedCommitment
  since: string
  groupName: (id: string) => string | undefined
}) {
  const { commitment } = props
  const where = forText(commitment, props.groupName)
  return (
    <article class="riga">
      <div>
        <h3>{commitment.title}</h3>
        <p class="small">
          {where && `${where} · `}
          {props.since}
        </p>
      </div>
      <OpenLink commitment={commitment} />
    </article>
  )
}

/** «Da approvare»: le proposte che aspettano il Coordinamento, quelle che aspettano il Direttivo, e i respinti. */
export function ToApprove({ snapshot, today }: { snapshot: ReservedSnapshot; today: CalendarDate }) {
  const groupName = groupNames(snapshot)
  const proposed = snapshot.commitments.filter((commitment) => commitment.status === 'proposed')
  const approved = snapshot.commitments.filter((commitment) => commitment.status === 'approved')
  const year = Number(today.slice(0, 4))
  const rejected = snapshot.commitments.filter(
    (commitment) => commitment.status === 'rejected' && commitment.year === year,
  )
  const date = (value: CalendarDate | null) => (value ? formatDay(value, today) : 'una data non scritta')
  return (
    <div class="card">
      {proposed.length === 0 && approved.length === 0 && <p>Nessuna scheda aspetta il Coordinamento o il Direttivo.</p>}
      {proposed.length > 0 && (
        <>
          <p class="gruppo">Aspettano il Coordinamento</p>
          {proposed.map((commitment) => (
            <Waiting
              commitment={commitment}
              since={`Proposto il ${date(commitment.proposedOn)}`}
              groupName={groupName}
            />
          ))}
        </>
      )}
      {approved.length > 0 && (
        <>
          <p class="gruppo">Aspettano il Direttivo</p>
          {approved.map((commitment) => (
            <Waiting
              commitment={commitment}
              since={`Approvato dal Coordinamento il ${date(commitment.coordinationOn)}`}
              groupName={groupName}
            />
          ))}
        </>
      )}
      {rejected.length > 0 && (
        <>
          <p class="gruppo">Respinti</p>
          {rejected.map((commitment) => (
            <article class="riga">
              <div>
                <h3>{commitment.title}</h3>
                <p>
                  <span class="etichetta">Motivo:</span> {commitment.rejectionReason || 'non scritto.'}
                </p>
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  )
}

/** «Impegni»: la quota dei coperti dell'anno, il tasto del Modulo, e ogni impegno col suo stato. */
export function Commitments({ snapshot, today }: { snapshot: ReservedSnapshot; today: CalendarDate }) {
  const groupName = groupNames(snapshot)
  const year = Number(today.slice(0, 4))
  const coverage = commitmentCoverage(snapshot.commitments, year)
  const ofYear = snapshot.commitments.filter((commitment) => commitment.year === year)
  const others = snapshot.commitments.filter((commitment) => commitment.year !== year)
  const row = (commitment: ReservedCommitment) => (
    <article class="riga">
      <div>
        <h3>{commitment.title}</h3>
        <p class="small">{forText(commitment, groupName) || 'Cantiere o GdL non scritto'}</p>
        <p>
          <span class="etichetta">Stato:</span> {statusText(commitment, groupName)}
        </p>
        {paidWithoutApproval(commitment) && (
          <Signal tone="bad" shape="tri">
            Compenso senza scheda approvata
          </Signal>
        )}
      </div>
      <OpenLink commitment={commitment} />
    </article>
  )
  return (
    <>
      {coverage.percent === null ? (
        // I respinti e i ritirati non si coprono, ma si elencano sotto: allora la frase dice «da coprire».
        <p>{ofYear.length > 0 ? 'Nessun impegno da coprire quest’anno.' : 'Nessun impegno quest’anno.'}</p>
      ) : (
        <>
          <p class="quota">
            <b>{coverageLabel(coverage)}</b>
          </p>
          {coverage.percent >= COVERAGE_TARGET_PERCENT ? (
            <Signal tone="ok" shape="pieno">
              Obiettivo raggiunto
            </Signal>
          ) : (
            <Signal tone="warn" shape="dot">
              Obiettivo: almeno l’{COVERAGE_TARGET_PERCENT}%
            </Signal>
          )}
        </>
      )}
      {(ofYear.length > 0 || others.length > 0) && (
        <div class="card">
          {ofYear.map(row)}
          {others.length > 0 && (
            <>
              <p class="gruppo">Degli anni prima, ancora aperti</p>
              {others.map(row)}
            </>
          )}
        </div>
      )}
      {snapshot.commitmentFormUrl && (
        <>
          <p>La scheda di un impegno da scrivere si completa col Modulo.</p>
          <a class="btn sec" href={snapshot.commitmentFormUrl}>
            Proponi un impegno
          </a>
        </>
      )}
    </>
  )
}

const ROLE_LABELS: Record<Role, string> = {
  board: 'Direttivo',
  rep: 'rappresentante',
  office: 'segreteria',
  keeper: 'cura della Bussola',
}

/** «socio n. 12 · Direttivo»: il numero, e i ruoli che ha nelle Persone della Riservata. Mai il nome. */
function memberText(snapshot: ReservedSnapshot, number: string | null): string {
  if (!number) return 'non ancora scritto'
  const roles = snapshot.people.find((person) => person.memberNumber === number)?.roles ?? []
  return roles.length
    ? `socio n. ${number} · ${roles.map((role) => ROLE_LABELS[role]).join(', ')}`
    : `socio n. ${number}`
}

const orNotYet = (value: string) => value || 'non ancora scritto'

/** Un importo che il tesoriere non ha scritto, a parole come gli altri campi vuoti: un «—» da solo non si legge. */
const euroOrNotYet = (amount: number | null) => (amount === null ? 'non ancora scritto' : formatEuro(amount))

/** «Previsto 800 € · speso 200 € (25%)», o a parole l'importo che manca. */
const budgetText = (commitment: ReservedCommitment) =>
  commitment.planned !== null && commitment.spent !== null
    ? `Previsto ${plannedAndSpent(commitment)}`
    : `Previsto ${euroOrNotYet(commitment.planned)} · speso ${euroOrNotYet(commitment.spent)}`

/** La scheda in sette blocchi. */
export function CommitmentPage({
  commitment,
  snapshot,
  today,
}: {
  commitment: ReservedCommitment
  snapshot: ReservedSnapshot
  today: CalendarDate
}) {
  const groupName = groupNames(snapshot)
  const day = (value: CalendarDate | null) => (value ? formatDay(value, today) : 'non ancora')
  return (
    <>
      <p>
        <a class="btn sec mini" href="/riservata">
          Torna alla Riservata
        </a>
      </p>
      <h1>{commitment.title}</h1>
      <p class="sub">
        {statusText(commitment, groupName)} · impegno del {commitment.year}
      </p>
      {commitment.status === 'rejected' && (
        <Signal tone="warn" shape="dot">
          Respinto. Motivo: {commitment.rejectionReason || 'non scritto.'}
        </Signal>
      )}
      {paidWithoutApproval(commitment) && (
        <Signal tone="bad" shape="tri">
          Compenso senza scheda approvata
        </Signal>
      )}

      {/* I testi liberi del Modulo tengono i loro a capo: «testo-libero» li mostra, senza HTML. */}
      <h2>1. Cosa si fa</h2>
      <p class="testo-libero">{orNotYet(commitment.what)}</p>

      <h2>2. Per quale cantiere o GdL</h2>
      <p>{orNotYet(forText(commitment, groupName))}</p>

      <h2>3. Quanto tempo</h2>
      <dl class="dati">
        <dt>Giornate</dt>
        <dd>{commitment.days === null ? 'non ancora scritte' : String(commitment.days).replace('.', ',')}</dd>
        <dt>Fino a quando</dt>
        <dd>{day(commitment.until)}</dd>
        <dt>Tipo</dt>
        <dd>{commitment.term ? COMMITMENT_TERM_LABELS[commitment.term] : 'non ancora scritto'}</dd>
      </dl>

      <h2>4. Cosa si consegna e chi verifica</h2>
      <dl class="dati">
        <dt>Consegne</dt>
        <dd class="testo-libero">{orNotYet(commitment.deliverables)}</dd>
        <dt>Chi verifica</dt>
        <dd>{memberText(snapshot, commitment.verifierNumber)}</dd>
      </dl>

      <h2>5. Come si è pagati</h2>
      <dl class="dati">
        <dt>Retribuzione</dt>
        <dd>{commitment.pay ? COMMITMENT_PAY_LABELS[commitment.pay] : 'non ancora scritta'}</dd>
        {commitment.pay === 'paid' && (
          <>
            <dt>Compenso</dt>
            <dd>{euroOrNotYet(commitment.fee)}</dd>
            <dt>Si vede ai soci</dt>
            <dd>{commitment.feeVisible ? 'Sì' : 'No: vedono il tipo e le giornate, non la cifra'}</dd>
          </>
        )}
        <dt>Budget</dt>
        <dd>{budgetText(commitment)}</dd>
      </dl>

      <h2>6. Chi l’ha approvato</h2>
      <dl class="dati">
        <dt>Proposto da</dt>
        <dd>
          {memberText(snapshot, commitment.proposedBy)}
          {commitment.proposedOn && ` il ${formatDay(commitment.proposedOn, today)}`}
        </dd>
        <dt>Delibera del Coordinamento</dt>
        <dd>{day(commitment.coordinationOn)}</dd>
        <dt>Ratifica del Direttivo</dt>
        <dd>{day(commitment.ratifiedOn)}</dd>
      </dl>

      <h2>7. Se serve smettere</h2>
      <dl class="dati">
        <dt>Come si lascia</dt>
        <dd class="testo-libero">{orNotYet(commitment.howToLeave)}</dd>
        <dt>Come si revoca</dt>
        <dd class="testo-libero">{orNotYet(commitment.howToRevoke)}</dd>
      </dl>
    </>
  )
}
