export const TEAMS = ['social', 'merch'] as const
export type Team = (typeof TEAMS)[number]

export const ROLES = ['admin', 'approver', 'social_designer', 'merch_designer'] as const
export type Role = (typeof ROLES)[number]

/** Roles that must use two-step sign-in (TOTP) before any privileged action. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['admin', 'approver']

export const requiresMfa = (role: Role): boolean => MFA_REQUIRED_ROLES.includes(role)
