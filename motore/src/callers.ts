// Chi può lanciare le funzioni globali del motore. La pagina della segreteria gira «Esegui come: io» per chiunque nel
// dominio, e con `google.script.run` chiunque l'apra può chiamare ogni globale come segreteria@: tutte, tranne doGet e
// le office* (che rifanno il controllo di «Accessi»), passano da qui.
import { normalizeEmail } from '@bussola/condiviso'

/** Gli account e i trigger del progetto, da Session e ScriptApp. */
export type Callers = {
  /** Chi lancia: dall'editor è chi l'ha aperto, da `google.script.run` chi usa la pagina. */
  activeEmail(): string
  /** Come chi gira lo script: segreteria@. */
  effectiveEmail(): string
  /** Gli id dei trigger del progetto, `getUniqueId()`. */
  triggerIds(): string[]
}

export const CALLER_REFUSED =
  'Questa funzione la lancia solo il motore, o chi cura la Bussola dall’editor con l’account della segreteria.'

/** Dall'editor: chi lancia è l'account che fa girare lo script. Un account vuoto non passa. */
export function editorOnly(callers: Callers): void {
  const active = normalizeEmail(callers.activeEmail())
  if (!active || active !== normalizeEmail(callers.effectiveEmail())) throw new Error(CALLER_REFUSED)
}

/**
 * Da un trigger: l'evento porta il `triggerUid` di un trigger del progetto, che da fuori non si indovina. Non si guarda
 * l'account, perché nei trigger del Modulo e del Foglio l'account attivo può essere chi ha compilato o modificato.
 * Senza `triggerUid` valgono le regole dell'editor, così si lanciano anche a mano.
 */
export function triggerOrEditor(callers: Callers, event: unknown): void {
  const uid = typeof event === 'object' && event !== null ? (event as { triggerUid?: unknown }).triggerUid : undefined
  if (typeof uid === 'string' && uid && callers.triggerIds().indexOf(uid) !== -1) return
  editorOnly(callers)
}
