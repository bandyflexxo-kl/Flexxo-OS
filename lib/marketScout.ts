/**
 * lib/marketScout.ts
 * Market Price Scout — searches Malaysian retail platforms for the cheapest
 * price of a product using Claude AI with the web_search tool.
 *
 * Sources searched (Malaysia only):
 *   Shopee    — official brand stores only (not random sellers)
 *   Lazada    — LazMall stores only
 *   Lotus's   — lotus.com.my
 *   Mr. DIY   — mrdiy.com
 *   Popular   — popular.com.my (stationery / office)
 *   AEON      — aeonshopping.com.my
 *   Watsons   — watsons.com.my (hygiene / care products)
 *   Amazon.my — amazon.com.my
 *
 * Uses ANTHROPIC_API_KEY (existing key, no extra subscription).
 */

import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoutSourceResult = {
  source:    string   // "Shopee", "Lazada", "Lotus's", etc.
  storeName: string   // e.g. "Faber-Castell Official Store"
  price:     number   // MYR
  unit:      string   // e.g. "per box", "per piece"
  url:       string
  inStock:   boolean
  isOfficial: boolean // true = official brand store / LazMall / verified
  notes:     string   // e.g. "10-pack RM5.90 = RM0.59/pc"
}

export type ScoutResult = {
  productName: string
  results:     ScoutSourceResult[]
  cheapest:    ScoutSourceResult | null
  notFound:    boolean
  error:       string | null
  searchedAt:  string
}

// ── Claude prompt ─────────────────────────────────────────────────────────────

function buildPrompt(productName: string): string {
  return `You are a procurement researcher for a Malaysian B2B office supply company.
Find the CHEAPEST price for this product in Malaysia: "${productName}"

Search these platforms IN ORDER (most reliable first):
1. Shopee Malaysia (shopee.com.my) — search for official brand stores only. Look for stores with "Official Store" badge. Skip random individual sellers.
2. Lazada Malaysia (lazada.com.my) — LazMall stores only (marked with orange LazMall badge). Skip non-LazMall sellers.
3. Lotus's Malaysia (lotus.com.my) — search their website directly
4. Mr. DIY Malaysia (mrdiy.com) — good for stationery, batteries, general supplies
5. Popular Bookstore Malaysia (popular.com.my) — for stationery and office supplies
6. AEON Malaysia (aeonshopping.com.my) — general merchandise
7. Watsons Malaysia (watsons.com.my) — hygiene and personal care
8. Amazon Malaysia (amazon.com.my) — if available

For each platform where you find the product, record:
- The store/platform name
- The seller/store name (e.g. "Faber-Castell Official Store")
- The price in MYR (if sold in packs, calculate per-unit price too)
- The product URL
- Whether it's in stock
- Whether it's an official brand store

Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "results": [
    {
      "source": "Shopee",
      "storeName": "Exact store name",
      "price": 5.90,
      "unit": "per box of 12",
      "url": "https://...",
      "inStock": true,
      "isOfficial": true,
      "notes": "Any useful detail like pack size, promo, etc."
    }
  ],
  "notFound": false
}

If the product is not found anywhere, return: {"results": [], "notFound": true}
Only include results from official/reliable stores. Maximum 2 results per platform (cheapest).
`
}

// ── Main scout function ───────────────────────────────────────────────────────

export async function scoutProduct(productName: string): Promise<ScoutResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      productName,
      results:    [],
      cheapest:   null,
      notFound:   false,
      error:      'ANTHROPIC_API_KEY not configured',
      searchedAt: new Date().toISOString(),
    }
  }

  const client = new Anthropic({ apiKey })

  try {
    // Use web_search tool — Claude will perform real web searches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.messages as any).create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2048,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
        },
      ],
      messages: [
        { role: 'user', content: buildPrompt(productName) },
      ],
    })

    // Extract the final text response from Claude (after tool use loop)
    let finalText = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of (response.content as any[])) {
      if (block.type === 'text') {
        finalText += block.text
      }
    }

    // Parse JSON from response (Claude returns raw JSON per our prompt)
    // Strip any accidental markdown fences
    const jsonStr = finalText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(jsonStr) as {
      results:  Partial<ScoutSourceResult>[]
      notFound: boolean
    }

    const results: ScoutSourceResult[] = (parsed.results ?? []).map(r => ({
      source:     String(r.source     ?? ''),
      storeName:  String(r.storeName  ?? ''),
      price:      Number(r.price      ?? 0),
      unit:       String(r.unit       ?? ''),
      url:        String(r.url        ?? ''),
      inStock:    Boolean(r.inStock   ?? true),
      isOfficial: Boolean(r.isOfficial ?? false),
      notes:      String(r.notes      ?? ''),
    })).filter(r => r.source && r.price > 0)

    // Sort by price ascending
    results.sort((a, b) => a.price - b.price)

    const cheapest = results.find(r => r.inStock) ?? results[0] ?? null

    return {
      productName,
      results,
      cheapest,
      notFound:   Boolean(parsed.notFound) || results.length === 0,
      error:      null,
      searchedAt: new Date().toISOString(),
    }
  } catch (err) {
    // If JSON parse fails, return raw error — don't crash the batch
    const msg = err instanceof Error ? err.message : String(err)
    return {
      productName,
      results:    [],
      cheapest:   null,
      notFound:   false,
      error:      msg,
      searchedAt: new Date().toISOString(),
    }
  }
}

/**
 * Scout multiple products.
 * Runs sequentially (not parallel) to avoid overwhelming the web search API.
 * Yields results one by one via an async generator for streaming progress.
 */
export async function* scoutProducts(
  productNames: string[],
): AsyncGenerator<ScoutResult> {
  for (const name of productNames) {
    yield await scoutProduct(name.trim())
  }
}

// ── Source metadata (for UI display) ─────────────────────────────────────────

export const SOURCE_META: Record<string, { color: string; badge: string }> = {
  'Shopee':   { color: 'orange', badge: 'Official Store' },
  'Lazada':   { color: 'purple', badge: 'LazMall' },
  "Lotus's":  { color: 'green',  badge: 'Verified' },
  'Mr. DIY':  { color: 'red',    badge: 'Retailer' },
  'Popular':  { color: 'blue',   badge: 'Retailer' },
  'AEON':     { color: 'teal',   badge: 'Retailer' },
  'Watsons':  { color: 'green',  badge: 'Retailer' },
  'Amazon.my':{ color: 'amber',  badge: 'Verified' },
}
