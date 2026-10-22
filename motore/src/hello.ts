import type { Hello } from '@bussola/condiviso'

export const HELLO_MESSAGE = 'Ciao dal motore della Bussola'

export function buildHello(now: Date): Hello {
  return { version: 1, message: HELLO_MESSAGE, writtenAt: now.toISOString() }
}
