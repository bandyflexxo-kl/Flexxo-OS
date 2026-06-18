/**
 * lib/telegramNotify.ts
 * Proactive Telegram notifications — sends messages to staff by role.
 * Separated from telegramBot.ts to keep that file DB-free.
 */
import { prisma }                            from '@/lib/prisma'
import { sendHtml, sendHtmlWithButtons }     from '@/lib/telegramBot'
import type { TelegramInlineButton }         from '@/lib/telegramBot'

/**
 * Send a message to all active CRM users whose role matches any in `roles`
 * and who have a Telegram chat ID set.
 * Fire-and-forget — never throws.
 */
export async function notifyByRole(
  roles:    string[],
  html:     string,
  buttons?: TelegramInlineButton[][],
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive:       true,
        telegramChatId: { not: null },
        userRoles: {
          some: {
            revokedAt: null,
            role: { name: { in: roles } },
          },
        },
      },
      select: { telegramChatId: true },
    })

    for (const u of users) {
      if (!u.telegramChatId) continue
      const chatId = Number(u.telegramChatId)
      if (buttons && buttons.length > 0) {
        await sendHtmlWithButtons(chatId, html, buttons).catch(() => undefined)
      } else {
        await sendHtml(chatId, html).catch(() => undefined)
      }
    }
  } catch {
    // Never block the caller
  }
}

/**
 * Send a message to a specific user by their CRM user ID.
 * Fire-and-forget — never throws.
 */
export async function notifyUser(
  userId:   string,
  html:     string,
  buttons?: TelegramInlineButton[][],
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { telegramChatId: true },
    })
    if (!user?.telegramChatId) return
    const chatId = Number(user.telegramChatId)
    if (buttons && buttons.length > 0) {
      await sendHtmlWithButtons(chatId, html, buttons).catch(() => undefined)
    } else {
      await sendHtml(chatId, html).catch(() => undefined)
    }
  } catch {
    // Never block the caller
  }
}
