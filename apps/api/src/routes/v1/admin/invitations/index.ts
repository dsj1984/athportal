// apps/api/src/routes/v1/admin/invitations/index.ts
//
// Barrel for the `/api/v1/admin/invitations` sub-router (Epic #10 /
// Story #655 / Task #668). Re-exports `invitationsAdminRoute` so the
// admin tree mount point (`apps/api/src/routes/v1/admin/index.ts`)
// keeps the same import specifier (`./invitations`) it used while
// Story #654 shipped a placeholder. The placeholder file
// (`apps/api/src/routes/v1/admin/invitations.ts`) was removed in the
// same commit that landed `router.ts`; Node's resolver picks
// `./invitations/index.ts` next, so the swap is invisible to the
// admin router.

export { invitationsAdminRouter as invitationsAdminRoute } from './router';
