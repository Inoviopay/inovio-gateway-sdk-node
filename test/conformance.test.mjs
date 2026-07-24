/**
 * Cross-language conformance suite.
 *
 * Runs the shared fixtures in this repo's spec/conformance-fixtures.json against a
 * mocked transport. Every SDK (Node, PHP, Python, Java) runs this same corpus
 * and must produce the same typed result — that is the mechanism keeping five
 * implementations honest (PLAN.md §5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InovioClient,
  Money,
  PaymentMethods,
  Refs,
  TimeoutError,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const { fixtures } = JSON.parse(
  readFileSync(resolve(here, '../spec/conformance-fixtures.json'), 'utf8')
);

/** Captures the outgoing params and replays a canned response. */
class MockHttp {
  constructor(response, { simulate } = {}) {
    this.response = response;
    this.simulate = simulate;
    this.lastParams = null;
  }
  async post(_url, body) {
    this.lastParams = Object.fromEntries(new URLSearchParams(body));
    if (this.simulate === 'timeout') {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    // Fixtures carry either a flat field map or a CCSTATUS COLUMNS/DATA
    // table; both are replayed verbatim as the gateway would send them.
    return { status: 200, body: JSON.stringify(this.response ?? {}) };
  }
}

const creds = { reqUsername: 'u', reqPassword: 'p', siteId: '1' };

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function buildRequest(spec) {
  const pm = spec.paymentMethod;
  let paymentMethod;
  if (pm.kind === 'card') paymentMethod = PaymentMethods.card(pm.number, pm.expiry, pm.cvv);
  else if (pm.kind === 'token') paymentMethod = PaymentMethods.token(pm.guid);
  else paymentMethod = PaymentMethods.savedCard(pm);

  const req = {
    paymentMethod,
    lineItems: spec.lineItems.map((li) => ({
      productId: li.productId,
      count: li.count,
      value: Money.of(li.value.amount, li.value.currency),
    })),
  };
  if (spec.idempotency) req.idempotency = spec.idempotency;
  if (spec.partialAuth) {
    req.partialAuth = {
      enabled: spec.partialAuth.enabled,
      minimumAmount: spec.partialAuth.minimumAmount
        ? Money.of(spec.partialAuth.minimumAmount.amount, spec.partialAuth.minimumAmount.currency)
        : undefined,
    };
  }
  return req;
}

for (const fx of fixtures) {
  test(`conformance: ${fx.name}`, async () => {
    const op = fx.request.operation;

    // --- non-transport fixtures ---
    if (op === 'constructMoney') {
      assert.throws(() => Money.of(fx.request.amount, fx.request.currency));
      return;
    }

    const http = new MockHttp(fx.response, { simulate: fx.simulate });
    const client = new InovioClient(creds, {
      httpClient: http,
      endpoint: 'https://gateway.invalid/payment/pmt_service.cfm',
      timeoutMs: 50,
    });

    let result;
    let thrown;
    try {
      if (op === 'sale') result = await client.sale(buildRequest(fx.request));
      else if (op === 'authorize') result = await client.authorize(buildRequest(fx.request));
      else if (op === 'status') result = await client.status(Refs.order(fx.request.orderRef));
      else throw new Error(`unhandled fixture operation: ${op}`);
    } catch (e) {
      thrown = e;
    }

    const exp = fx.expect ?? {};

    // --- expected throws ---
    if (typeof exp.throws === 'string') {
      assert.ok(thrown, `expected ${exp.throws} to be thrown, got none`);
      assert.equal(thrown.constructor.name, exp.throws, `wrong error type: ${thrown.stack}`);
      if (exp['error.refField'] !== undefined) {
        assert.equal(thrown.refField, exp['error.refField']);
      }
      if (exp['error.xtlOrderId'] !== undefined) {
        assert.ok(thrown instanceof TimeoutError);
        assert.equal(thrown.xtlOrderId, exp['error.xtlOrderId']);
      }
      return;
    }
    if (exp.throws === false && thrown) {
      assert.fail(`a decline must NOT throw, but got ${thrown.constructor.name}: ${thrown.message}`);
    }
    if (thrown) throw thrown;

    // --- outgoing request params ---
    for (const [k, v] of Object.entries(fx.expectRequestParams ?? {})) {
      assert.equal(http.lastParams[k], v, `request param ${k}`);
    }

    // --- result assertions ---
    for (const [path, want] of Object.entries(exp)) {
      if (path === 'throws') continue;
      if (path === 'statusNot') {
        assert.notEqual(result.status, want);
        continue;
      }
      if (path === 'transactions.length') {
        assert.equal(result.transactions.length, want);
        continue;
      }
      const got = get(result, path);
      if (want === null) {
        assert.ok(
          got === null || got === undefined,
          `${path}: expected absent, got ${JSON.stringify(got)}`
        );
      } else {
        assert.equal(got, want, `${path}`);
      }
    }
  });
}
