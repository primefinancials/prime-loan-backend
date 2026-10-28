/**
 * Withholding tax on fixed (LOCKED) savings interest
 * --------------------------------------------------
 * Nigeria charges withholding tax on investment income, so the platform
 * withholds it on the saver's behalf when a fixed plan pays out.
 *
 * Two rules matter and are easy to get wrong:
 *
 *  1. The tax comes off the INTEREST only, never the principal. A saver who
 *     deposits ₦100,000 and earns ₦2,500 interest is taxed on the ₦2,500.
 *     They can never get back less than they put in because of this tax.
 *
 *  2. The money is not platform profit. It is held for remittance to the tax
 *     authority, so it is booked to the `tax_payable` ledger account rather
 *     than `platform_revenue`. Mixing it into revenue would overstate the
 *     company's earnings and lose track of what is owed.
 *
 * Both payout paths - the automatic maturity worker and a manual withdrawal
 * after maturity - must use this same helper, otherwise a plan could escape
 * the tax simply by maturing on its own.
 */

/** Applied when the admin has not configured a rate. */
export const DEFAULT_WITHHOLDING_TAX_RATE = 10;

/** Ledger account holding tax withheld from savers, pending remittance. */
export const TAX_PAYABLE_ACCOUNT = 'tax_payable';

export interface WithholdingTaxBreakdown {
  /** Interest earned before tax. */
  grossInterest: number;
  /** Tax withheld from the interest. */
  withholdingTax: number;
  /** Interest the saver actually receives. */
  netInterest: number;
  /** Rate applied, as a fraction (0.1 for 10%). */
  rate: number;
}

/**
 * Read the configured rate as a fraction.
 *
 * Settings store these as percentages (10 meaning 10%), but older documents
 * sometimes hold a fraction already, so follow the same normalisation the rest
 * of the savings code uses: a value of 1 or more is a percentage.
 */
export const getWithholdingTaxRate = (settings: any): number => {
  const raw = Number(settings?.savings?.fixed?.withholdingTaxRate ?? DEFAULT_WITHHOLDING_TAX_RATE);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const rate = raw >= 1 ? raw / 100 : raw;
  // A misconfigured rate must never swallow more than the interest itself.
  return Math.min(rate, 1);
};

/**
 * Split gross interest into the tax withheld and what the saver receives.
 *
 * Rounding is floored, which rounds in the saver's favour, and matches how
 * interest and penalties are rounded everywhere else in this codebase.
 */
export const applyWithholdingTax = (
  grossInterest: number,
  settings: any
): WithholdingTaxBreakdown => {
  const rate = getWithholdingTaxRate(settings);
  const gross = Math.max(0, Math.floor(Number(grossInterest) || 0));
  const withholdingTax = Math.floor(gross * rate);

  return {
    grossInterest: gross,
    withholdingTax,
    netInterest: gross - withholdingTax,
    rate,
  };
};
