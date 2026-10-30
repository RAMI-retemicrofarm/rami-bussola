import { describe, expect, it } from 'vitest'
import { CALLER_REFUSED, editorOnly, triggerOrEditor, type Callers } from './callers.ts'

const BUSSOLA_ACCOUNT = 'amministratore.bussola@example.org'

function callers(active: string, triggerIds: string[] = ['uid-1', 'uid-2']): Callers & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    activeEmail: () => (asked.push('active'), active),
    effectiveEmail: () => (asked.push('effective'), BUSSOLA_ACCOUNT),
    triggerIds: () => (asked.push('triggers'), triggerIds),
  }
}

describe('le funzioni dall’editor', () => {
  it('passano se chi le lancia è l’account effettivo, senza badare a maiuscole e spazi', () => {
    expect(() => editorOnly(callers(BUSSOLA_ACCOUNT))).not.toThrow()
    expect(() => editorOnly(callers('  Amministratore.Bussola@Example.org '))).not.toThrow()
  })

  it('si fermano con un altro account del dominio, anche quello della segreteria, e dicono con quale si lanciano', () => {
    expect(() => editorOnly(callers('socio@example.org'))).toThrow(CALLER_REFUSED)
    expect(() => editorOnly(callers('segreteria@example.org'))).toThrow(CALLER_REFUSED)
    expect(CALLER_REFUSED).toBe(
      'Questa funzione la lancia solo il motore, o chi cura la Bussola dall’editor, entrato con l’account della Bussola.',
    )
  })

  it('si fermano se Google non dice chi le lancia', () => {
    expect(() => editorOnly(callers(''))).toThrow(CALLER_REFUSED)
    expect(() => editorOnly(callers('   '))).toThrow(CALLER_REFUSED)
  })
})

describe('i gestori dei trigger', () => {
  it('passano con il triggerUid di un trigger del progetto, anche se l’account attivo è un altro', () => {
    expect(() => triggerOrEditor(callers('socio@example.org'), { triggerUid: 'uid-2' })).not.toThrow()
    expect(() => triggerOrEditor(callers(''), { triggerUid: 'uid-1' })).not.toThrow()
  })

  it('un triggerUid inventato non basta', () => {
    expect(() => triggerOrEditor(callers('socio@example.org'), { triggerUid: 'uid-3' })).toThrow(CALLER_REFUSED)
    expect(() => triggerOrEditor(callers('socio@example.org'), { triggerUid: '' })).toThrow(CALLER_REFUSED)
    expect(() => triggerOrEditor(callers('socio@example.org', []), { triggerUid: 'uid-1' })).toThrow(CALLER_REFUSED)
  })

  it('senza evento valgono le regole dell’editor, così si lanciano a mano', () => {
    expect(() => triggerOrEditor(callers(BUSSOLA_ACCOUNT), undefined)).not.toThrow()
    expect(() => triggerOrEditor(callers(BUSSOLA_ACCOUNT), 'qualcosa')).not.toThrow()
    expect(() => triggerOrEditor(callers('socio@example.org'), undefined)).toThrow(CALLER_REFUSED)
    expect(() => triggerOrEditor(callers('socio@example.org'), null)).toThrow(CALLER_REFUSED)
    expect(() => triggerOrEditor(callers('socio@example.org'), {})).toThrow(CALLER_REFUSED)
  })

  it('un triggerUid che non è una stringa non passa', () => {
    const ids = { toString: () => 'uid-1' }
    expect(() => triggerOrEditor(callers('socio@example.org'), { triggerUid: ids })).toThrow(CALLER_REFUSED)
  })

  it('non chiede i trigger al progetto se l’evento non ha un triggerUid', () => {
    const fake = callers(BUSSOLA_ACCOUNT)
    triggerOrEditor(fake, {})
    expect(fake.asked).not.toContain('triggers')
  })
})
