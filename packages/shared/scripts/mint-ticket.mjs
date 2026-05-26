// Mint a Clerk sign-in ticket for a persona and print JSON to stdout.
// Lives under packages/shared/scripts so @clerk/backend resolves from
// the workspace's own node_modules. NOT committed (see .gitignore add
// below or operator manual rm). Usage:
//   node packages/shared/scripts/mint-ticket.mjs <persona>
import { createClerkClient } from '@clerk/backend';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const personasPath = resolve(here, '../src/testing/clerk-personas.json');
const personas = JSON.parse(readFileSync(personasPath, 'utf8'));

// Manual .env load (no dotenv dep available here)
try {
  const envPath = resolve(here, '../../../.env');
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
} catch {
  /* .env optional */
}

const persona = process.argv[2] || 'athlete';
const userId = personas[persona];
if (!userId) {
  console.error(`Unknown persona: ${persona}. Known: ${Object.keys(personas).join(', ')}`);
  process.exit(1);
}

const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey || !secretKey.startsWith('sk_test_')) {
  console.error('CLERK_SECRET_KEY missing or not sk_test_ prefixed');
  process.exit(1);
}

const client = createClerkClient({ secretKey });
try {
  const t = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 });
  console.log(JSON.stringify({ ticket: t.token, userId: t.userId, persona }));
} catch (e) {
  console.error('MINT_ERROR:', e.message);
  process.exit(2);
}
