/**
 * lib/agents/salesAgentCore.ts
 * Shared agentic loop for the Sales AI Agent.
 * Used by both the web chat API (SSE) and the Telegram webhook.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  searchProducts,
  getProductsByCategory,
  getTopSellingProducts,
  getCustomerHistory,
  getIndustryBuyingPatterns,
  listMyCompanies,
  listCategories,
  getClientPurchaseHistory,
  suggestReorderItems,
  getInactiveClients,
  getTopProductsByRevenue,
  getClientFinancials,
  type ToolResult,
} from './salesAgentTools'

// ── System prompt ─────────────────────────────────────────────────────────────

export const SALES_SYSTEM_PROMPT = `You are the Flexxo Sales AI Agent — the most knowledgeable sales advisor at Flexxo (KL) Sdn Bhd, a B2B office supply company based in Kuala Lumpur, Malaysia serving corporate clients.

## Your role
Help Flexxo salespeople:
1. List companies assigned to the salesperson — use list_my_companies when asked "my companies", "my clients", "my accounts", "assigned to me"
2. Recommend the right products for specific types of clients
3. Understand what clients in a given industry typically buy
4. Look up specific products by name, brand, or item code
5. Research a client's real purchase history from QNE invoices before a sales visit
6. Identify which clients haven't ordered recently and need follow-up
7. Check client financials (outstanding balance, credit limit, overdue) before quoting large orders
8. Find what's actually generating the most revenue across all clients
9. Suggest reorder items for a client based on their buying patterns

## IMPORTANT: Tool usage rules
- When asked about "my companies", "my clients", "my accounts" → call list_my_companies
- When asked about a client's purchase history, what they buy, what to recommend → call get_client_purchase_history (uses real QNE invoices) FIRST, then get_customer_history as supplement
- When asked who hasn't ordered recently, inactive clients, who to call → call get_inactive_clients
- When asked about revenue, best sellers by revenue, what's making money → call get_top_products_by_revenue
- When asked about client financials, whether safe to quote, outstanding balance → call get_client_financials
- When asked what to suggest for a client visit, reorder suggestions → call suggest_reorder_items
- ALWAYS use tools for real data. Never guess prices, history, or financials.

## What Flexxo sells
Office Stationery · Office Furniture · Printer Supplies · Computer Hardware & Software · Office Security · Office Machines · Office Equipment · Breakroom (pantry) · Janitorial (hygiene/cleaning) · Safety Kits

## How to answer
- ALWAYS use your tools to look up real data before making recommendations — never guess prices or stock
- Give specific product names, item codes, and prices (MYR) when available
- When recommending for a new client, ask their industry if not provided — it helps pattern-match to similar clients
- Suggest bundles where sensible (paper + toner + folders for law firms, etc.)
- Note when a product is out of stock (stockQty = 0) so the salesperson can manage expectations
- Products with null stockQty have never been synced — treat as available
- Prices shown are MYR, calculated as QNE last-sale-price × 1.35

## Malaysian B2B context
- Common brands: Faber-Castell, Artline, Kokuyo, Deli, APLUS, HP, Canon, Epson, Pilot, Stabilo, 3M
- A4 paper 80gsm is a commodity — every office needs it; ask about volume
- Thermal rolls (80×58mm or 80×80mm) are common for POS / kitchen printers
- Corporate gifts spike around Hari Raya, CNY, and year-end (Dec)
- KL clients are often professional services (law, accounting, finance), hotels, F&B, manufacturing
- Pantry items (coffee, milo, sugar, creamer) are strong recurring revenue — suggest monthly standing orders

## Response style
- Concise and specific — bullet lists for products, lead with name + code + price
- Proactively suggest upsell / related categories when it fits
- If a client has existing history, compare recommendations to what they already buy`

// ── Tool definitions ──────────────────────────────────────────────────────────

export const SALES_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name:        'search_products',
    description: 'Search the Flexxo product catalogue by name, brand, or QNE item code.',
    input_schema: {
      type:       'object',
      properties: {
        query: { type: 'string', description: 'Product name, brand, or keyword' },
        limit: { type: 'number', description: 'Max results, default 10' },
      },
      required: ['query'],
    },
  },
  {
    name:        'get_products_by_category',
    description: 'List products within a specific sub-category slug from list_categories.',
    input_schema: {
      type:       'object',
      properties: {
        category_slug: { type: 'string', description: 'Category slug (e.g. "br--coffee-tea")' },
        limit:         { type: 'number', description: 'Max results, default 15' },
      },
      required: ['category_slug'],
    },
  },
  {
    name:        'get_top_selling_products',
    description: 'Get most frequently ordered products, optionally filtered to a category.',
    input_schema: {
      type:       'object',
      properties: {
        category_slug: { type: 'string', description: 'Optional category slug filter' },
        limit:         { type: 'number', description: 'Max results, default 10' },
      },
    },
  },
  {
    name:        'get_customer_history',
    description: "Look up a specific client's past purchase history by company name.",
    input_schema: {
      type:       'object',
      properties: {
        company_name: { type: 'string', description: 'Company name or partial name' },
      },
      required: ['company_name'],
    },
  },
  {
    name:        'get_industry_buying_patterns',
    description: 'Analyse what companies in a given industry typically buy from Flexxo.',
    input_schema: {
      type:       'object',
      properties: {
        industry: { type: 'string', description: 'Industry (e.g. "law firm", "hotel", "F&B")' },
        limit:    { type: 'number', description: 'Top N products, default 10' },
      },
      required: ['industry'],
    },
  },
  {
    name:        'list_my_companies',
    description: 'List all companies currently assigned to the logged-in salesperson.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'list_categories',
    description: 'List all product categories and sub-categories with slugs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name:        'get_client_purchase_history',
    description: 'Get real QNE invoice history for a specific client — what they actually bought, how much spent, last order date. Uses synced QNE invoice data.',
    input_schema: {
      type:       'object',
      properties: {
        company_name: { type: 'string', description: 'Company name or partial name' },
        months:       { type: 'number', description: 'How many months to look back, default 12' },
      },
      required: ['company_name'],
    },
  },
  {
    name:        'suggest_reorder_items',
    description: 'Suggest items a client should reorder based on their past buying patterns — highlights items ordered multiple times but not recently.',
    input_schema: {
      type:       'object',
      properties: {
        company_name: { type: 'string', description: 'Company name or partial name' },
      },
      required: ['company_name'],
    },
  },
  {
    name:        'get_inactive_clients',
    description: 'Find clients who have not placed an order in the last N days. Useful for identifying who needs a follow-up call.',
    input_schema: {
      type:       'object',
      properties: {
        days_since_last_order: { type: 'number', description: 'Threshold in days, default 90' },
        salesperson_name:      { type: 'string', description: 'Filter by salesperson name (optional)' },
      },
    },
  },
  {
    name:        'get_top_products_by_revenue',
    description: 'Rank products by actual invoiced revenue from QNE — shows what is truly generating the most money, not just quote counts.',
    input_schema: {
      type:       'object',
      properties: {
        months:        { type: 'number', description: 'Look-back period in months, default 6' },
        category_name: { type: 'string', description: 'Optional category filter (e.g. "Printer Supplies")' },
      },
    },
  },
  {
    name:        'get_client_financials',
    description: 'Check a client\'s outstanding balance, credit limit, and overdue amount from QNE aging data. Use before quoting large orders.',
    input_schema: {
      type:       'object',
      properties: {
        company_name: { type: 'string', description: 'Company name or partial name' },
      },
      required: ['company_name'],
    },
  },
]

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  search_products:              'Searching catalogue',
  get_products_by_category:     'Browsing category',
  get_top_selling_products:     'Checking top sellers',
  get_customer_history:         'Looking up client history',
  get_industry_buying_patterns: 'Analysing industry patterns',
  list_my_companies:            'Loading your accounts',
  list_categories:              'Loading categories',
  get_client_purchase_history:  'Reading invoice history',
  suggest_reorder_items:        'Finding reorder suggestions',
  get_inactive_clients:         'Checking inactive accounts',
  get_top_products_by_revenue:  'Ranking by revenue',
  get_client_financials:        'Checking client financials',
}

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeSalesTool(name: string, input: Record<string, unknown>, userId?: string): Promise<ToolResult> {
  switch (name) {
    case 'search_products':
      return searchProducts(
        String(input.query ?? ''),
        typeof input.limit === 'number' ? input.limit : 10,
      )
    case 'get_products_by_category':
      return getProductsByCategory(
        String(input.category_slug ?? ''),
        typeof input.limit === 'number' ? input.limit : 15,
      )
    case 'get_top_selling_products':
      return getTopSellingProducts(
        typeof input.category_slug === 'string' ? input.category_slug : undefined,
        typeof input.limit === 'number' ? input.limit : 10,
      )
    case 'get_customer_history':
      return getCustomerHistory(String(input.company_name ?? ''))
    case 'get_industry_buying_patterns':
      return getIndustryBuyingPatterns(
        String(input.industry ?? ''),
        typeof input.limit === 'number' ? input.limit : 10,
      )
    case 'list_my_companies':
      return userId
        ? listMyCompanies(userId)
        : { error: 'User identity not available — please use the web chat instead.' }
    case 'list_categories':
      return listCategories()
    case 'get_client_purchase_history':
      return getClientPurchaseHistory(
        String(input.company_name ?? ''),
        typeof input.months === 'number' ? input.months : 12,
      )
    case 'suggest_reorder_items':
      return suggestReorderItems(String(input.company_name ?? ''))
    case 'get_inactive_clients':
      return getInactiveClients(
        typeof input.days_since_last_order === 'number' ? input.days_since_last_order : 90,
        typeof input.salesperson_name === 'string' ? input.salesperson_name : undefined,
      )
    case 'get_top_products_by_revenue':
      return getTopProductsByRevenue(
        typeof input.months === 'number' ? input.months : 6,
        typeof input.category_name === 'string' ? input.category_name : undefined,
      )
    case 'get_client_financials':
      return getClientFinancials(String(input.company_name ?? ''))
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Agentic loop ─────────────────────────────────────────────────────────────

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Run the Sales Agent agentic loop and return the final text response.
 * onToolCall is called each time Claude invokes a tool (useful for UI feedback).
 */
export async function runSalesAgent(
  history:      ChatMessage[],
  newMessage:   string,
  onToolCall?:  (name: string, description: string) => void,
  userId?:      string,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: newMessage },
  ]

  let continueLoop = true
  let finalText    = ''

  while (continueLoop) {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     SALES_SYSTEM_PROMPT,
      tools:      SALES_TOOL_DEFS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        onToolCall?.(block.name, TOOL_DESCRIPTIONS[block.name] ?? block.name)
        const result = await executeSalesTool(block.name, block.input as Record<string, unknown>, userId)
        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     JSON.stringify(result),
        })
      }

      messages.push({ role: 'user', content: toolResults })
    } else {
      const textBlock = response.content.find(b => b.type === 'text')
      finalText    = textBlock?.type === 'text' ? textBlock.text : ''
      continueLoop = false
    }
  }

  return finalText
}
