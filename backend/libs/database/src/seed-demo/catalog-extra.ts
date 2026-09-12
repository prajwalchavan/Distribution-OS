/**
 * The catalogue the realistic demo adds on top of the original 17 products (QA/tools/seed spec §2):
 * six FICTIONAL manufacturers with seven brands across beverages, biscuits, namkeen, staples, dairy,
 * personal care and household — 69 products, 145 variants — plus the GST slabs they sit in, the
 * supplier-invoice spellings docint matches on, and the brand-DMS item codes.
 *
 * Every entry here is APPENDED after the original arrays in `catalog.ts` (rule G4: existing ids and
 * field values never move); the four real brands the founder asked to keep are untouched. All names,
 * licences and codes below are invented.
 */
import type { BrandDef, ManufacturerDef, ProductDef, VariantDef } from './catalog.js'

type Unit = VariantDef['netUnit']
type Status = NonNullable<VariantDef['status']>
/** [key suffix, printed size, net qty, unit, pieces per case, MRP in rupees, status?] */
type V = readonly [string, string, number, Unit, number, number, Status?]

interface ProductSpec {
  key: string
  manufacturerKey: string
  brandKey: string
  name: string
  category: string
  hsnCode: string
  gstBps: number
  cessBps?: number
  shelfLifeDays: number
  status?: Status
  variants: readonly V[]
}

function product(p: ProductSpec): ProductDef {
  return {
    key: p.key,
    manufacturerKey: p.manufacturerKey,
    brandKey: p.brandKey,
    name: p.name,
    category: p.category,
    ...(p.status ? { status: p.status } : {}),
    variants: p.variants.map(([suffix, name, netQty, netUnit, caseSize, mrpRupees, status]) => ({
      key: `${p.key}-${suffix}`,
      name,
      netQty,
      netUnit,
      caseSize,
      mrpPaise: mrpRupees * 100,
      shelfLifeDays: p.shelfLifeDays,
      hsnCode: p.hsnCode,
      gstBps: p.gstBps,
      cessBps: p.cessBps ?? 0,
      ...(status ? { status } : {}),
    })),
  }
}

export const EXTRA_MANUFACTURERS: ManufacturerDef[] = [
  {
    key: 'rajwadi',
    name: 'Rajwadi Beverages',
    legalName: 'Rajwadi Beverages Private Limited, Nashik',
    fssaiLicense: '10015043006001',
    website: 'https://www.rajwadi.in',
  },
  {
    key: 'sunrisebakers',
    name: 'Sunrise Bakers',
    legalName: 'Sunrise Bakers Private Limited, Pune',
    fssaiLicense: '10015043006002',
    website: 'https://www.sunbake.in',
  },
  {
    key: 'konkansnack',
    name: 'Konkan Snack Company',
    legalName: 'Konkan Snack Company, Ratnagiri',
    fssaiLicense: '10015043006003',
    website: 'https://www.konkancrunch.in',
  },
  {
    key: 'annapurnaagro',
    name: 'Annapurna Agro Foods',
    legalName: 'Annapurna Agro Foods Limited, Kalyan',
    fssaiLicense: '10015043006004',
    website: 'https://www.annapurna.in',
  },
  {
    key: 'godavaridairy',
    name: 'Godavari Dairy Products',
    legalName: 'Godavari Dairy Products Limited, Ahmednagar',
    fssaiLicense: '10015043006005',
    website: 'https://www.godavari.in',
  },
  {
    key: 'shubhda',
    name: 'Shubhda Consumer Care',
    legalName: 'Shubhda Consumer Care Private Limited, Vapi',
    fssaiLicense: '10015043006006',
    website: 'https://www.neelam.in',
  },
]

export const EXTRA_BRANDS: BrandDef[] = [
  { key: 'rajwadi', manufacturerKey: 'rajwadi', name: 'Rajwadi' },
  { key: 'sunbake', manufacturerKey: 'sunrisebakers', name: 'Sunbake' },
  { key: 'konkancrunch', manufacturerKey: 'konkansnack', name: 'Konkan Crunch' },
  { key: 'annapurna', manufacturerKey: 'annapurnaagro', name: 'Annapurna' },
  { key: 'godavari', manufacturerKey: 'godavaridairy', name: 'Godavari' },
  { key: 'neelam', manufacturerKey: 'shubhda', name: 'Neelam' },
  { key: 'chamak', manufacturerKey: 'shubhda', name: 'Chamak' },
]

