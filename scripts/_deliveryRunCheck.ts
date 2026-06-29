/** Sanity-check the delivery-run pricing + message + zone mapping. npx tsx scripts/_deliveryRunCheck.ts */
import { priceRun, buildPartnerMessage, runCode } from '../lib/deliveryRun'
import { zoneForPostcode } from '../lib/deliveryZones'

// Zone mapping spot-checks (postcode → suggested zone + km)
for (const pc of ['47000', '47100', '40150', '46050', '50450', '43500', '64000', '99999']) {
  const z = zoneForPostcode(pc)
  console.log(`  ${pc} → ${z ? `${z.label} (${z.km} km)` : 'no zone (admin enters km)'}`)
}

console.log('\n-- parcel: 3 stops, boxes 2+3+4=9, farthest 28 km (near) --')
console.log(priceRun('parcel', [{ km: 10, qty: 2 }, { km: 18, qty: 3 }, { km: 28, qty: 4 }]))

console.log('\n-- parcel: same boxes but farthest 40 km (far tier) --')
console.log(priceRun('parcel', [{ km: 10, qty: 2 }, { km: 40, qty: 7 }]))

console.log('\n-- pallet: 2 pallets, farthest 60 km (band 2 → base 160) --')
console.log(priceRun('pallet', [{ km: 40, qty: 1 }, { km: 60, qty: 1 }]))

const r = priceRun('parcel', [{ km: 10, qty: 2 }, { km: 28, qty: 4 }])
console.log('\n-- sample WhatsApp message --')
console.log(buildPartnerMessage({
  runCode: runCode('4f2a9c00-0000-0000-0000-000000000000'),
  mode: 'parcel', maxKm: r.maxKm, totalQty: r.totalQty, price: r.price,
  pickup: 'Flexxo Warehouse, Lot 2772F, Sungai Buloh',
  stops: [
    { company: 'Tropicana Corp', doRef: 'DO KL2606-0042', address: '12 Jalan PJU, 47100 Puchong',
      contactName: 'Mr Lee', contactPhone: '012-3456789', qty: 2,
      items: [{ name: 'A4 Paper 80gsm', qty: 5 }, { name: 'HP 85A Toner', qty: 3 }] },
    { company: 'Sunway Bhd', doRef: 'DO KL2606-0043', address: '8 Jalan Sunway, 47500 Subang',
      contactName: 'Ms Tan', contactPhone: '019-8765432', qty: 4,
      items: [{ name: 'Stapler HD-10', qty: 10 }] },
  ],
}))
