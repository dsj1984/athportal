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
  legalDocuments,
  type LegalDocument,
  type NewLegalDocument,
} from './legalDocuments';
export { organizations, type Organization, type NewOrganization } from './organizations';
export { teams, type Team, type NewTeam } from './teams';
export { users, type User, type NewUser } from './users';

import { legalDocuments } from './legalDocuments';
import { organizations } from './organizations';
import { teams } from './teams';
import { users } from './users';

export const schema = { legalDocuments, organizations, teams, users };