const rajwadi = (p: Omit<ProductSpec, 'manufacturerKey' | 'brandKey' | 'category'>) =>
  product({ ...p, manufacturerKey: 'rajwadi', brandKey: 'rajwadi', category: 'Beverages' })
const sunbake = (key: string, name: string, variants: readonly V[]) =>
  product({
    key,
    name,
    manufacturerKey: 'sunrisebakers',
    brandKey: 'sunbake',
    category: 'Biscuits',
    hsnCode: '1905',
    gstBps: 1800,
    shelfLifeDays: 240,
    variants,
  })
const konkan = (key: string, name: string, variants: readonly V[], status?: Status) =>
  product({
    key,
    name,
    manufacturerKey: 'konkansnack',
    brandKey: 'konkancrunch',
    category: 'Snacks - Namkeen',
    hsnCode: '2106',
    gstBps: 1200,
    shelfLifeDays: 120,
    ...(status ? { status } : {}),
    variants,
  })
const annapurna = (
  key: string,
  name: string,
  hsnCode: string,
  variants: readonly V[],
  opts: { gstBps?: number; shelfLifeDays?: number } = {},
) =>
  product({
    key,
    name,
    manufacturerKey: 'annapurnaagro',
    brandKey: 'annapurna',
    category: 'Packaged Food',
    hsnCode,
    gstBps: opts.gstBps ?? 500,
    shelfLifeDays: opts.shelfLifeDays ?? 270,
    variants,
  })
const godavari = (
  key: string,
  name: string,
  hsnCode: string,
  gstBps: number,
  shelfLifeDays: number,
  variants: readonly V[],
  status?: Status,
) =>
  product({
    key,
    name,
    manufacturerKey: 'godavaridairy',
    brandKey: 'godavari',
    category: 'Dairy',
    hsnCode,
    gstBps,
    shelfLifeDays,
    ...(status ? { status } : {}),
    variants,
  })
const neelam = (key: string, name: string, hsnCode: string, variants: readonly V[]) =>
  product({
    key,
    name,
    manufacturerKey: 'shubhda',
    brandKey: 'neelam',
    category: 'Personal Care',
    hsnCode,
    gstBps: 1800,
    shelfLifeDays: 730,
    variants,
  })
const chamak = (
  key: string,
  name: string,
  hsnCode: string,
  variants: readonly V[],
  status?: Status,
) =>
  product({
    key,
    name,
    manufacturerKey: 'shubhda',
    brandKey: 'chamak',
    category: 'Household',
    hsnCode,
    gstBps: 1800,
    shelfLifeDays: 730,
    ...(status ? { status } : {}),
    variants,
  })

const SODA_SIZES: readonly V[] = [
  ['250ml', '250 ml', 250, 'ml', 48, 15],
  ['500ml', '500 ml', 500, 'ml', 24, 30],
  ['1250ml', '1.25 L', 1250, 'ml', 12, 60],
]

