import { sendGenericEmail } from '@/lib/email'

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://flexxo-os.vercel.app'
// Email images must be a publicly-reachable URL — never localhost.
const LOGO_URL = `${APP_URL.includes('localhost') ? 'https://flexxo-os.vercel.app' : APP_URL}/flexxo-logo.png`

export async function sendPortalWelcomeEmail(params: {
  to:          string
  name:        string
  companyName: string
  password:    string   // temporary plain-text password
}): Promise<void> {
  const { to, name, companyName, password } = params
  const loginUrl = `${APP_URL}/shop/login`

  const subject = `Welcome to Flexxo Shop — Your account is ready`

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">

  <!-- Header -->
  <div style="background:#1f9d55;padding:26px 32px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="display:inline-block;background:#ffffff;padding:10px 22px;border-radius:10px;">
      <img src="${LOGO_URL}" alt="Flexxo" width="150" style="height:auto;display:block;border:0;" />
    </div>
    <p style="color:#d1fae5;margin:14px 0 0;font-size:14px;">Your exclusive B2B ordering portal</p>
  </div>

  <!-- Body -->
  <div style="background:#f9fafb;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">

    <p style="margin:0 0 16px;font-size:16px;color:#111827;">
      Hi <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
      Your Flexxo Shop account has been set up for <strong>${companyName}</strong>.
      You now have access to our exclusive B2B portal with business pricing.
    </p>

    <!-- Credentials box -->
    <div style="background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">
        Your Login Details
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;width:90px;">Email</td>
          <td style="padding:6px 0;font-size:14px;font-weight:600;color:#111827;font-family:monospace;">${to}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Password</td>
          <td style="padding:6px 0;font-size:14px;font-weight:600;color:#111827;font-family:monospace;">${password}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#f59e0b;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;">
        ⚠️ You'll be asked to set a new password on your first login.
      </p>
    </div>

    <!-- What you can do -->
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#374151;">What you can do:</p>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;line-height:2;">
        <li>Browse our full product catalogue with your business pricing</li>
        <li>Submit quote requests instantly — no WhatsApp needed</li>
        <li>View and respond to quotations your sales rep sends you</li>
        <li>Track your order status from confirmed to delivered</li>
      </ul>
    </div>

    <!-- CTA button -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${loginUrl}"
         style="display:inline-block;background:#1f9d55;color:#fff;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.01em;">
        Log In to Flexxo Shop →
      </a>
    </div>

    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">
      This is an exclusive portal for authorised Flexxo business clients.<br>
      Questions? Contact your Flexxo sales representative.
    </p>

  </div>
</div>`

  const text = `
Hi ${name},

Your Flexxo Shop account is ready for ${companyName}.

Login: ${loginUrl}
Email: ${to}
Password: ${password}

You will be asked to change your password on first login.

What you can do:
- Browse products at business pricing
- Submit quote requests
- View and accept quotations
- Track orders

Questions? Contact your Flexxo sales representative.
`.trim()

  await sendGenericEmail({ to, subject, text, html })
}
