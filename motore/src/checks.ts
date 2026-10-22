// Le prove vere dell'imbastitura che girano dentro Google (docs/tappe.md, «Prima di T1»). Si lanciano dall'editor o
// da un trigger e scrivono nel registro delle esecuzioni. Se ne vanno quando la tappa che le usa ha il suo modulo.
import { requiredProperty } from './properties.ts'

/** Chi vede il file di prova (proprietà PROVA_FILE_ID): compare il service account della copia? (T8) */
export function checkSharing(): void {
  const file = DriveApp.getFileById(requiredProperty('PROVA_FILE_ID'))
  const emails = (users: GoogleAppsScript.Drive.User[]) => users.map((user) => user.getEmail())
  console.log(
    JSON.stringify({
      editors: emails(file.getEditors()),
      viewers: emails(file.getViewers()),
      access: String(file.getSharingAccess()),
    }),
  )
}

/** La ricerca delle mail tornate indietro che userà «Salute»: la prova dice se le trova tutte. */
export const BOUNCE_QUERY = 'from:(mailer-daemon@googlemail.com OR mailer-daemon@google.com) newer_than:7d'

export function checkBounces(): void {
  const threads = GmailApp.search(BOUNCE_QUERY, 0, 50)
  const found = threads.map((thread) => ({
    subject: thread.getFirstMessageSubject(),
    date: thread.getLastMessageDate().toISOString(),
  }))
  console.log(JSON.stringify({ query: BOUNCE_QUERY, found }))
}