export const EXTRA_PRODUCTS: ProductDef[] = [
  // --- Rajwadi: sodas and fruit drinks out of Nashik --------------------------------------------
  rajwadi({
    key: 'rajwadi-jeera-masala-soda',
    name: 'Rajwadi Jeera Masala Soda',
    hsnCode: '2202',
    gstBps: 2800,
    cessBps: 1200,
    shelfLifeDays: 270,
    variants: SODA_SIZES,
  }),
  rajwadi({
    key: 'rajwadi-lemon-soda',
    name: 'Rajwadi Lemon Soda',
    hsnCode: '2202',
    gstBps: 2800,
    cessBps: 1200,
    shelfLifeDays: 270,
    variants: SODA_SIZES,
  }),
  rajwadi({
    key: 'rajwadi-aamras-mango-drink',
    name: 'Rajwadi Aamras Mango Drink',
    hsnCode: '2202',
    gstBps: 1200,
    shelfLifeDays: 180,
    variants: [
      ['200ml', '200 ml', 200, 'ml', 27, 12],
      ['600ml', '600 ml', 600, 'ml', 24, 40],
      ['1l', '1 L', 1, 'l', 12, 70],
    ],
  }),
  rajwadi({
    key: 'rajwadi-apple-nectar',
    name: 'Rajwadi Apple Nectar',
    hsnCode: '2202',
    gstBps: 1200,
    shelfLifeDays: 180,
    variants: [
      ['200ml', '200 ml', 200, 'ml', 27, 15, 'discontinued'],
      ['1l', '1 L', 1, 'l', 12, 80],
    ],
  }),
  rajwadi({
    key: 'rajwadi-josh-energy-drink',
    name: 'Rajwadi Josh Energy Drink',
    hsnCode: '2202',
    gstBps: 2800,
    cessBps: 1200,
    shelfLifeDays: 270,
    variants: [['250ml', '250 ml', 250, 'ml', 24, 50]],
  }),
  rajwadi({
    key: 'rajwadi-soda-water',
    name: 'Rajwadi Soda Water',
    hsnCode: '2201',
    gstBps: 1800,
    shelfLifeDays: 365,
    variants: [['750ml', '750 ml', 750, 'ml', 24, 20]],
  }),

  // --- Sunbake: biscuits out of Pune ------------------------------------------------------------
  sunbake('sunbake-glucose', 'Sunbake Glucose', [
    ['32g', '32 g', 32, 'g', 144, 5],
    ['55g', '55 g', 55, 'g', 120, 10],
    ['110g', '110 g', 110, 'g', 72, 20],
    ['250g', '250 g', 250, 'g', 48, 45],
  ]),
  sunbake('sunbake-marie-light', 'Sunbake Marie Light', [
    ['75g', '75 g', 75, 'g', 96, 15],
    ['150g', '150 g', 150, 'g', 60, 30],
    ['300g', '300 g', 300, 'g', 36, 55],
  ]),
  sunbake('sunbake-bourbon-cream', 'Sunbake Bourbon Cream', [
    ['60g', '60 g', 60, 'g', 96, 10],
    ['120g', '120 g', 120, 'g', 60, 20],
    ['300g', '300 g', 300, 'g', 30, 50],
  ]),
  sunbake('sunbake-orange-cream', 'Sunbake Orange Cream', [
    ['60g', '60 g', 60, 'g', 96, 10, 'discontinued'],
    ['120g', '120 g', 120, 'g', 60, 20],
  ]),
  sunbake('sunbake-elaichi-cream', 'Sunbake Elaichi Cream', [
    ['60g', '60 g', 60, 'g', 96, 10],
    ['120g', '120 g', 120, 'g', 60, 20],
  ]),
  sunbake('sunbake-digestive-hi-fibre', 'Sunbake Digestive Hi-Fibre', [
    ['100g', '100 g', 100, 'g', 72, 30],
    ['250g', '250 g', 250, 'g', 36, 70],
  ]),
  sunbake('sunbake-butter-cookies', 'Sunbake Butter Cookies', [
    ['75g', '75 g', 75, 'g', 72, 20],
    ['200g', '200 g', 200, 'g', 36, 50],
  ]),
  sunbake('sunbake-kaju-pista-cookies', 'Sunbake Kaju Pista Cookies', [
    ['75g', '75 g', 75, 'g', 72, 25],
    ['200g', '200 g', 200, 'g', 36, 60],
  ]),
  sunbake('sunbake-salted-cracker', 'Sunbake Salted Cracker', [
    ['60g', '60 g', 60, 'g', 96, 10],
    ['200g', '200 g', 200, 'g', 36, 40],
  ]),
  sunbake('sunbake-choco-chip-cookies', 'Sunbake Choco Chip Cookies', [
    ['40g', '40 g', 40, 'g', 120, 10],
    ['120g', '120 g', 120, 'g', 48, 30],
  ]),

  // --- Konkan Crunch: namkeen out of Ratnagiri --------------------------------------------------
  konkan('konkan-kerala-banana-chips', 'Konkan Kerala Banana Chips', [
    ['40g', '40 g', 40, 'g', 72, 20],
    ['150g', '150 g', 150, 'g', 36, 60],
    ['400g', '400 g', 400, 'g', 20, 150],
  ]),
  konkan('konkan-bhajani-chivda', 'Konkan Bhajani Chivda', [
    ['100g', '100 g', 100, 'g', 48, 35],
    ['400g', '400 g', 400, 'g', 20, 120],
  ]),
  konkan('konkan-farsan-mix', 'Konkan Farsan Mix', [
    ['100g', '100 g', 100, 'g', 48, 35],
    ['400g', '400 g', 400, 'g', 20, 120],
  ]),
  konkan('konkan-aloo-bhujia', 'Konkan Aloo Bhujia', [
    ['42g', '42 g', 42, 'g', 96, 10],
    ['200g', '200 g', 200, 'g', 36, 45],
    ['400g', '400 g', 400, 'g', 20, 85],
  ]),
  konkan('konkan-masala-khakhra', 'Konkan Masala Khakhra', [
    ['180g', '180 g', 180, 'g', 30, 50],
    ['360g', '360 g', 360, 'g', 20, 95],
  ]),
  konkan('konkan-roasted-peanut-masala', 'Konkan Roasted Peanut Masala', [
    ['40g', '40 g', 40, 'g', 96, 10],
    ['150g', '150 g', 150, 'g', 36, 40],
  ]),
  // Proposed by the pilot: usable at once, waiting for the curator (ADR 0005).
  konkan(
    'konkan-ratlami-sev',
    'Konkan Ratlami Sev',
    [['180g', '180 g', 180, 'g', 36, 45, 'proposed']],
    'proposed',
  ),

  // --- Annapurna: staples milled in Kalyan ------------------------------------------------------
  annapurna('annapurna-chakki-fresh-atta', 'Annapurna Chakki Fresh Atta', '1101', [
    ['1kg', '1 kg', 1, 'kg', 10, 55],
    ['5kg', '5 kg', 5, 'kg', 5, 255],
    ['10kg', '10 kg', 10, 'kg', 3, 495],
  ]),
  annapurna('annapurna-kolam-rice', 'Annapurna Kolam Rice', '1006', [
    ['1kg', '1 kg', 1, 'kg', 12, 68],
    ['5kg', '5 kg', 5, 'kg', 5, 330],
    ['25kg', '25 kg', 25, 'kg', 1, 1590],
  ]),
  annapurna('annapurna-basmati-classic', 'Annapurna Basmati Classic', '1006', [
    ['1kg', '1 kg', 1, 'kg', 12, 135],
    ['5kg', '5 kg', 5, 'kg', 4, 650],
  ]),
  annapurna('annapurna-toor-dal', 'Annapurna Toor Dal', '0713', [
    ['500g', '500 g', 500, 'g', 20, 95],
    ['1kg', '1 kg', 1, 'kg', 12, 185],
  ]),
  annapurna('annapurna-chana-dal', 'Annapurna Chana Dal', '0713', [
    ['500g', '500 g', 500, 'g', 20, 55],
    ['1kg', '1 kg', 1, 'kg', 12, 105],
  ]),
  annapurna('annapurna-besan', 'Annapurna Besan', '1106', [
    ['500g', '500 g', 500, 'g', 20, 60],
    ['1kg', '1 kg', 1, 'kg', 12, 115],
  ]),
  annapurna('annapurna-thick-poha', 'Annapurna Thick Poha', '1904', [
    ['500g', '500 g', 500, 'g', 20, 35],
    ['1kg', '1 kg', 1, 'kg', 12, 65],
  ]),
  annapurna('annapurna-bombay-rava', 'Annapurna Bombay Rava', '1103', [
    ['500g', '500 g', 500, 'g', 20, 28],
    ['1kg', '1 kg', 1, 'kg', 12, 52],
  ]),
  annapurna(
    'annapurna-iodised-salt',
    'Annapurna Iodised Salt',
    '2501',
    [['1kg', '1 kg', 1, 'kg', 24, 28]],
    {
      gstBps: 0,
    },
  ),
  annapurna('annapurna-sulphurless-sugar', 'Annapurna Sulphurless Sugar', '1701', [
    ['1kg', '1 kg', 1, 'kg', 20, 48],
    ['5kg', '5 kg', 5, 'kg', 5, 235],
  ]),
  annapurna(
    'annapurna-sunflower-refined-oil',
    'Annapurna Sunflower Refined Oil',
    '1512',
    [
      ['1l', '1 L pouch', 1, 'l', 12, 135],
      ['5l', '5 L jar', 5, 'l', 4, 660],
    ],
    { shelfLifeDays: 180 },
  ),
  annapurna(
    'annapurna-filtered-groundnut-oil',
    'Annapurna Filtered Groundnut Oil',
    '1508',
    [
      ['1l', '1 L', 1, 'l', 12, 210],
      ['5l', '5 L', 5, 'l', 4, 1035],
    ],
    { shelfLifeDays: 180 },
  ),
  annapurna(
    'annapurna-turmeric-powder',
    'Annapurna Turmeric Powder',
    '0910',
    [
      ['100g', '100 g', 100, 'g', 48, 32],
      ['500g', '500 g', 500, 'g', 20, 150],
    ],
    { shelfLifeDays: 365 },
  ),
  annapurna(
    'annapurna-red-chilli-powder',
    'Annapurna Red Chilli Powder',
    '0910',
    [
      ['100g', '100 g', 100, 'g', 48, 45],
      ['500g', '500 g', 500, 'g', 20, 210],
    ],
    { shelfLifeDays: 365 },
  ),
  annapurna(
    'annapurna-garam-masala',
    'Annapurna Garam Masala',
    '0910',
    [
      ['50g', '50 g', 50, 'g', 72, 45],
      ['100g', '100 g', 100, 'g', 48, 85],
    ],
    { shelfLifeDays: 365 },
  ),

  // --- Godavari: dairy from the Ahmednagar chilling centre --------------------------------------
  godavari('godavari-toned-uht-milk', 'Godavari Toned UHT Milk', '0401', 0, 120, [
    ['500ml', '500 ml', 500, 'ml', 24, 32],
    ['1l', '1 L', 1, 'l', 12, 62],
  ]),
  godavari('godavari-full-cream-uht-milk', 'Godavari Full Cream UHT Milk', '0401', 0, 120, [
    ['500ml', '500 ml', 500, 'ml', 24, 37],
    ['1l', '1 L', 1, 'l', 12, 72],
  ]),
  godavari('godavari-flavoured-milk-rose', 'Godavari Flavoured Milk Rose', '2202', 1200, 120, [
    ['180ml', '180 ml', 180, 'ml', 27, 25],
  ]),
  godavari(
    'godavari-flavoured-milk-kesar-badam',
    'Godavari Flavoured Milk Kesar Badam',
    '2202',
    1200,
    120,
    [['180ml', '180 ml', 180, 'ml', 27, 25]],
  ),
  godavari(
    'godavari-flavoured-milk-chocolate',
    'Godavari Flavoured Milk Chocolate',
    '2202',
    1200,
    120,
    [['180ml', '180 ml', 180, 'ml', 27, 25]],
  ),
  godavari('godavari-masala-chaas', 'Godavari Masala Chaas', '0403', 0, 21, [
    ['200ml', '200 ml', 200, 'ml', 30, 12],
    ['1l', '1 L', 1, 'l', 12, 55],
  ]),
  godavari('godavari-dahi', 'Godavari Dahi', '0403', 0, 21, [
    ['200g', '200 g', 200, 'g', 30, 22],
    ['400g', '400 g', 400, 'g', 20, 42],
    ['1kg', '1 kg', 1, 'kg', 8, 95],
  ]),
  godavari('godavari-fresh-paneer', 'Godavari Fresh Paneer', '0406', 500, 15, [
    ['200g', '200 g', 200, 'g', 24, 95],
    ['500g', '500 g', 500, 'g', 12, 225],
  ]),
  godavari('godavari-table-butter', 'Godavari Table Butter', '0405', 1200, 180, [
    ['100g', '100 g', 100, 'g', 48, 58],
    ['500g', '500 g', 500, 'g', 20, 280],
  ]),
  godavari('godavari-cow-ghee', 'Godavari Cow Ghee', '0405', 1200, 365, [
    ['200ml', '200 ml', 200, 'ml', 24, 165],
    ['500ml', '500 ml', 500, 'ml', 12, 395],
    ['1l', '1 L', 1, 'l', 8, 770],
  ]),
  godavari('godavari-cheese-slices', 'Godavari Cheese Slices', '0406', 1200, 180, [
    ['200g', '200 g', 200, 'g', 24, 145],
  ]),
  godavari('godavari-dairy-whitener', 'Godavari Dairy Whitener', '0402', 500, 270, [
    ['200g', '200 g', 200, 'g', 36, 115],
    ['500g', '500 g', 500, 'g', 20, 275],
  ]),
  godavari(
    'godavari-kesar-shrikhand',
    'Godavari Kesar Shrikhand',
    '0406',
    1200,
    30,
    [['200g', '200 g', 200, 'g', 24, 65, 'proposed']],
    'proposed',
  ),

  // --- Neelam: personal care out of Vapi --------------------------------------------------------
  neelam('neelam-sandal-soap', 'Neelam Sandal Soap', '3401', [
    ['100g', '100 g', 100, 'g', 72, 42],
    ['3x100g', '3 x 100 g pack', 300, 'g', 24, 120],
  ]),
  neelam('neelam-rose-soap', 'Neelam Rose Soap', '3401', [
    ['100g', '100 g', 100, 'g', 72, 42],
    ['3x100g', '3 x 100 g pack', 300, 'g', 24, 120],
  ]),
  neelam('neelam-neem-soap', 'Neelam Neem Soap', '3401', [['100g', '100 g', 100, 'g', 72, 38]]),
  neelam('neelam-anti-dandruff-shampoo', 'Neelam Anti-Dandruff Shampoo', '3305', [
    ['5ml', '5 ml sachet', 5, 'ml', 480, 2],
    ['175ml', '175 ml', 175, 'ml', 24, 110],
    ['340ml', '340 ml', 340, 'ml', 18, 199],
  ]),
  neelam('neelam-coconut-hair-oil', 'Neelam Coconut Hair Oil', '3305', [
    ['100ml', '100 ml', 100, 'ml', 48, 48],
    ['200ml', '200 ml', 200, 'ml', 36, 90],
    ['500ml', '500 ml', 500, 'ml', 20, 210],
  ]),
  neelam('neelam-herbal-toothpaste', 'Neelam Herbal Toothpaste', '3306', [
    ['50g', '50 g', 50, 'g', 96, 35],
    ['100g', '100 g', 100, 'g', 72, 62],
    ['200g', '200 g', 200, 'g', 36, 115],
  ]),
  neelam('neelam-tooth-brush', 'Neelam Tooth Brush', '9603', [
    ['single', 'single', 1, 'pcs', 144, 25],
    ['2plus1', '2+1 pack', 3, 'pcs', 48, 50],
  ]),
  neelam('neelam-prickly-heat-talc', 'Neelam Prickly Heat Talc', '3304', [
    ['100g', '100 g', 100, 'g', 48, 65],
    ['300g', '300 g', 300, 'g', 24, 165],
  ]),
  neelam('neelam-handwash', 'Neelam Handwash', '3401', [
    ['200ml', '200 ml pump', 200, 'ml', 24, 75],
    ['750ml', '750 ml refill', 750, 'ml', 12, 165],
  ]),
  neelam('neelam-cold-cream', 'Neelam Cold Cream', '3304', [
    ['30g', '30 g', 30, 'g', 72, 45],
    ['50g', '50 g', 50, 'g', 48, 70],
  ]),

  // --- Chamak: household out of Vapi ------------------------------------------------------------
  chamak('chamak-detergent-powder', 'Chamak Detergent Powder', '3402', [
    ['500g', '500 g', 500, 'g', 24, 55],
    ['1kg', '1 kg', 1, 'kg', 12, 105],
    ['4kg', '4 kg', 4, 'kg', 4, 399],
  ]),
  chamak('chamak-detergent-bar', 'Chamak Detergent Bar', '3401', [
    ['125g', '125 g', 125, 'g', 72, 10],
    ['250g', '250 g', 250, 'g', 48, 20],
  ]),
  chamak('chamak-dishwash-bar', 'Chamak Dishwash Bar', '3401', [
    ['145g', '145 g', 145, 'g', 60, 15],
    ['300g', '300 g', 300, 'g', 36, 30],
  ]),
  chamak('chamak-dishwash-gel', 'Chamak Dishwash Gel', '3402', [
    ['225ml', '225 ml', 225, 'ml', 36, 45],
    ['750ml', '750 ml', 750, 'ml', 12, 129],
  ]),
  chamak('chamak-floor-cleaner', 'Chamak Floor Cleaner', '3808', [
    ['500ml', '500 ml', 500, 'ml', 24, 85],
    ['1l', '1 L', 1, 'l', 12, 155],
    ['2l', '2 L', 2, 'l', 6, 285],
  ]),
  chamak('chamak-toilet-cleaner', 'Chamak Toilet Cleaner', '3808', [
    ['500ml', '500 ml', 500, 'ml', 24, 89],
    ['1l', '1 L', 1, 'l', 12, 165],
  ]),
  chamak('chamak-white-phenyl', 'Chamak White Phenyl', '3808', [
    ['1l', '1 L', 1, 'l', 12, 75],
    ['5l', '5 L', 5, 'l', 4, 330],
  ]),
  // Withdrawn from the range: the product and its only variant are discontinued.
  chamak(
    'chamak-glass-cleaner',
    'Chamak Glass Cleaner',
    '3402',
    [['500ml', '500 ml', 500, 'ml', 24, 95, 'discontinued']],
    'discontinued',
  ),
]

