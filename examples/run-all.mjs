#!/usr/bin/env node
/**
 * Runs every example in order.
 *
 * Mock transport by default. Set INOVIO_LIVE=1 with credentials to run the
 * same code against the real gateway:
 *
 *   INOVIO_LIVE=1 INOVIO_USER=... INOVIO_PASS=... INOVIO_SITE_ID=... \
 *   INOVIO_SITE_KEY=... node examples/run-all.mjs
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIVE } from './_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => /^\d\d-.*\.mjs$/.test(f))
  .sort();

console.log(`Running ${files.length} examples against ${LIVE ? 'the LIVE gateway' : 'a mock transport'}\n`);

let failed = 0;
for (const f of files) {
  const title = f.replace(/^\d\d-|\.mjs$/g, '').replace(/-/g, ' ');
  console.log(`── ${title}`);
  try {
    await import(pathToFileURL(resolve(here, f)).href);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${e.constructor.name}: ${e.message}`);
  }
  console.log();
}

console.log(failed === 0 ? `✅ all ${files.length} examples ran` : `❌ ${failed} of ${files.length} failed`);
process.exit(failed === 0 ? 0 : 1);
