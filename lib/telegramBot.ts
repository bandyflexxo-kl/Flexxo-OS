/**
 * lib/telegramBot.ts
 * Thin wrapper around the Telegram Bot API.
 * Only used server-side (webhook handler).
 */

const apiBase = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
  return `https://api.telegram.org/bot${token}`
}

// ── Webhook verification ──────────────────────────────────────────────────────

/** Verify the X-Telegram-Bot-Api-Secret-Token header against TELEGRAM_WEBHOOK_SECRET. */
export function verifyTelegramWebhook(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return true  // skip verification if secret not configured (dev mode)
  const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  return header === secret
}

// ── Telegram Update types ─────────────────────────────────────────────────────

export type TelegramUser = {
  id:         number
  first_name: string
  username?:  string
}

export type TelegramPhotoSize = {
  file_id:        string
  file_unique_id: string
  width:          number
  height:         number
  file_size?:     number
}

export type TelegramMessage = {
  message_id: number
  from?:      TelegramUser
  chat:       { id: number; type: string }
  text?:      string
  photo?:     TelegramPhotoSize[]   // present when user sends a photo
  caption?:   string                 // text attached to a photo
  date:       number
}

export type TelegramInlineButton = {
  text:          string
  callback_data: string
}

export type TelegramCallbackQuery = {
  id:       string
  from:     TelegramUser
  message?: TelegramMessage & { message_id: number }
  data?:    string
}

export type TelegramUpdate = {
  update_id:       number
  message?:        TelegramMessage
  callback_query?: TelegramCallbackQuery
}

// ── Send helpers ──────────────────────────────────────────────────────────────

async function callApi(method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${apiBase()}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error(`[telegram] ${method} failed:`, err)
  }
}

/** Send a plain-text message. */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  await callApi('sendMessage', { chat_id: chatId, text })
}

/** Send an HTML-formatted message. Telegram HTML supports: <b>, <i>, <code>, <pre>, <a href>. */
export async function sendHtml(chatId: number, html: string): Promise<void> {
  // Telegram max message length is 4096 chars — split if needed
  const chunks = splitMessage(html, 4000)
  for (const chunk of chunks) {
    await callApi('sendMessage', {
      chat_id:    chatId,
      text:       chunk,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    })
  }
}

/**
 * Download a photo from Telegram by file_id.
 * Returns the raw buffer and inferred MIME type.
 */
export async function downloadPhoto(fileId: string): Promise<{ buffer: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set')

  // Step 1: resolve file_id → file_path
  const fileRes  = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`)
  const fileJson = await fileRes.json() as { ok: boolean; result: { file_path: string } }
  if (!fileJson.ok) throw new Error(`Telegram getFile failed for ${fileId}`)
  const filePath = fileJson.result.file_path

  // Step 2: download the actual bytes
  const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
  if (!imgRes.ok) throw new Error(`Telegram file download failed: ${imgRes.status}`)
  const buffer = Buffer.from(await imgRes.arrayBuffer())

  const ext      = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

  return { buffer, mimeType }
}

/** Send a "typing…" action so the user sees the bot is working. */
export async function sendTyping(chatId: number): Promise<void> {
  await callApi('sendChatAction', { chat_id: chatId, action: 'typing' })
}

// ── Text helpers ──────────────────────────────────────────────────────────────

/** Escape special HTML chars so user-provided text is safe in HTML messages. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Convert the agent's Markdown response to Telegram HTML.
 * Handles **bold**, `code`, bullet lists, and plain paragraphs.
 */
export function markdownToTelegramHtml(md: string): string {
  return md
    .split('\n')
    .map(line => {
      // Headings → bold
      if (line.startsWith('### ')) return `<b>${esc(line.slice(4))}</b>`
      if (line.startsWith('## '))  return `<b>${esc(line.slice(3))}</b>`
      // Bullet points
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return '• ' + inlineFormat(line.slice(2))
      }
      // Numbered list
      const numMatch = line.match(/^(\d+)\.\s(.+)/)
      if (numMatch) return `${numMatch[1]}. ${inlineFormat(numMatch[2])}`
      // Empty line
      if (line.trim() === '') return ''
      // Normal line
      return inlineFormat(line)
    })
    .join('\n')
}

function inlineFormat(text: string): string {
  return text
    // **bold**
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => `<b>${esc(t)}</b>`)
    // `code`
    .replace(/`([^`]+)`/g, (_, t) => `<code>${esc(t)}</code>`)
    // plain text (escape remaining)
    .replace(/(?<!<[^>]*)[&<>](?![^<]*>)/g, m => esc(m))
}

/** Split a long message into chunks at newline boundaries. */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > maxLen && current) {
      chunks.push(current)
      current = line
    } else {
      current = current ? current + '\n' + line : line
    }
  }
  if (current) chunks.push(current)
  return chunks
}

// ── Inline keyboard helpers ───────────────────────────────────────────────────

/**
 * Send an HTML message with an inline keyboard (button rows).
 * buttons: array of rows, each row is an array of {text, callback_data}.
 * callback_data max 64 bytes — keep keys short.
 */
export async function sendHtmlWithButtons(
  chatId:  number,
  html:    string,
  buttons: TelegramInlineButton[][],
): Promise<void> {
  const chunks = splitMessage(html, 4000)
  for (let i = 0; i < chunks.length; i++) {
    await callApi('sendMessage', {
      chat_id:      chatId,
      text:         chunks[i],
      parse_mode:   'HTML',
      link_preview_options: { is_disabled: true },
      // Only attach keyboard to the last chunk
      ...(i === chunks.length - 1 && { reply_markup: { inline_keyboard: buttons } }),
    })
  }
}

/** Acknowledge a button tap — removes the loading spinner on the button. */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text && { text, show_alert: false }),
  })
}

/** Edit the text of an existing message (used to update after button tap). */
export async function editMessageText(
  chatId:    number,
  messageId: number,
  html:      string,
): Promise<void> {
  await callApi('editMessageText', {
    chat_id:      chatId,
    message_id:   messageId,
    text:         html,
    parse_mode:   'HTML',
    link_preview_options: { is_disabled: true },
  })
}

/** Remove the inline keyboard from an existing message. */
export async function removeInlineKeyboard(
  chatId:    number,
  messageId: number,
): Promise<void> {
  await callApi('editMessageReplyMarkup', {
    chat_id:      chatId,
    message_id:   messageId,
    reply_markup: { inline_keyboard: [] },
  })
}
