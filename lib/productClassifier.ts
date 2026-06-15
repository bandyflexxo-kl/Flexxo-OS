/**
 * lib/productClassifier.ts
 *
 * Shared product name → category classifier.
 * Used by:
 *   - scripts/buildCategoryTree.ts  (bulk reclassification)
 *   - scripts/syncQneProducts.ts    (per-product on every QNE sync)
 *
 * No DB dependencies — pure keyword matching logic.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubCat = {
  name:     string
  slug:     string
  keywords: string[]
}

export type ParentCat = {
  name:     string
  slug:     string
  oldSlugs: string[]   // legacy flat category slugs absorbed by this parent
  subCats:  SubCat[]   // first matching sub-cat wins; last entry = catch-all (no keywords)
}

export type Override = {
  keywords:   string[]
  parentSlug: string
  subSlug:    string
}

// ── Category tree ─────────────────────────────────────────────────────────────
// Keywords are matched case-insensitively against the product name.
// Order matters: first match wins within each sub-cat list.
// The sub-cat with no keywords is the catch-all for that parent.

export const TREE: ParentCat[] = [
  {
    name: 'Office Stationery',
    slug: 'office-stationery',
    oldSlugs: ['office-stationery', 'paper', 'battery', 'corporate-gift'],
    subCats: [
      {
        name: 'Batteries',
        slug: 'os--batteries',
        keywords: ['battery', 'batteries', 'alkaline', 'dry cell', 'rechargeable battery', 'energizer', 'duracell', 'panasonic aa', 'panasonic aaa'],
      },
      {
        name: 'Paper & Books',
        slug: 'os--paper-books',
        keywords: ['a4 paper', 'a3 paper', 'a5 paper', 'copy paper', 'photocopy paper', 'paper ream', 'paper rim', 'notebook', 'notepad', 'note pad', 'exercise book', 'writing pad', 'memo pad', 'sticky note', 'post-it', 'post it', 'memo note', 'carbon paper', 'ncr paper', 'receipt book', 'bill book', 'counter book', 'log book', 'cash book', 'acc book', 'record book', 'graph paper', 'drawing book', 'sketch book'],
      },
      {
        name: 'Writing Instruments',
        slug: 'os--writing-instruments',
        keywords: ['ball pen', 'ballpen', 'gel pen', 'ink pen', 'pilot pen', 'faber pen', 'uni-ball', 'papermate', 'bic pen', 'zebra pen', 'whiteboard marker', 'white board marker', 'permanent marker', 'board marker', 'highlighter', 'marker pen', 'pencil', 'mechanical pencil', 'colour pencil', 'colored pencil', 'crayon', 'correction pen', 'correction tape', 'correction fluid', 'white out', 'tipp-ex', 'eraser', 'rubber eraser', 'fountain pen', 'rollerball', 'felt tip'],
      },
      {
        name: 'Filing & Organizers',
        slug: 'os--filing-organizers',
        keywords: ['arch file', 'lever arch', 'ring file', 'box file', 'suspension file', 'file folder', 'document file', 'expanding file', 'clear holder', 'clear book', 'poly folder', 'binder', 'document holder', 'clipboard', 'divider', 'index tab', 'filing', 'organizer', 'organiser', 'magazine file', 'lateral file'],
      },
      {
        name: 'Adhesives, Tapes & Clips',
        slug: 'os--adhesives-tapes',
        keywords: ['scotch tape', 'cello tape', 'opp tape', 'masking tape', 'double sided tape', 'foam tape', 'pvc tape', 'duct tape', 'gaffer tape', 'tape dispenser', 'stapler', 'staple ', 'paper clip', 'binder clip', 'bulldog clip', 'fold back clip', 'rubber band', 'glue stick', 'pva glue', 'super glue', 'velcro', 'blu tack', 'bluetack', 'adhesive', 'epoxy'],
      },
      {
        name: 'Desktop Accessories',
        slug: 'os--desktop-accessories',
        keywords: ['scissors', 'ruler', 'set square', 'calculator', 'desk calculator', 'date stamp', 'self-inking', 'hole punch', 'pencil sharpener', 'paper cutter', 'letter tray', 'pen holder', 'pen stand', 'desk tray', 'document tray', 'name card holder', 'rubber stamp', 'staple remover', 'letter opener', 'page magnifier', 'time stamp', 'ink pad'],
      },
      {
        name: 'Labels & Envelopes',
        slug: 'os--labels-envelopes',
        keywords: ['label ', 'sticker label', 'address label', 'name label', 'barcode label', 'envelope', 'mailing bag', 'courier bag', 'brown envelope', 'bubble mailer', 'name tag', 'badge holder', 'lanyard'],
      },
      {
        name: 'Notice Boards & Display',
        slug: 'os--notice-boards',
        keywords: ['notice board', 'whiteboard', 'white board', 'cork board', 'bulletin board', 'magnetic board', 'pin board', 'display board', 'flip chart', 'flipchart', 'chart paper', 'push pin', 'thumbtack', 'drawing pin', 'map pin'],
      },
      {
        name: 'Gifts & Premiums',
        slug: 'os--gifts-premiums',
        keywords: ['tumbler', 'coffee mug', 'corporate gift', 'door gift', 'umbrella', 'keychain', 'name card box', 'award', 'plaque', 'trophy', 'photo frame', 'premium', 'gift set'],
      },
      { name: 'General Stationery', slug: 'os--general', keywords: [] },
    ],
  },
  {
    name: 'Office Furniture',
    slug: 'office-furniture',
    oldSlugs: ['furniture'],
    subCats: [
      {
        name: 'Office Chairs',
        slug: 'of--office-chairs',
        keywords: ['office chair', 'executive chair', 'manager chair', 'mesh chair', 'ergonomic chair', 'visitor chair', 'guest chair', 'task chair', 'computer chair', 'swivel chair', 'director chair', 'conference chair', 'waiting chair', 'training chair', 'stool', 'folding chair'],
      },
      {
        name: 'Office Tables & Desks',
        slug: 'of--office-tables',
        keywords: ['office table', 'computer table', 'workstation table', 'study table', 'writing table', 'executive table', 'director table', 'l-shape table', 'l shape table', 'office desk', 'meeting table', 'seminar table', 'training table', 'folding table', 'cantilever table', 'coffee table'],
      },
      {
        name: 'Storage & Cabinets',
        slug: 'of--storage-cabinets',
        keywords: ['steel locker', 'steel cabinet', 'filing cabinet', 'pigeon hole', 'steel drawer', 'mobile pedestal', 'hanging pedestal', 'steel cupboard', 'key cabinet', 'steel rack', 'shelving rack', 'library shelf', 'shoe rack', 'locker', 'compartment locker'],
      },
      {
        name: 'Workstations & Partitions',
        slug: 'of--workstations-partitions',
        keywords: ['partition', 'workstation', 'cubicle', 'office panel', 'screen divider', 'modular workstation', 'mobile mesh', 'open plan'],
      },
      {
        name: 'Reception & Lounge',
        slug: 'of--reception-lounge',
        keywords: ['sofa', 'reception counter', 'reception desk', 'lounge chair', 'waiting sofa', 'couch', 'ottoman', 'side board'],
      },
      {
        name: 'Conference & Training',
        slug: 'of--conference-training',
        keywords: ['conference table', 'boardroom table', 'training table', 'seminar table', 'lecture table'],
      },
      { name: 'General Furniture', slug: 'of--general', keywords: [] },
    ],
  },
  {
    name: 'Printer Supplies',
    slug: 'printer-supplies',
    oldSlugs: ['printer-consumables', 'thermal-roll'],
    subCats: [
      {
        name: 'Ink Cartridges',
        slug: 'ps--ink-cartridges',
        keywords: ['ink cartridge', 'inkjet cartridge', 'ink refill', 'continuous ink', 'ciss ink', 'ink tank', 'original ink', 'compatible ink', 'epson ink', 'canon ink', 'hp ink', 'brother ink', 'pg-', 'cl-', 't664', 't773'],
      },
      {
        name: 'Toner Cartridges',
        slug: 'ps--toner-cartridges',
        keywords: ['toner cartridge', 'laser toner', 'drum unit', 'imaging unit', 'original toner', 'compatible toner', 'mytoner', 'tn-', 'ce278', 'cf280', 'ce285', 'q2612', 'cb435'],
      },
      {
        name: 'Printers & Copiers',
        slug: 'ps--printers',
        keywords: ['laser printer', 'inkjet printer', 'multifunction printer', 'mfc printer', 'all-in-one printer', 'colour printer', 'color printer', 'laser 3 in 1', 'inkjet 3 in 1', 'mfp', 'dot matrix printer', 'portable printer', 'photo printer', 'copier'],
      },
      {
        name: 'Thermal Rolls',
        slug: 'ps--thermal-rolls',
        keywords: ['thermal roll', 'thermal paper roll', 'receipt roll', 'cash register roll', 'pos roll', 'thermal receipt', 'till roll', '57mm', '80mm thermal'],
      },
      {
        name: 'Printer Accessories',
        slug: 'ps--accessories',
        keywords: ['printhead', 'print head', 'maintenance box', 'waste ink', 'printer roller', 'printer ribbon'],
      },
      { name: 'General Printer Supplies', slug: 'ps--general', keywords: [] },
    ],
  },
  {
    name: 'Computer Hardware & Software',
    slug: 'computer-hardware-software',
    oldSlugs: [],
    subCats: [
      {
        name: 'Monitors & Displays',
        slug: 'ch--monitors',
        keywords: ['monitor', 'led monitor', 'lcd monitor', 'ips monitor', 'curved monitor', 'display screen', 'computer screen', 'dell monitor', 'hp monitor', 'acer monitor', 'asus monitor', 'benq monitor', 'viewsonic'],
      },
      {
        name: 'Mouse & Keyboard',
        slug: 'ch--mouse-keyboard',
        keywords: ['optical mouse', 'wireless mouse', 'gaming mouse', 'wired mouse', 'logitech mouse', 'dell mouse', 'hp mouse', 'mechanical keyboard', 'wireless keyboard', 'keyboard mouse', 'combo keyboard', 'usb keyboard', 'numeric keypad'],
      },
      {
        name: 'Storage & Media',
        slug: 'ch--storage-media',
        keywords: ['hard disk', 'external hdd', 'internal hdd', 'solid state', 'ssd drive', 'usb flash drive', 'pen drive', 'thumb drive', 'memory card', 'sd card', 'microsd', 'dvd-r', 'dvd+r', 'dvd rw', 'cd-r', 'flash disk'],
      },
      {
        name: 'Networking',
        slug: 'ch--networking',
        keywords: ['router ', 'wifi router', 'wireless router', 'adsl modem', 'vdsl modem', 'access point', 'wifi extender', 'range extender', 'network switch', 'ethernet cable', 'lan cable', 'cat5', 'cat6', 'network hub'],
      },
      {
        name: 'Antivirus & Software',
        slug: 'ch--software',
        keywords: ['antivirus', 'anti-virus', 'internet security', 'kaspersky', 'norton', 'mcafee', 'bitdefender', 'eset', 'avast', 'software license', 'microsoft office'],
      },
      {
        name: 'Power Accessories',
        slug: 'ch--power',
        keywords: ['ups ', 'uninterruptible', 'power extension', 'extension cord', 'power strip', 'power socket', 'voltage regulator', ' avr ', 'switching power supply', 'power adapter', 'power bank', '3 pin plug'],
      },
      {
        name: 'Cables & Hubs',
        slug: 'ch--cables-hubs',
        keywords: ['usb hub', 'usb cable', 'usb-c cable', 'usb 3.0', 'usb 2.0', 'hdmi cable', 'vga cable', 'dvi cable', 'displayport', 'type-c cable', 'otg cable', 'audio cable', 'aux cable'],
      },
      {
        name: 'Audio, Video & Presentation',
        slug: 'ch--audio-video',
        keywords: ['speaker', 'multimedia speaker', 'bluetooth speaker', 'headphone', 'headset', 'earphone', 'webcam', 'microphone', 'projector', 'presentation clicker', 'laser pointer'],
      },
      { name: 'General Computer Supplies', slug: 'ch--general', keywords: [] },
    ],
  },
  {
    name: 'Office Security',
    slug: 'office-security',
    oldSlugs: [],
    subCats: [
      {
        name: 'Access Control & Attendance',
        slug: 'sec--access-control',
        keywords: ['access control', 'door access', 'fingerprint terminal', 'face terminal', 'face recognition', 'time attendance', 'attendance machine', 'rfid reader', 'card reader access', 'guard tour', 'patrol system', 'smart terminal'],
      },
      {
        name: 'CCTV & Surveillance',
        slug: 'sec--cctv',
        keywords: ['cctv', 'ip camera', 'bullet camera', 'dome camera', 'ptz camera', 'network camera', 'dvr', 'nvr', 'security camera', 'surveillance camera', 'hikvision', 'dahua'],
      },
      {
        name: 'Alarm Systems',
        slug: 'sec--alarm',
        keywords: ['alarm system', 'motion sensor', 'pir sensor', 'door contact', 'magnetic contact', 'siren', 'alarm siren', 'smoke detector', 'heat detector', 'panic button', 'paradox', 'photobeam', 'glass break', 'aleph'],
      },
      {
        name: 'Safes & Locks',
        slug: 'sec--safes-locks',
        keywords: ['cash safe', 'gun safe', 'fire safe', 'electronic safe', 'yale safe', 'digital safe', 'padlock', 'door lock', 'electronic lock', 'digital lock', 'smart lock', 'deadbolt'],
      },
      { name: 'General Security', slug: 'sec--general', keywords: [] },
    ],
  },
  {
    name: 'Office Machine',
    slug: 'office-machine',
    oldSlugs: ['office-machine'],
    subCats: [
      {
        name: 'Binding & Laminating',
        slug: 'om--binding-laminating',
        keywords: ['binding machine', 'comb binding', 'wire-o', 'wire binding', 'spiral binding', 'binding comb', 'binding strip', 'laminator', 'laminating machine', 'laminating pouch', 'laminate film', 'a3 laminator', 'a4 laminator'],
      },
      {
        name: 'Paper Shredders',
        slug: 'om--shredders',
        keywords: ['paper shredder', 'document shredder', 'office shredder', 'strip cut shredder', 'cross cut shredder', 'micro cut shredder'],
      },
      {
        name: 'Time Clock & Punch Card',
        slug: 'om--time-clock',
        keywords: ['time clock', 'time recorder', 'punch card machine', 'amano', 'seiko time', 'time card machine', 'card time recorder'],
      },
      {
        name: 'Barcode & Scanning',
        slug: 'om--barcode',
        keywords: ['barcode scanner', 'barcode reader', 'qr scanner', 'handheld scanner', 'desktop scanner', 'document scanner', 'hand labeller', 'label maker', 'dymo', 'zebra barcode', 'honeywell scanner'],
      },
      {
        name: 'Cash Handling',
        slug: 'om--cash-handling',
        keywords: ['note counter', 'bill counter', 'cash counter', 'money counter', 'coin counter', 'cheque writer', 'currency detector', 'fake note detector', 'cash box'],
      },
      {
        name: 'Sealing & Packaging',
        slug: 'om--sealing',
        keywords: ['impulse sealer', 'heat sealer', 'bag sealer', 'plastic sealer', 'sealing machine', 'packaging machine', 'shrink wrap'],
      },
      { name: 'General Office Machine', slug: 'om--general', keywords: [] },
    ],
  },
  {
    name: 'Office Equipment',
    slug: 'office-equipment',
    oldSlugs: [],
    subCats: [
      {
        name: 'Ladders',
        slug: 'oe--ladders',
        keywords: ['ladder', 'step ladder', 'extension ladder', 'foldable ladder', 'double sided ladder', 'single sided ladder', 'heavy duty ladder', 'aluminium ladder', 'fibreglass ladder'],
      },
      {
        name: 'Trolleys & Carts',
        slug: 'oe--trolleys-carts',
        keywords: ['trolley', 'utilities cart', 'platform trolley', 'hand truck', 'sack truck', 'push cart', 'service cart', 'delivery trolley'],
      },
      {
        name: 'Display Stands',
        slug: 'oe--display-stands',
        keywords: ['banner stand', 'x-banner', 'roll up banner', 'display stand', 'exhibition stand', 'easel stand', 'poster stand', 'pull up banner', 'retractable banner', 'sign stand'],
      },
      {
        name: 'Lighting',
        slug: 'oe--lighting',
        keywords: ['fluorescent tube', 'led tube', 'led bulb', 'downlight', 'emergency light', 'torch light', 'flashlight', 'work light', 'desk lamp', 'energy saving lamp'],
      },
      { name: 'General Equipment', slug: 'oe--general', keywords: [] },
    ],
  },
  {
    name: 'Breakroom',
    slug: 'breakroom',
    oldSlugs: ['office-food-pantry'],
    subCats: [
      // Snacks checked BEFORE Beverages so 'oat rich tea biscuit' beats 'tea ' keyword
      {
        name: 'Snacks & Food',
        slug: 'br--snacks-food',
        keywords: [
          'biscuit', 'cracker', 'cookie', 'cup noodle', 'instant noodle', 'snack',
          'candy', 'wafer', 'nuts', 'muesli', 'peanut', 'salted peanut',
          // chocolate-specific (avoid plain 'chocolate' which matches colour names)
          'chocolate biscuit', 'chocolate sandwich', 'chocolate wafer', 'chocolate coated',
          'chocolate cream', 'chocolate hazelnut', 'chocolate oat', 'chocolate stick',
          // brand/product name specifics
          'love letter', 'oat rich tea', 'rich tea biscuit', 'coffee waffle',
        ],
      },
      {
        name: 'Beverages',
        slug: 'br--beverages',
        keywords: [
          'coffee', 'nescafe', 'nescafé', 'milo', 'tea ', 'green tea',
          'mineral water', 'drinking water', 'juice', 'cappuccino', 'white coffee',
          'ovaltine', 'horlicks', 'ribena', 'isotonic',
          // removed '3 in 1' / '3-in-1' — too generic (matches printers, cutlery sets)
          // added specific beverage types
          'vico ', 'nestum', 'uht milk', 'oat milk', 'malt drink', 'chocolate malt',
          'creamer ', 'dairy creamer', 'condensed milk', 'barista', 'coffeemix', 'coffee mix',
        ],
      },
      { name: 'General Breakroom', slug: 'br--general', keywords: [] },
    ],
  },
  {
    name: 'Janitorial',
    slug: 'janitorial',
    oldSlugs: ['hygiene-cleaning'],
    subCats: [
      {
        name: 'Cleaning Products',
        slug: 'jan--cleaning',
        keywords: ['floor cleaner', 'toilet cleaner', 'bathroom cleaner', 'glass cleaner', 'multi purpose cleaner', 'all purpose cleaner', 'disinfectant cleaner', 'bleach', 'mop ', 'mop head', 'broom', 'floor wax', 'wax polish', 'ajax fabuloso', 'ajax multi', 'magiclean', 'domestos', 'harpic', 'mr muscle', 'scrubber', 'cleaning liquid', 'cleaning agent'],
      },
      {
        name: 'Air Fresheners',
        slug: 'jan--air-fresheners',
        keywords: ['air freshener', 'ambi pur', 'febreze', 'glade', 'instantmatic', 'aerosol freshener', 'toilet freshener', 'car freshener'],
      },
      {
        name: 'Restroom Supplies',
        slug: 'jan--restroom',
        keywords: ['toilet roll', 'toilet paper', 'bathroom tissue', 'tissue roll', 'hand towel paper', 'sanitary dispenser', 'hand dryer', 'auto hand dryer', 'soap dispenser refill'],
      },
      {
        name: 'Sanitary & Hygiene',
        slug: 'jan--sanitary',
        keywords: ['hand sanitizer', 'hand sanitiser', 'hand soap', 'liquid soap', 'antibacterial soap', 'alcohol gel', 'disinfectant spray', 'septisol', 'septi-sol', 'alcohol handrub', 'sanitary bin', 'sanitary pad dispenser'],
      },
      {
        name: 'Waste Management',
        slug: 'jan--waste',
        keywords: ['dustbin', 'rubbish bin', 'waste bin', 'garbage bin', 'trash can', 'pedal bin', 'recycle bin', 'pail with cover', 'gallon pail', 'garbage bag', 'bin liner', 'waste liner', 'bin container'],
      },
      {
        name: 'Fogging & Disinfection',
        slug: 'jan--fogging',
        keywords: ['fogger', 'fogging machine', 'disinfection machine', 'misting machine', 'spray machine anion', 'humidifier disinfect', 'air purifier'],
      },
      {
        name: 'Storage Boxes',
        slug: 'jan--storage',
        keywords: ['storage box', 'storage container', 'plastic box', 'polypropylene box', 'archive box', 'moving box', 'plastic crate', 'achieve box'],
      },
      { name: 'General Janitorial', slug: 'jan--general', keywords: [] },
    ],
  },
  {
    name: 'Safety Kits',
    slug: 'safety-kits',
    oldSlugs: ['safety-ppe'],
    subCats: [
      {
        name: 'First Aid',
        slug: 'sk--first-aid',
        keywords: ['first aid', 'bandage', 'plaster', 'antiseptic cream', 'surgical tape', 'medical tape', 'thermometer', 'pulse oximeter', 'burn gel', 'eyewash', 'cotton wool', 'gauze', 'wound care', 'medical kit'],
      },
      {
        name: 'Personal Protective Equipment',
        slug: 'sk--ppe',
        keywords: ['safety shoe', 'safety boots', 'safety helmet', 'hard hat', 'safety gloves', 'work gloves', 'safety vest', 'reflective vest', 'safety glasses', 'safety goggles', 'ear plug', 'ear muff', 'acrylic face shield', 'face shield', 'disposable glove', 'nitrile glove', 'latex glove'],
      },
      {
        name: 'Face Masks',
        slug: 'sk--masks',
        keywords: ['face mask', 'surgical mask', 'n95 mask', 'medical mask', 'kn95', 'disposable mask', '3 ply mask', '4 ply mask', 'respirator mask'],
      },
      {
        name: 'Health Testing',
        slug: 'sk--health-testing',
        keywords: ['test kit', 'antigen test', 'covid test', 'rapid test', 'pcr test', 'rtk test', 'self test', 'health screening'],
      },
      { name: 'General Safety', slug: 'sk--general', keywords: [] },
    ],
  },
]

// ── High-priority overrides ───────────────────────────────────────────────────
// Checked BEFORE per-parent keyword matching — fix products that QNE files in
// the wrong parent (e.g. ladders under office-machine).

export const OVERRIDES: Override[] = [
  // ── False-positive fixes ─────────────────────────────────────────────────────
  // These fire BEFORE any sub-cat keyword matching to prevent generic words like
  // '3 in 1', 'coffee', 'chocolate', 'juice', 'sweet' from pulling non-food items
  // into Breakroom categories.

  // Multifunction printers say "3 IN 1" or "COLOUR PRINTER" — must not match beverages
  { keywords: ['colour printer', 'color printer', 'laser 3 in 1', 'inkjet 3 in 1', '3 in 1 colour printer', '3-in-1 printer'], parentSlug: 'printer-supplies', subSlug: 'ps--printers' },

  // Mounting/art boards have colours in name ('CHOCOLATE', 'CREAM') — must not match snacks
  { keywords: ['mounting board', 'art board', 'foam board'], parentSlug: 'office-stationery', subSlug: 'os--general' },

  // Outdoor/plastic chairs have colour 'COFFEE' in name — must not match beverages
  { keywords: ['outdoor chair', 'garden chair', 'monobloc chair', 'plastic chair antirust'], parentSlug: 'office-furniture', subSlug: 'of--office-chairs' },

  // Aroma diffuser has 'SWEET' in name — must not match snacks
  { keywords: ['aroma diffuser', 'essential oil diffuser', 'reed diffuser', 'ultrasonic diffuser'], parentSlug: 'janitorial', subSlug: 'jan--air-fresheners' },

  // Breakroom appliances: juicer has 'juice' as substring, cutlery has '3 in 1'
  { keywords: ['juicer', 'juice maker', 'juice extractor', 'coffee machine', 'coffee maker', 'coffee grinder', 'water dispenser', 'water boiler', 'cutlery set', 'microwave oven'], parentSlug: 'breakroom', subSlug: 'br--general' },

  // ── Ladders ──────────────────────────────────────────────────────────────────
  { keywords: ['ladder', 'step ladder', 'extension ladder', 'foldable ladder'], parentSlug: 'office-equipment', subSlug: 'oe--ladders' },

  // Power accessories
  { keywords: ['switching power supply', 'uninterruptible power', 'power extension', 'extension cord', '3 pin plug', 'voltage regulator', ' avr ', 'power bank'], parentSlug: 'computer-hardware-software', subSlug: 'ch--power' },

  // IT peripherals
  { keywords: ['wireless mouse', 'optical mouse', 'logitech mouse', 'usb mouse', 'gaming mouse', 'dell mouse'], parentSlug: 'computer-hardware-software', subSlug: 'ch--mouse-keyboard' },
  { keywords: ['wireless keyboard', 'usb keyboard', 'mechanical keyboard', 'gaming keyboard'], parentSlug: 'computer-hardware-software', subSlug: 'ch--mouse-keyboard' },
  { keywords: ['led monitor', 'lcd monitor', 'ips monitor', 'computer monitor', 'dell monitor', 'benq monitor', 'acer monitor'], parentSlug: 'computer-hardware-software', subSlug: 'ch--monitors' },
  { keywords: ['usb hub', 'hdmi cable', 'vga cable', 'usb-c cable', 'otg cable', 'usb 3.0 cable', 'usb 2.0 cable'], parentSlug: 'computer-hardware-software', subSlug: 'ch--cables-hubs' },
  { keywords: ['wifi router', 'wireless router', 'adsl modem', 'access point wifi', 'lan cable', 'cat5e', 'cat6 cable'], parentSlug: 'computer-hardware-software', subSlug: 'ch--networking' },
  { keywords: ['antivirus', 'kaspersky', 'norton security', 'mcafee', 'bitdefender'], parentSlug: 'computer-hardware-software', subSlug: 'ch--software' },
  { keywords: ['pen drive', 'thumb drive', 'flash disk', 'external hdd', 'dvd-r ', 'cd-r '], parentSlug: 'computer-hardware-software', subSlug: 'ch--storage-media' },
  { keywords: ['multimedia speaker', 'bluetooth speaker', 'headphone', 'headset earphone', 'webcam', 'projector '], parentSlug: 'computer-hardware-software', subSlug: 'ch--audio-video' },

  // Security items
  { keywords: ['alarm system', 'motion sensor', 'pir sensor', 'door contact', 'paradox', 'photobeam', 'aleph '], parentSlug: 'office-security', subSlug: 'sec--alarm' },
  { keywords: ['cctv', 'ip camera', 'bullet camera', 'dome camera', 'nvr ', 'dvr security'], parentSlug: 'office-security', subSlug: 'sec--cctv' },
  { keywords: ['access control', 'door access', 'face terminal', 'guard tour'], parentSlug: 'office-security', subSlug: 'sec--access-control' },
  { keywords: ['electronic safe', 'digital safe', 'fire safe', 'electronic lock', 'digital lock'], parentSlug: 'office-security', subSlug: 'sec--safes-locks' },

  // Office machines
  { keywords: ['paper shredder', 'document shredder', 'office shredder'], parentSlug: 'office-machine', subSlug: 'om--shredders' },
  { keywords: ['binding machine', 'comb binding', 'binding comb', 'binding strip', 'laminator', 'laminating machine', 'laminating pouch'], parentSlug: 'office-machine', subSlug: 'om--binding-laminating' },
  { keywords: ['note counter', 'bill counter', 'cash counter', 'cheque writer', 'coin counter'], parentSlug: 'office-machine', subSlug: 'om--cash-handling' },
  { keywords: ['impulse sealer', 'heat sealer', 'bag sealer'], parentSlug: 'office-machine', subSlug: 'om--sealing' },

  // Equipment
  { keywords: ['trolley', 'utilities cart', 'platform trolley', 'hand truck', 'sack truck'], parentSlug: 'office-equipment', subSlug: 'oe--trolleys-carts' },
  { keywords: ['banner stand', 'x-banner', 'roll up banner', 'display stand', 'retractable banner'], parentSlug: 'office-equipment', subSlug: 'oe--display-stands' },
  { keywords: ['fluorescent tube', 'led tube', 'led bulb', 'downlight', 'torch light', 'desk lamp led'], parentSlug: 'office-equipment', subSlug: 'oe--lighting' },

  // Janitorial
  { keywords: ['floor cleaner', 'toilet cleaner', 'ajax fabuloso', 'ajax multi purpose', 'magiclean', 'domestos', 'harpic', 'mr muscle', 'ajax cleaner'], parentSlug: 'janitorial', subSlug: 'jan--cleaning' },
  { keywords: ['air freshener', 'ambi pur', 'febreze', 'glade ', 'instantmatic'], parentSlug: 'janitorial', subSlug: 'jan--air-fresheners' },
  { keywords: ['hand sanitizer', 'hand sanitiser', 'hand wash', 'handwash', 'hand soap', 'septisol', 'septi-sol', 'alcohol handrub'], parentSlug: 'janitorial', subSlug: 'jan--sanitary' },
  { keywords: ['dustbin', 'rubbish bin', 'waste bin', 'garbage bin', 'pedal bin', 'pail with cover', 'gallon pail', 'garbage bag', 'bin liner'], parentSlug: 'janitorial', subSlug: 'jan--waste' },
  { keywords: ['fogger', 'fogging machine', 'disinfection machine', 'misting machine', 'anion humidifier', 'spray anion'], parentSlug: 'janitorial', subSlug: 'jan--fogging' },
  { keywords: ['toilet roll', 'toilet paper', 'tissue roll', 'hand towel paper', 'sanitary bin', 'hand dryer auto'], parentSlug: 'janitorial', subSlug: 'jan--restroom' },
  { keywords: ['storage box', 'achieve box', 'archive box', 'plastic crate', 'polypropylene box'], parentSlug: 'janitorial', subSlug: 'jan--storage' },

  // Safety
  { keywords: ['3 ply medical face mask', 'surgical mask', 'n95 mask', 'kn95', 'disposable mask', '3 ply mask'], parentSlug: 'safety-kits', subSlug: 'sk--masks' },
  { keywords: ['acrylic protective face shield', 'face shield', 'protective face shield'], parentSlug: 'safety-kits', subSlug: 'sk--ppe' },
  { keywords: ['first aid kit', 'surgical tape', 'micropore', 'antiseptic cream', 'bandage'], parentSlug: 'safety-kits', subSlug: 'sk--first-aid' },
  { keywords: ['covid-19', 'covid test', 'antigen rapid test', 'rapid test kit', 'rtk test'], parentSlug: 'safety-kits', subSlug: 'sk--health-testing' },
  { keywords: ['safety shoe', 'safety boots', 'nitrile glove', 'disposable glove', 'latex glove'], parentSlug: 'safety-kits', subSlug: 'sk--ppe' },

  // Punch cards belong in Office Machine, not Office Stationery
  { keywords: ['punch card 100', 'mkp punch card', 'aplus punch card'], parentSlug: 'office-machine', subSlug: 'om--time-clock' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function matchesAny(productName: string, keywords: string[]): boolean {
  const lower = productName.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

/**
 * Classify a product into the 10-category tree.
 *
 * @param productName      - The product's display name (from QNE stockName)
 * @param currentParentSlug - Hint: the product's current/legacy category slug.
 *                           Used to narrow keyword search to the right parent.
 *                           Accepts both new slugs (e.g. 'printer-supplies')
 *                           and old legacy slugs (e.g. 'printer-consumables').
 * @returns { parentSlug, subSlug } — both are slugs in the active category tree.
 */
