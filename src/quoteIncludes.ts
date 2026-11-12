export type QuoteIncludeItem = {
  text: string;
  href?: string;
  linkText?: string;
};

/** Warranty lines on each shingle card. The label is separate from the sentences. */
export const QUOTE_WARRANTY = {
  label: 'Warranty:',
  lines: [
    'GAF Golden Pledge Warranty, 50-year shingle with 25-year labor backed by GAF',
    'Unlimited wind warranty on shingles',
    '25-year algae resistance warranty',
  ],
} as const;

/** What's included on each shingle card. Edit this list to change those items. */
export const QUOTE_INCLUDES: readonly QuoteIncludeItem[] = [
  { text: 'Full tear-off plus up to 2 sheets of decking replaced' },
  { text: 'Synthetic underlayment plus ice and water shield in valleys and penetrations' },
  { text: 'New drip edge on full perimeter and all new flashing' },
  { text: 'New ridge vent and new metal (Never Leak) pipe flashings' },
  { text: 'Haul off and dispose of all old material and magnet sweep property' },
  { text: 'GAF starter strip and matching ridge cap shingles' },
  {
    text: 'Financing is available',
    href: 'https://projects.greensky.com/MerchantLoanApplication?apptype=short&merchant=81101872&dealerplan=2521&channel=External-Button-03',
    linkText: 'Click here to apply',
  },
];

/** Plain-text credential. GAF brand rules: no logo file. */
export const GAF_MASTER_ELITE_LABEL = 'GAF Master Elite® Contractor';

export const GAF_CONTRACTOR_ID = '1115371';
