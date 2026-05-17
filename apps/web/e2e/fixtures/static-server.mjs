#!/usr/bin/env node
/**
 * Minimal static server used by the @smoke acceptance scenario under
 * Story #170. Serves `e2e/fixtures/welcome.html` at `/`. Replaced by the
 * real Astro dev server once the web client lands in a later Epic; the
 * Playwright `webServer` block in `playwright.config.ts` is the single
 * place to swap the command.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);

const welcomePath = resolve(__dirname, 'welcome.html');

const server = createServer(async (req, res) => {
  if (!req.url || req.url === '/' || req.url === '/index.html') {
    try {
      const body = await readFile(welcomePath);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`failed to read welcome.html: ${err?.message ?? err}`);
      return;
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  // Playwright's webServer probe parses stdout for the port; log it
  // explicitly so the readiness check is unambiguous.
  console.log(`static-server listening on http://127.0.0.1:${port}`);
});