/** The GST slabs the new catalogue sits in: 0 / 5 / 12 / 18 / 28 + 12 cess (spec §2.2). */
export const EXTRA_HSN_RATES: {
  key: string
  hsnCode: string
  description: string
  gstBps: number
  cessBps: number
}[] = [
  {
    key: 'hsn-2202-fruit',
    hsnCode: '2202',
    description: 'Fruit pulp / fruit juice based drinks',
    gstBps: 1200,
    cessBps: 0,
  },
  {
    key: 'hsn-2201',
    hsnCode: '2201',
    description: 'Soda water, waters not sweetened',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-1905-biscuits',
    hsnCode: '1905',
    description: 'Biscuits, sweet',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-2106-prepacked',
    hsnCode: '2106',
    description: 'Namkeen, pre-packed and labelled',
    gstBps: 1200,
    cessBps: 0,
  },
  {
    key: 'hsn-1101',
    hsnCode: '1101',
    description: 'Wheat flour, pre-packed',
    gstBps: 500,
    cessBps: 0,
  },
  { key: 'hsn-1006', hsnCode: '1006', description: 'Rice, pre-packed', gstBps: 500, cessBps: 0 },
  {
    key: 'hsn-1103',
    hsnCode: '1103',
    description: 'Cereal groats / meal (rava)',
    gstBps: 500,
    cessBps: 0,
  },
  {
    key: 'hsn-1106',
    hsnCode: '1106',
    description: 'Flour of dried leguminous vegetables (besan)',
    gstBps: 500,
    cessBps: 0,
  },
  {
    key: 'hsn-1904',
    hsnCode: '1904',
    description: 'Prepared cereals (poha)',
    gstBps: 500,
    cessBps: 0,
  },
  {
    key: 'hsn-0713',
    hsnCode: '0713',
    description: 'Dried leguminous vegetables (dals)',
    gstBps: 500,
    cessBps: 0,
  },
  { key: 'hsn-1701', hsnCode: '1701', description: 'Cane / beet sugar', gstBps: 500, cessBps: 0 },
  { key: 'hsn-1508', hsnCode: '1508', description: 'Groundnut oil', gstBps: 500, cessBps: 0 },
  { key: 'hsn-1512', hsnCode: '1512', description: 'Sunflower oil', gstBps: 500, cessBps: 0 },
  {
    key: 'hsn-0910',
    hsnCode: '0910',
    description: 'Spices, ground, pre-packed',
    gstBps: 500,
    cessBps: 0,
  },
  { key: 'hsn-2501', hsnCode: '2501', description: 'Common salt, iodised', gstBps: 0, cessBps: 0 },
  { key: 'hsn-0401', hsnCode: '0401', description: 'Milk, UHT', gstBps: 0, cessBps: 0 },
  { key: 'hsn-0403', hsnCode: '0403', description: 'Buttermilk, curd', gstBps: 0, cessBps: 0 },
  {
    key: 'hsn-0402',
    hsnCode: '0402',
    description: 'Milk powder / dairy whitener',
    gstBps: 500,
    cessBps: 0,
  },
  {
    key: 'hsn-0406-paneer',
    hsnCode: '0406',
    description: 'Paneer, pre-packed',
    gstBps: 500,
    cessBps: 0,
  },
  {
    key: 'hsn-0406-cheese',
    hsnCode: '0406',
    description: 'Processed cheese',
    gstBps: 1200,
    cessBps: 0,
  },
  { key: 'hsn-0405', hsnCode: '0405', description: 'Butter and ghee', gstBps: 1200, cessBps: 0 },
  {
    key: 'hsn-3401',
    hsnCode: '3401',
    description: 'Soap, organic surface-active bars',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-3402',
    hsnCode: '3402',
    description: 'Organic surface-active preparations',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-3304',
    hsnCode: '3304',
    description: 'Beauty / skin-care preparations',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-3305',
    hsnCode: '3305',
    description: 'Preparations for use on the hair',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-3306',
    hsnCode: '3306',
    description: 'Oral / dental hygiene preparations',
    gstBps: 1800,
    cessBps: 0,
  },
  { key: 'hsn-3808', hsnCode: '3808', description: 'Disinfectants', gstBps: 1800, cessBps: 0 },
  {
    key: 'hsn-9603',
    hsnCode: '9603',
    description: 'Brushes (tooth brushes)',
    gstBps: 1800,
    cessBps: 0,
  },
]

