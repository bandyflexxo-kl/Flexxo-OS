import crypto from 'crypto'

const API_KEY    = process.env.LALAMOVE_API_KEY    ?? ''
const API_SECRET = process.env.LALAMOVE_API_SECRET ?? ''
const BASE_URL   = process.env.LALAMOVE_BASE_URL   ?? 'https://rest.lalamove.com'
const MARKET     = 'MY'

export type ServiceType = 'MOTORCYCLE' | 'MPV' | 'VAN'

export type LalamoveLocation = {
  lat:     string
  lng:     string
  address: string
}

export type LalamoveContact = {
  name:  string
  phone: string   // E.164, e.g. "+60123456789"
}

export type LalamoveQuotation = {
  quoteId:     string
  serviceType: ServiceType
  priceMyr:    number
  currency:    string
  expiresAt:   string
}

export type LalamoveOrderResult = {
  orderId:   string
  shareLink: string
}

export type LalamoveDriver = {
  driverName:  string
  driverPhone: string
  plateNumber: string
}

export type LalamoveOrderStatus = {
  status:  string
  driver?: LalamoveDriver
}

// ── HMAC-SHA256 auth header ───────────────────────────────────────────────────
function buildAuth(method: string, path: string, body = ''): string {
  const ts  = Date.now().toString()
  const raw = `${method}\n${ts}\n\n${path}\n${body}`
  const sig = crypto.createHmac('sha256', API_SECRET).update(raw).digest('hex')
  return `hmac ${API_KEY}:${ts}:${sig}`
}

function headers(method: string, path: string, body = ''): HeadersInit {
  return {
    'Authorization': buildAuth(method, path, body),
    'Content-Type':  'application/json',
    'Market':        MARKET,
    'Request-ID':    crypto.randomUUID(),
  }
}

// ── Check configuration ───────────────────────────────────────────────────────
export function isLalamoveConfigured(): boolean {
  return !!(API_KEY && API_SECRET)
}

// ── GET /v3/orders/:orderId ───────────────────────────────────────────────────
export async function getLalamoveOrderStatus(orderId: string): Promise<LalamoveOrderStatus> {
  const path = `/v3/orders/${orderId}`
  const res  = await fetch(`${BASE_URL}${path}`, { headers: headers('GET', path) })
  if (!res.ok) throw new Error(`Lalamove GET order failed: ${res.status}`)
  const data = await res.json() as {
    data?: { status?: string; driverInfo?: { name?: string; phone?: string; plateNumber?: string } }
  }
  const d = data.data
  return {
    status: d?.status ?? 'UNKNOWN',
    driver: d?.driverInfo?.name ? {
      driverName:  d.driverInfo.name  ?? '',
      driverPhone: d.driverInfo.phone ?? '',
      plateNumber: d.driverInfo.plateNumber ?? '',
    } : undefined,
  }
}

// ── POST /v3/quotations ───────────────────────────────────────────────────────
export async function getLalamoveQuotation(params: {
  serviceType: ServiceType
  pickup:      LalamoveLocation
  dropoff:     LalamoveLocation
  sender:      LalamoveContact
  recipient:   LalamoveContact
  scheduleAt?: string   // ISO 8601 UTC — omit for immediate pickup
}): Promise<LalamoveQuotation> {
  const path = '/v3/quotations'
  const payload: Record<string, unknown> = {
    serviceType: params.serviceType,
    language:    'en_MY',
    stops: [
      {
        coordinates: { lat: params.pickup.lat, lng: params.pickup.lng },
        address:     params.pickup.address,
      },
      {
        coordinates: { lat: params.dropoff.lat, lng: params.dropoff.lng },
        address:     params.dropoff.address,
      },
    ],
    requesterContact: { name: params.sender.name, phoneNumber: params.sender.phone },
    deliveries: [{
      toContact: { name: params.recipient.name, phoneNumber: params.recipient.phone },
      toStop:    1,
    }],
  }
  if (params.scheduleAt) payload.scheduleAt = params.scheduleAt
  const body = JSON.stringify(payload)

  const res  = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: headers('POST', path, body), body })
  if (!res.ok) throw new Error(`Lalamove quotation failed (${params.serviceType}): ${res.status}`)
  const data = await res.json() as { data?: { quotationId?: string; priceBreakdown?: { total?: string; currency?: string }; expiresAt?: string } }
  const d    = data.data
  if (!d?.quotationId) throw new Error(`No quotationId in Lalamove response`)
  return {
    quoteId:     d.quotationId,
    serviceType: params.serviceType,
    priceMyr:    parseFloat(d.priceBreakdown?.total ?? '0'),
    currency:    d.priceBreakdown?.currency ?? 'MYR',
    expiresAt:   d.expiresAt ?? '',
  }
}

// ── Try all service types and return cheapest ─────────────────────────────────
export async function getCheapestLalamoveQuote(params: {
  pickup:     LalamoveLocation
  dropoff:    LalamoveLocation
  sender:     LalamoveContact
  recipient:  LalamoveContact
  scheduleAt?: string
}): Promise<LalamoveQuotation | null> {
  const serviceTypes: ServiceType[] = ['MOTORCYCLE', 'MPV', 'VAN']
  const results = await Promise.allSettled(
    serviceTypes.map(serviceType => getLalamoveQuotation({ ...params, serviceType }))
  )
  const quotes = results
    .filter((r): r is PromiseFulfilledResult<LalamoveQuotation> => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => a.priceMyr - b.priceMyr)

  return quotes[0] ?? null
}

// ── POST /v3/orders ───────────────────────────────────────────────────────────
export async function placeLalamoveOrder(params: {
  quoteId:   string
  sender:    LalamoveContact
  recipient: LalamoveContact
  remarks?:  string
}): Promise<LalamoveOrderResult> {
  const path = '/v3/orders'
  const body = JSON.stringify({
    quotationId:      params.quoteId,
    sender:           { stopIndex: 0, name: params.sender.name, phone: params.sender.phone },
    recipients: [{
      stopIndex: 1,
      name:      params.recipient.name,
      phone:     params.recipient.phone,
      remarks:   params.remarks ?? '',
    }],
    isPODEnabled: false,
    isRecipientSMSEnabled: true,
  })

  const res  = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: headers('POST', path, body), body })
  if (!res.ok) throw new Error(`Lalamove place order failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data?: { orderId?: string; shareLink?: string } }
  const d    = data.data
  if (!d?.orderId) throw new Error('No orderId in Lalamove place order response')
  return { orderId: d.orderId, shareLink: d.shareLink ?? '' }
}

// ── DELETE /v3/orders/:orderId ────────────────────────────────────────────────
export async function cancelLalamoveOrder(orderId: string): Promise<void> {
  const path = `/v3/orders/${orderId}`
  await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: headers('DELETE', path) })
}
