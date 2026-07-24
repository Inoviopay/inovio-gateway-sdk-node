/**
 * testAvailability() — TESTGW
 *
 * Health check for the gateway itself. No credentials are validated and no
 * transaction is created, so it is safe to poll.
 */
import { client, show } from './_harness.mjs';

const health = await client().testAvailability();

show('ok', health.ok);
show('service code', `${health.outcome.service.code} "${health.outcome.service.advice ?? ''}"`);
