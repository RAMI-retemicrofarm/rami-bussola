/** La chiave della prova dell'imbastitura: il motore la scrive su KV, la pagina «Ciao» la legge. */
export const HELLO_KEY = 'v1/ciao.json'

export type Hello = {
  version: 1
  message: string
  /** ISO 8601, in UTC. */
  writtenAt: string
}

const MAX_MESSAGE = 200

/** Ciò che arriva da KV non è fidato finché non ha la forma giusta: altrimenti la pagina fa come se non ci fosse. */
export function parseHello(value: unknown): Hello | null {
  if (typeof value !== 'object' || value === null) return null
  const { version, message, writtenAt } = value as Record<string, unknown>
  if (version !== 1) return null
  if (typeof message !== 'string' || message.length === 0 || message.length > MAX_MESSAGE) return null
  if (typeof writtenAt !== 'string' || Number.isNaN(Date.parse(writtenAt))) return null
  return { version, message, writtenAt }
}