export function classify(
  productName: string,
  currentParentSlug: string,
): { parentSlug: string; subSlug: string } {
  // Step 1: High-priority overrides (fix known misclassifications)
  for (const ov of OVERRIDES) {
    if (matchesAny(productName, ov.keywords)) {
      return { parentSlug: ov.parentSlug, subSlug: ov.subSlug }
    }
  }

  // Step 2: Find the right parent from the hint slug (new or old slug)
  const parent = TREE.find(
    p => p.slug === currentParentSlug || p.oldSlugs.includes(currentParentSlug),
  )

  if (parent) {
    // Step 3: Keyword-match within this parent's sub-cats (first match wins)
    for (const sub of parent.subCats) {
      if (sub.keywords.length > 0 && matchesAny(productName, sub.keywords)) {
        return { parentSlug: parent.slug, subSlug: sub.slug }
      }
    }
    // No sub-cat match — use parent's catch-all (last entry, no keywords)
    const catchAll = parent.subCats[parent.subCats.length - 1]!
    return { parentSlug: parent.slug, subSlug: catchAll.slug }
  }

  // Step 4: No parent found from hint — cross-tree keyword search
  for (const p of TREE) {
    for (const sub of p.subCats) {
      if (sub.keywords.length > 0 && matchesAny(productName, sub.keywords)) {
        return { parentSlug: p.slug, subSlug: sub.slug }
      }
    }
  }

  // Step 5: Default fallback
  return { parentSlug: 'office-stationery', subSlug: 'os--general' }
}
