/**
 * PaymentMethod — the central polymorphic type (object model §3.2).
 *
 * This exists to absorb the `PMT_NUMB` wire overload: that one field means PAN
 * (card), bank account number (ACH), or IBAN (SEPA/iDEAL/EPS) depending on the
 * rail. The SDK keys the wire semantics off the concrete variant so a partner
 * never sees the overload.
 *
 * v1 fills Card / Token / SavedCard. The remaining variants are declared so
 * that adding a rail later fills a seam instead of reshaping `sale()`.
 */

/** Raw PAN entry. Puts the caller in PCI scope — prefer Token where possible. */
export interface Card {
  readonly kind: 'card';
  /** PAN -> PMT_NUMB */
  readonly number: string;
  /** MMYYYY -> PMT_EXPIRY */
  readonly expiry: string;
  /** CVV2/CVC2 -> PMT_KEY */
  readonly cvv?: string;
}

/** Single-use ephemeral token from the token service. -> TOKEN_GUID */
export interface Token {
  readonly kind: 'token';
  readonly guid: string;
}

/** A previously vaulted card. -> PMT_ID / PMT_ID_XTL (+ CUST_ID) */
export interface SavedCard {
  readonly kind: 'savedCard';
  readonly pmtId?: string;
  readonly pmtIdXtl?: string;
  readonly custId?: string;
}

/* ---- declared for later phases; not constructible in v1 ---------------- */

/** Scheme/network token — mostly read-side (TRANS_NTOKEN_USED). Phase v2.x. */
export interface NetworkToken {
  readonly kind: 'networkToken';
  readonly value: string;
}

/** Apple/Google Pay token. Phase v2.x. */
export interface WalletToken {
  readonly kind: 'walletToken';
  readonly walletType: 'applepay' | 'googlepay';
  readonly cryptogram: string;
}

/** Merchant-decrypted EMVCo token. Phase v2.x. */
export interface DecryptedWalletToken {
  readonly kind: 'decryptedWalletToken';
  readonly provider: string;
  readonly tavv: string;
  readonly eci?: string;
  readonly tid?: string;
}

/** ACH — PMT_NUMB carries the account number, paired with BANK_IDENTIFIER. Phase v2. */
export interface BankAccount {
  readonly kind: 'bankAccount';
  readonly accountNumber: string;
  readonly routingNumber: string;
}

/** EU direct debit — PMT_NUMB carries the IBAN, with DEBIT_TYPE. Phase v2. */
export interface BankMandate {
  readonly kind: 'bankMandate';
  readonly iban: string;
  readonly debitType: 'SEPA' | 'iDEAL' | 'EPS';
}

export type PaymentMethod =
  | Card
  | Token
  | SavedCard
  | NetworkToken
  | WalletToken
  | DecryptedWalletToken
  | BankAccount
  | BankMandate;

/** Payment methods implemented in v1. */
export type PaymentMethodV1 = Card | Token | SavedCard;

/* ---- constructors ------------------------------------------------------ */

export const PaymentMethods = {
  /**
   * @param number PAN
   * @param expiry MMYYYY (the wire format — validated here so a bad format
   *               fails locally instead of as a gateway 111/112)
   */
  card(number: string, expiry: string, cvv?: string): Card {
    if (!/^\d{12,19}$/.test(number.replace(/[\s-]/g, ''))) {
      throw new TypeError('PaymentMethods.card: number must be 12-19 digits');
    }
    if (!/^\d{6}$/.test(expiry)) {
      throw new TypeError(
        `PaymentMethods.card: expiry must be MMYYYY (6 digits), got ${JSON.stringify(expiry)}`
      );
    }
    const mm = Number(expiry.slice(0, 2));
    if (mm < 1 || mm > 12) {
      throw new TypeError(`PaymentMethods.card: expiry month out of range in ${expiry}`);
    }
    if (cvv !== undefined && !/^\d{3,4}$/.test(cvv)) {
      throw new TypeError('PaymentMethods.card: cvv must be 3-4 digits');
    }
    return { kind: 'card', number: number.replace(/[\s-]/g, ''), expiry, cvv };
  },

  token(guid: string): Token {
    if (!guid) throw new TypeError('PaymentMethods.token: guid is required');
    return { kind: 'token', guid };
  },

  savedCard(ref: { pmtId?: string; pmtIdXtl?: string; custId?: string }): SavedCard {
    if (!ref.pmtId && !ref.pmtIdXtl) {
      throw new TypeError(
        'PaymentMethods.savedCard: one of pmtId or pmtIdXtl is required'
      );
    }
    return { kind: 'savedCard', ...ref };
  },
} as const;

/** Guard used by the request builder to reject not-yet-implemented rails. */
export function assertV1PaymentMethod(pm: PaymentMethod): asserts pm is PaymentMethodV1 {
  if (pm.kind !== 'card' && pm.kind !== 'token' && pm.kind !== 'savedCard') {
    throw new TypeError(
      `payment method "${pm.kind}" is declared in the model but not implemented in v1 ` +
        `(v1 supports card, token, savedCard)`
    );
  }
}
