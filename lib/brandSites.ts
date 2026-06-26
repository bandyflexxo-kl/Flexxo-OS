/**
 * Maps brand names (uppercase, trimmed) to their official website domain.
 * Used by the photo-scraping pipeline to restrict image searches to official sources only.
 * Add new brands here as needed — key must match the `brand` field in the products table (uppercase).
 */
export const BRAND_OFFICIAL_SITES: Record<string, string> = {
  // ── 3M family ──────────────────────────────────────────────────────────────
  '3M':                 '3m.com',
  'POST-IT':            'post-it.com',
  'POST IT':            'post-it.com',
  'SCOTCH':             '3m.com',
  'SCOTCH BRITE':       '3m.com',
  'SCOTCH-BRITE':       '3m.com',

  // ── Malaysian / SEA brands ─────────────────────────────────────────────────
  'APLUS':              'aplus.com.my',
  'A-PLUS':             'aplus.com.my',
  'A PLUS':             'aplus.com.my',
  'ARTLINE':            'artline.com.au',
  'MONAMI':             'monamiglobal.com',
  'DELI':               'deli.com',
  'IK':                 'ikofficepaper.com',
  'IK PAPER':           'ikofficepaper.com',
  'PAPERLINE':          'paperline.com',
  'DOUBLE A':           'doubleapaper.com',
  'DOUBLE-A':           'doubleapaper.com',
  'NAVIGATOR':          'navigatorpaper.com',
  'CAMLIN':             'camlin.com',
  'CELLO':              'cellostationery.com',

  // ── Writing instruments ────────────────────────────────────────────────────
  'PILOT':              'pilotpen.us',
  'PENTEL':             'pentel.com',
  'ZEBRA':              'zebrapen.com',
  'STABILO':            'stabilo.com',
  'FABER-CASTELL':      'faber-castell.com',
  'FABER CASTELL':      'faber-castell.com',
  'STAEDTLER':          'staedtler.com',
  'STAEDLER':           'staedtler.com',
  'UNI':                'uniball-na.com',
  'UNI-BALL':           'uniball-na.com',
  'UNIBALL':            'uniball-na.com',
  'MITSUBISHI':         'uniball-na.com',
  'BIC':                'bicworld.com',
  'PAPERMATE':          'papermate.com',
  'PAPER MATE':         'papermate.com',
  'SHARPIE':            'sharpie.com',
  'EXPO':               'expomarkers.com',
  'TOMBOW':             'tombowusa.com',
  'CARIOCA':            'carioca.com',
  'HELIX':              'helixoxford.com',
  'MAPED':              'maped.com',
  'KOKUYO':             'kokuyo.com',

  // ── Adhesives & tapes ──────────────────────────────────────────────────────
  'UHU':                'uhu.com',
  'PRITT':              'pritt.com',
  'TESA':               'tesa.com',
  'NITTO':              'nitto.com',
  'KORES':              'kores.com',
  'LOCTITE':            'loctite.com',

  // ── Filing & office organisation ───────────────────────────────────────────
  'FELLOWES':           'fellowes.com',
  'LEITZ':              'leitz.com',
  'BANTEX':             'bantex.com',
  'REXEL':              'rexeloffice.com',
  'DURABLE':            'durable.eu',
  'AVERY':              'avery.com',
  'AVERY DENNISON':     'averydennison.com',
  'ELBA':               'elba.com',
  'GBC':                'gbcconnect.com',
  'SWINGLINE':          'swingline.com',
  'BOSTITCH':           'bostitch.com',
  'ESSELTE':            'esselte.com',
  'KANGARO':            'kangaro.com',
  'RAPESCO':            'rapesco.com',
  'CARL':               'carl-products.com',
  'ACCO':               'accobrands.com',
  'PUKKA':              'pukkapad.com',
  'EXACOMPTA':          'exacompta.com',

  // ── Printers & imaging ────────────────────────────────────────────────────
  'CANON':              'canon.com.my',
  'HP':                 'hp.com',
  'EPSON':              'epson.com.my',
  'BROTHER':            'brother.com.my',
  'DYMO':               'dymo.com',
  'XEROX':              'xerox.com',
  'OKI':                'oki.com',
  'LEXMARK':            'lexmark.com',
  'RICOH':              'ricoh.com',
  'SHARP':              'sharp.net.my',
  'FUJIFILM':           'fujifilm.com',
  'RISO':               'riso.com',

  // ── Batteries & power ─────────────────────────────────────────────────────
  'ENERGIZER':          'energizer.com',
  'DURACELL':           'duracell.com',
  'PANASONIC':          'panasonic.net.my',
  'GP':                 'gpbatteries.com',
  'GOLD PEAK':          'gpbatteries.com',
  'MAXELL':             'maxell.com',
  'VARTA':              'varta-consumer.com',

  // ── Lighting ──────────────────────────────────────────────────────────────
  'OSRAM':              'osram.com',
  'PHILIPS':            'philips.com',
  'SIGNIFY':            'signify.com',

  // ── Office machines & tech ─────────────────────────────────────────────────
  'CASIO':              'casio.com',
  'CITIZEN':            'citizen.net',
  'SAMSUNG':            'samsung.com',
}

/** Returns the official domain for a brand, or null if not in the mapping. */
export function getBrandSite(brand: string | null | undefined): string | null {
  if (!brand?.trim()) return null
  return BRAND_OFFICIAL_SITES[brand.trim().toUpperCase()] ?? null
}
