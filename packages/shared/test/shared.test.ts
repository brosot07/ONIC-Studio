import { describe, expect, it } from 'vitest'
import { canTransition, messages, JOB_STATES } from '../src'

describe('job state machine', () => {
  it('reaches APPROVED only from PENDING_APPROVAL (or by unscheduling)', () => {
    for (const from of JOB_STATES) {
      expect(canTransition(from, 'APPROVED')).toBe(from === 'PENDING_APPROVAL' || from === 'SCHEDULED')
    }
  })
  it('never publishes without passing through SCHEDULED', () => {
    for (const from of JOB_STATES) {
      expect(canTransition(from, 'PUBLISHED')).toBe(from === 'SCHEDULED')
    }
  })
  it('cannot skip approval from QC', () => {
    expect(canTransition('QC_PASSED', 'APPROVED')).toBe(false)
    expect(canTransition('QC_PASSED', 'SCHEDULED')).toBe(false)
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false)
  })
})

describe('translations', () => {
  it('has every English string in Bahasa Indonesia', () => {
    expect(Object.keys(messages.id).sort()).toEqual(Object.keys(messages.en).sort())
    for (const value of Object.values(messages.id)) expect(value.trim()).not.toBe('')
  })
  it('never mentions AI plumbing to designers', () => {
    const banned = /\b(prompt|model|api|token|claude|anthropic|higgsfield)\b/i
    for (const lang of ['id', 'en'] as const) {
      for (const value of Object.values(messages[lang])) expect(value).not.toMatch(banned)
    }
  })
})
