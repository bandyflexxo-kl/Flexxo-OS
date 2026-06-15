import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { classify } from '../lib/productClassifier'

const tests = [
  ['CANON MF-621CN LASER 3 IN 1 COLOUR PRINTER',               'other'],
  ['MOUNTING BOARD 20" X 30" NO.25 LIGHT BROWN/ CHOCOLATE',    'other'],
  ['CUTLERY SET WITH BOX (3 IN 1)',                             'office-food-pantry'],
  ['FLEXKLEEN HAND WASH GREEN TEA 500ML',                       'office-food-pantry'],
  ['OUTDOOR CHAIR 2001 (ANTIRUST) COFFEE',                      'other'],
  ['SWEET AROMA DIFFUSER YOUNG LIVINGS',                        'office-food-pantry'],
  ['ELBA 400W 500ML JUICER',                                    'office-food-pantry'],
  ["JULIE'S OAT RICH TEA (210G)",                              'office-food-pantry'],
  ["JULIE'S COFFEE WAFFLES 100G",                              'office-food-pantry'],
  ['NESTUM 3IN1 CHOCOLATE (14SX28G)',                           'office-food-pantry'],
  ['DUTCH LADY CHOCOLATE UHT MILK 6X200ML',                    'office-food-pantry'],
  ["VICO 3 IN 1 ORINIGINAL CHOCOLATE 18'S",                    'office-food-pantry'],
  ['SWEETENED DAIRY CREAMER MILK 500G',                         'office-food-pantry'],
  ["JULIE'S LOVE LETTER CHOCOLATE 100GSM EXTRA 50%",           'office-food-pantry'],
  // Sanity check — these should stay correct
  ['NESCAFE COFFEE 3 IN ONE ORIGINAL',                          'office-food-pantry'],
  ['MILO 3 IN 1 ACTIV GO 14S X 33GM',                          'office-food-pantry'],
  ['INDOCAFE 3 IN 1 COFFEEMIX (20G X 100PKT)',                 'office-food-pantry'],
  ['BOSCH LASER PRINTER 300W',                                   'printer-consumables'],
  ['NESCAFE CLASSIC 100GM',                                      'office-food-pantry'],
]

for (const [name, hint] of tests) {
  const r = classify(name, hint)
  console.log(r.subSlug.padEnd(32), '|', name)
}
