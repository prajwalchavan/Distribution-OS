/** Seed of the i18n catalog. Real catalogs move to i18next JSON per app; keys stay stable. */
export const strings = {
  en: {
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'qty.case': 'cs',
    'qty.piece': 'pcs',
    'order.submit': 'Place order',
    'delivery.collect': 'Collect payment',
  },
  hi: {
    'common.save': 'सेव करें',
    'common.cancel': 'रद्द करें',
    'qty.case': 'पेटी',
    'qty.piece': 'नग',
    'order.submit': 'ऑर्डर दें',
    'delivery.collect': 'पेमेंट लें',
  },
} as const

export type Locale = keyof typeof strings
export type StringKey = keyof (typeof strings)['en']
