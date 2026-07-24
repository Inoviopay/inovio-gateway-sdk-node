#!/usr/bin/env node
/**
 * Generate src/enums/generated.ts from ../spec/spec-enums.json.
 *
 * This is decision D1 in PLAN.md §6: enums and their classifiers come from one
 * machine-readable spec artifact, not hand-copied per language. Every SDK runs
 * the equivalent of this script, so the five languages cannot drift.
 *
 * Do not edit the generated file — edit the spec extract and re-run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(here, '../../spec/spec-enums.json');
const OUT = resolve(here, '../src/enums/generated.ts');

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
const { appendices: A, apiVersion } = spec;

const q = (s) => JSON.stringify(s);

let out = `// GENERATED FILE — DO NOT EDIT.
// Source: Inovio Gateway Payments Service API v${apiVersion} (api-sdk/spec/spec-enums.json)
// Regenerate: npm run generate
//
// Classifiers (retryable/terminal/stopRecurring, AVS/CVV classification, and
// the API-code -> exception mapping) are DERIVED by the SDK project, not stated
// in the spec. See api-sdk/spec/README.md.

`;

/* ---------------------------------------------------- transaction status */
out += `/** Appendix B — the master transaction lifecycle (5 states). */
export const TRANSACTION_STATUS = {
${A.B_transactionStatus.map((e) => `  ${e.code}: ${q(e.code)},`).join('\n')}
} as const;

export type TransactionStatus =
  (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];

export const TRANSACTION_STATUS_DESCRIPTIONS: Record<TransactionStatus, string> = {
${A.B_transactionStatus.map((e) => `  ${e.code}: ${q(e.description)},`).join('\n')}
};

`;

/* ----------------------------------------------------- service request types */
out += `/** Appendix A — every REQUEST_ACTION the gateway accepts. */
export const REQUEST_ACTION = {
${A.A_serviceRequestTypes.map((e) => `  ${e.code}: ${q(e.code)},`).join('\n')}
} as const;

export type RequestAction = (typeof REQUEST_ACTION)[keyof typeof REQUEST_ACTION];

`;

/* ------------------------------------------------------ service response codes */
out += `/** Appendix D — service response code metadata + decline taxonomy. */
export interface ServiceResponseCodeInfo {
  readonly code: number;
  readonly description: string;
  /** Transient — a retry may succeed. Partner dunning logic branches on this. */
  readonly retryable: boolean;
  /** Hard stop for recurring/card-on-file billing; do not retry this credential. */
  readonly stopRecurring: boolean;
  /** Approval band (1xx). */
  readonly approval: boolean;
  /** Neither approval nor retryable — do not retry. */
  readonly terminal: boolean;
}

export const SERVICE_RESPONSE_CODES: Readonly<Record<number, ServiceResponseCodeInfo>> = {
${A.D_serviceResponseCodes
  .map(
    (e) =>
      `  ${e.code}: { code: ${e.code}, description: ${q(e.description)}, retryable: ${e.retryable}, stopRecurring: ${e.stopRecurring}, approval: ${e.approval}, terminal: ${e.terminal} },`
  )
  .join('\n')}
};

`;

/* ---------------------------------------------------------- api response codes */
out += `/** Appendix C — gateway request-validation codes (fire before the processor). */
export interface ApiResponseCodeInfo {
  readonly code: number;
  readonly description: string;
  readonly recommendation: string;
  /** Which SDK exception this code raises (object model §3.7). */
  readonly mapsToException: string;
  /** Response carries REF_FIELD naming the offending field. */
  readonly carriesRefField: boolean;
}

export const API_RESPONSE_CODES: Readonly<Record<number, ApiResponseCodeInfo>> = {
${A.C_apiResponseCodes
  .map(
    (e) =>
      `  ${e.code}: { code: ${e.code}, description: ${q(e.description)}, recommendation: ${q(e.recommendation)}, mapsToException: ${q(e.mapsToException)}, carriesRefField: ${e.carriesRefField} },`
  )
  .join('\n')}
};

`;

/* --------------------------------------------------------------------- AVS */
out += `/** Appendix E — AVS codes. \`classification\` is derived, not from the spec. */
export type AvsClassification = 'positive' | 'partial' | 'negative' | 'neutral';

export interface AvsCodeInfo {
  readonly code: string;
  readonly description: string;
  readonly cardNetwork: string;
  /**
   * DERIVED. \`partial\` means some elements matched and some did not (e.g.
   * street matches, postal does not). Whether a partial is acceptable is a
   * merchant risk-policy decision — the SDK reports, it does not decide.
   */
  readonly classification: AvsClassification;
}

export const AVS_CODES: Readonly<Record<string, AvsCodeInfo>> = {
${A.E_avsCodes
  .map(
    (e) =>
      `  ${q(e.code)}: { code: ${q(e.code)}, description: ${q(e.description)}, cardNetwork: ${q(e.cardNetwork)}, classification: ${q(e.classification)} },`
  )
  .join('\n')}
};

`;

/* --------------------------------------------------------------------- CVV */
out += `/** Appendix F — CVV codes. \`classification\` is derived, not from the spec. */
export type CvvClassification = 'match' | 'no_match' | 'neutral';

export interface CvvCodeInfo {
  readonly code: string;
  readonly description: string;
  readonly classification: CvvClassification;
}

export const CVV_CODES: Readonly<Record<string, CvvCodeInfo>> = {
${A.F_cvvCodes
  .map(
    (e) =>
      `  ${q(e.code)}: { code: ${q(e.code)}, description: ${q(e.description)}, classification: ${q(e.classification)} },`
  )
  .join('\n')}
};

export const SPEC_API_VERSION = ${q(apiVersion)};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');

const n =
  A.A_serviceRequestTypes.length +
  A.B_transactionStatus.length +
  A.C_apiResponseCodes.length +
  A.D_serviceResponseCodes.length +
  A.E_avsCodes.length +
  A.F_cvvCodes.length;
console.log(`generated ${OUT} (${n} enum values from spec v${apiVersion})`);
