/**
 * Job lifecycle. The database enforces these transitions (Phase 1); this list is the
 * single source the app and the Edge Functions read from.
 */
export const JOB_STATES = [
  'DRAFT',
  'RUNNING',
  'NEEDS_DESIGNER',
  'QC_PASSED',
  'PENDING_APPROVAL',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'PUBLISH_FAILED',
  'FINAL',
] as const
export type JobState = (typeof JOB_STATES)[number]

export const JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  DRAFT: ['RUNNING'],
  RUNNING: ['QC_PASSED', 'NEEDS_DESIGNER'],
  NEEDS_DESIGNER: ['RUNNING'],
  QC_PASSED: ['PENDING_APPROVAL', 'RUNNING'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  REJECTED: ['RUNNING'],
  APPROVED: ['SCHEDULED', 'FINAL'],
  SCHEDULED: ['PUBLISHED', 'PUBLISH_FAILED', 'APPROVED'],
  PUBLISH_FAILED: ['SCHEDULED'],
  PUBLISHED: [],
  FINAL: [],
}

export const canTransition = (from: JobState, to: JobState): boolean =>
  JOB_TRANSITIONS[from].includes(to)
