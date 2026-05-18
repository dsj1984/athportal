// packages/shared/drizzle.config.ts
//
// Drizzle Kit configuration for @repo/shared. Generates the SQL migration
// files committed at packages/shared/src/db/migrations/ from the table
// definitions under packages/shared/src/db/schema/.
//
// Migrations are SQLite-flavoured (libSQL-compatible) per
// docs/architecture.md §2.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
});
