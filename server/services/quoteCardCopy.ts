/**
 * Copy and number formatting shown on the public quote cards.
 * The customer estimate email reuses these so the totals and warranty lines match.
 */

export const QUOTE_DISCLAIMER =
  'This is a budget estimate, not a bid or quote. Final pricing is confirmed after an on-site inspection.';

export const HDZ_SHINGLE_NAME = 'GAF Timberline HDZ';
export const UHDZ_SHINGLE_NAME = 'GAF Timberline UHDZ';

/** Warranty copy for each shingle card. Labor and algae years differ by product. */
export const QUOTE_WARRANTY = {
  label: 'Warranty:',
  wind: '15-year WindProven™ Limited Wind Warranty, no max wind speed',
  goldenPledge: {
    hdz: 'GAF Golden Pledge Warranty, 50-year shingle with 25-year labor backed by GAF',
    uhdz: 'GAF Golden Pledge Warranty, 50-year shingle with 30-year labor backed by GAF',
  },
  algae: {
    hdz: '25-year StainGuard Plus™ Algae Protection Limited Warranty',
    uhdz: '30-year StainGuard Plus PRO™ Algae Protection Limited Warranty',
  },
} as const;

export type QuoteShingleTier = 'hdz' | 'uhdz';

/** Same currency formatting as the price on each quote card. */
export function formatQuotePrice(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Same number formatting as the Sq Ft figure on the quote card. */
export function formatRoofSqFt(sqFt: number): string {
  return sqFt.toLocaleString();
}

/** Visible warranty lines for one card, in the same order the card renders them. */
export function quoteCardWarrantyLines(tier: QuoteShingleTier): readonly string[] {
  return [
    `${QUOTE_WARRANTY.label} ${QUOTE_WARRANTY.goldenPledge[tier]}`,
    QUOTE_WARRANTY.wind,
    QUOTE_WARRANTY.algae[tier],
  ];
}
