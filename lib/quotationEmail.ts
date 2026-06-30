import { sendGenericEmail } from '@/lib/email'

// PORTAL_URL is the publicly-accessible base URL used in emails sent to customers.
// It must be the public SHOP domain (shop.flexxo.com.my) — not NEXTAUTH_URL (the
// CMS/auth host). Override with PORTAL_URL only for local testing.
const PORTAL_URL = process.env.PORTAL_URL ?? 'https://shop.flexxo.com.my'

export async function sendQuotationEmail(params: {
  to:              string | string[]   // one or many recipients (company + contacts)
  contactName:     string | null
  salespersonName: string
  companyName:     string
  referenceNo:     string
  currency:        string
  totalAmount:     string
  expiresAt:       string | null
  quotationId:     string
}): Promise<void> {
  const {
    to, contactName, salespersonName, companyName,
    referenceNo, currency, totalAmount, expiresAt, quotationId,
  } = params

  const portalUrl  = `${PORTAL_URL}/shop/quotations/${quotationId}`
  const greeting   = contactName ? `Hi ${contactName},` : `Hi ${companyName},`
  const totalFmt   = `${currency} ${Number(totalAmount).toFixed(2)}`
  const expiryLine = expiresAt
    ? `This quotation is valid until ${new Date(expiresAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}.`
    : ''

  const subject = `Quotation ${referenceNo} from Flexxo — ${totalFmt}`

  const text = `${greeting}

Please find your quotation from Flexxo below.

Quotation Reference: ${referenceNo}
Total Amount:        ${totalFmt}
${expiryLine ? `\n${expiryLine}\n` : ''}
To view the full quotation and respond (accept or decline), please visit:
${portalUrl}

If you have any questions, please don't hesitate to contact us.

Best regards,
${salespersonName}
Flexxo (KL) Sdn Bhd`

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#1d4ed8;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Flexxo Office Supplies</h1>
  </div>
  <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">${greeting}</p>
    <p style="margin:0 0 16px">Please find your quotation details below.</p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
      <tr style="background:#f3f4f6">
        <td style="padding:12px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Reference</td>
        <td style="padding:12px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Total Amount</td>
        ${expiresAt ? '<td style="padding:12px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Valid Until</td>' : ''}
      </tr>
      <tr>
        <td style="padding:12px 16px;font-family:monospace;font-size:15px;font-weight:700;color:#1f2937">${referenceNo}</td>
        <td style="padding:12px 16px;font-size:18px;font-weight:700;color:#1d4ed8">${totalFmt}</td>
        ${expiresAt ? `<td style="padding:12px 16px;font-size:14px;color:#374151">${new Date(expiresAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}</td>` : ''}
      </tr>
    </table>

    <div style="text-align:center;margin:0 0 24px">
      <a href="${portalUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none">
        View &amp; Respond to Quotation →
      </a>
    </div>

    <p style="margin:0 0 8px;font-size:13px;color:#6b7280">
      Or copy this link: <a href="${portalUrl}" style="color:#1d4ed8">${portalUrl}</a>
    </p>

    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"/>
    <p style="margin:0;font-size:13px;color:#6b7280">
      Best regards,<br/>
      <strong style="color:#374151">${salespersonName}</strong><br/>
      Flexxo (KL) Sdn Bhd
    </p>
  </div>
</div>`

  await sendGenericEmail({ to, subject, text, html })
}
