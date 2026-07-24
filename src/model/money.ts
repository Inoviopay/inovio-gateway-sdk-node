/**
 * Money — decimal amount + ISO-4217 currency.
 *
 * Object model §3.3 / Q7: the amount is a STRING in TypeScript, never a JS
 * `number`. Binary floats cannot represent decimal amounts exactly (0.1 + 0.2
 * !== 0.3), and the wire format is a decimal string like "1.25". Accepting a
 * number here would silently corrupt amounts, so the constructor rejects them.
 */
export class Money {
  readonly amount: string;
  readonly currency: string;

  private constructor(amount: string, currency: string) {
    this.amount = amount;
    this.currency = currency;
  }

  /**
   * @param amount decimal string, e.g. "1.25". Numbers are rejected — format
   *               them yourself so the rounding decision is explicit.
   * @param currency ISO-4217 alpha-3, e.g. "USD".
   */
  static of(amount: string, currency: string): Money {
    if (typeof (amount as unknown) === 'number') {
      throw new TypeError(
        'Money.of: amount must be a decimal string, not a number — ' +
          'binary floats cannot represent decimal amounts exactly. ' +
          'Pass "1.25", not 1.25.'
      );
    }
    if (typeof amount !== 'string' || !/^-?\d+(\.\d+)?$/.test(amount.trim())) {
      throw new TypeError(
        `Money.of: amount must be a decimal string like "1.25", got ${JSON.stringify(amount)}`
      );
    }
    if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) {
      throw new TypeError(
        `Money.of: currency must be an ISO-4217 alpha-3 code like "USD", got ${JSON.stringify(currency)}`
      );
    }
    return new Money(amount.trim(), currency.trim().toUpperCase());
  }

  /** Wire representation of the amount (what goes into LI_VALUE_n). */
  toWire(): string {
    return this.amount;
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  equals(other: Money): boolean {
    // compare numerically so "1.5" === "1.50"
    return (
      this.currency === other.currency &&
      Number(this.amount) === Number(other.amount)
    );
  }
}
