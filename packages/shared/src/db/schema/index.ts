/**
 * @repo/shared/db/schema — production Drizzle schema barrel.
 *
 * Re-exports every production table so consumers can write:
 *
 *   import { users, organizations, teams } from '@repo/shared/db/schema';
 *
 * New tables MUST be re-exported here. Test-only fixtures live under
 * `@repo/shared/testing/schema` and MUST NOT be re-exported from this
 * module.
 */

export {
  athleteMemberships,
  type AthleteMembership,
  type NewAthleteMembership,
} from './athleteMemberships';
export {
  coachAssignments,
  type CoachAssignment,
  type NewCoachAssignment,
} from './coachAssignments';
export {
  invitations,
  INVITATION_ROLES,
  INVITATION_STATUSES,
  type Invitation,
  type InvitationRole,
  type InvitationStatus,
  type NewInvitation,
} from './invitations';
export {
  legalDocuments,
  type LegalDocument,
  type NewLegalDocument,
} from './legalDocuments';
export {
  organizations,
  ORGANIZATION_TYPES,
  type Organization,
  type OrganizationType,
  type NewOrganization,
} from './organizations';
export {
  parentAthleteLinks,
  type ParentAthleteLink,
  type NewParentAthleteLink,
} from './parentAthleteLinks';
export { teams, type Team, type NewTeam } from './teams';
export {
  userLegalAgreements,
  type UserLegalAgreement,
  type NewUserLegalAgreement,
} from './userLegalAgreements';
export { users, type User, type NewUser } from './users';

import { athleteMemberships } from './athleteMemberships';
import { coachAssignments } from './coachAssignments';
import { invitations } from './invitations';
import { legalDocuments } from './legalDocuments';
import { organizations } from './organizations';
import { parentAthleteLinks } from './parentAthleteLinks';
import { teams } from './teams';
import { userLegalAgreements } from './userLegalAgreements';
import { users } from './users';

export const schema = {
  athleteMemberships,
  coachAssignments,
  invitations,
  legalDocuments,
  organizations,
  parentAthleteLinks,
  teams,
  userLegalAgreements,
  users,
};