/** Supplier-invoice spellings for docint's alias match. */
export const EXTRA_ALIASES: { variantKey: string; alias: string; hits: number }[] = [
  {
    variantKey: 'rajwadi-jeera-masala-soda-500ml',
    alias: 'RAJWADI JEERA SODA 500ML PET X24',
    hits: 12,
  },
  {
    variantKey: 'rajwadi-aamras-mango-drink-200ml',
    alias: 'RAJWADI AAMRAS 200ML TETRA X27',
    hits: 9,
  },
  { variantKey: 'rajwadi-soda-water-750ml', alias: 'RAJWADI SODA WATER 750 ML X 24', hits: 4 },
  { variantKey: 'sunbake-glucose-55g', alias: 'SUNBAKE GLUCOSE 55G_120', hits: 31 },
  { variantKey: 'sunbake-glucose-250g', alias: 'SUNBAKE GLUCOSE 250G_48', hits: 17 },
  { variantKey: 'sunbake-marie-light-150g', alias: 'SUNBAKE MARIE LIGHT 150G_60', hits: 15 },
  { variantKey: 'sunbake-bourbon-cream-120g', alias: 'SB BOURBON 120G_60', hits: 11 },
  {
    variantKey: 'konkan-kerala-banana-chips-150g',
    alias: 'KONKAN BANANA CHIPS 150G X 36',
    hits: 8,
  },
  { variantKey: 'konkan-aloo-bhujia-200g', alias: 'KONKAN ALOO BHUJIA 200 GM X36', hits: 10 },
  {
    variantKey: 'annapurna-chakki-fresh-atta-5kg',
    alias: 'ANNAPURNA CHAKKI ATTA 5KG BAG',
    hits: 26,
  },
  {
    variantKey: 'annapurna-chakki-fresh-atta-10kg',
    alias: 'ANNAPURNA CHAKKI ATTA 10KG BAG',
    hits: 14,
  },
  { variantKey: 'annapurna-kolam-rice-25kg', alias: 'ANNAPURNA KOLAM RICE 25 KG', hits: 6 },
  { variantKey: 'annapurna-toor-dal-1kg', alias: 'ANNAPURNA TUR DAL 1KG X 12', hits: 13 },
  {
    variantKey: 'annapurna-sunflower-refined-oil-1l',
    alias: 'ANNAPURNA SUNFLOWER OIL 1LTR POUCH X12',
    hits: 19,
  },
  { variantKey: 'godavari-toned-uht-milk-1l', alias: 'GODAVARI TONED MILK UHT 1L X12', hits: 22 },
  { variantKey: 'godavari-fresh-paneer-200g', alias: 'GODAVARI PANEER 200G CRATE24', hits: 9 },
  { variantKey: 'godavari-cow-ghee-500ml', alias: 'GODAVARI COW GHEE 500ML JAR X12', hits: 7 },
  { variantKey: 'neelam-sandal-soap-100g', alias: 'NEELAM SANDAL SOAP 100G X72', hits: 18 },
  {
    variantKey: 'neelam-anti-dandruff-shampoo-5ml',
    alias: 'NEELAM AD SHAMPOO SACHET 5ML X480',
    hits: 12,
  },
  { variantKey: 'chamak-detergent-powder-1kg', alias: 'CHAMAK DET POWDER 1KG X12', hits: 16 },
]

