// apps/api/src/routes/v1/admin/csv-import/index.ts
//
// Barrel for the `/api/v1/admin/csv-import` sub-router (Epic #10 /
// Story #663 / Task #687). Re-exports `csvImportAdminRouter` so the
// admin tree mount point (`apps/api/src/routes/v1/admin/index.ts`)
// keeps the same import specifier (`./csv-import`) it used while
// Story #654 shipped a placeholder. The placeholder file
// (`apps/api/src/routes/v1/admin/csv-import.ts`) was removed in the
// same commit that landed `router.ts`.

export { csvImportAdminRouter as csvImportAdminRoute } from './router';
