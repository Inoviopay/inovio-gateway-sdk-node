/**
 * testAuth() — TESTAUTH
 *
 * Verifies your credentials without creating a transaction. Use it to confirm
 * a new merchant's REQ_USERNAME / REQ_PASSWORD / SITE_ID before going live.
 *
 * Bad credentials raise AuthenticationError (API tier 101), not a decline.
 */
import { AuthenticationError } from '../dist/index.js';
import { client, show } from './_harness.mjs';

try {
  const health = await client().testAuth();
  show('ok', health.ok);
  show('service code', `${health.outcome.service.code} "${health.outcome.service.advice ?? ''}"`);
} catch (e) {
  if (e instanceof AuthenticationError) {
    show('rejected', e.message);
  } else {
    throw e;
  }
}