/** FieldAssist item codes for the Sunbake range (Too Yumm's are derived in `catalog.ts`). */
export const EXTRA_EXTERNAL_CODES: { variantKey: string; system: string; code: string }[] = [
  { variantKey: 'sunbake-glucose-32g', system: 'field_assist', code: 'FA-SB-0032' },
  { variantKey: 'sunbake-glucose-55g', system: 'field_assist', code: 'FA-SB-0055' },
  { variantKey: 'sunbake-glucose-110g', system: 'field_assist', code: 'FA-SB-0110' },
  { variantKey: 'sunbake-glucose-250g', system: 'field_assist', code: 'FA-SB-0250' },
  { variantKey: 'sunbake-marie-light-150g', system: 'field_assist', code: 'FA-SB-1150' },
  { variantKey: 'sunbake-bourbon-cream-120g', system: 'field_assist', code: 'FA-SB-2120' },
  { variantKey: 'sunbake-butter-cookies-200g', system: 'field_assist', code: 'FA-SB-3200' },
]

/** Brands whose variants carry an `inner` pack, and its size. The Neelam sachet is a per-variant extra. */
export const INNER_PACK_BY_BRAND: Readonly<Record<string, number>> = {
  tooyumm: 12,
  sunbake: 12,
  konkancrunch: 6,
}
export const INNER_PACK_BY_VARIANT: Readonly<Record<string, number>> = {
  'neelam-anti-dandruff-shampoo-5ml': 16,
}
