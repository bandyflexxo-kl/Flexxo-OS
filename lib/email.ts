import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

export async function sendIntroEmail(params: {
  to: string
  contactName?: string
  salespersonName: string
}): Promise<void> {
  const { to, contactName, salespersonName } = params
  const greeting = contactName ? `Hi ${contactName},` : 'Hi there,'

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Flexxo Sales'}" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Thank you for connecting — Flexxo Office Supplies',
    text: `${greeting}

Thank you for connecting with us.

Flexxo is a one-stop office supply partner supporting companies across Malaysia with office stationery, pantry items, hygiene supplies, office equipment, furniture, printer consumables, and other daily workplace essentials.

We would love to understand your team's office supply needs. Please feel free to share your requirements and we will assist with pricing, availability, and delivery.

Looking forward to supporting your team.

Best regards,
${salespersonName}
Flexxo (KL) Sdn Bhd`,
    html: `<p>${greeting}</p>
<p>Thank you for connecting with us.</p>
<p>Flexxo is a one-stop office supply partner supporting companies across Malaysia with office stationery, pantry items, hygiene supplies, office equipment, furniture, printer consumables, and other daily workplace essentials.</p>
<p>We would love to understand your team's office supply needs. Please feel free to share your requirements and we will assist with pricing, availability, and delivery.</p>
<p>Looking forward to supporting your team.</p>
<p>Best regards,<br/>${salespersonName}<br/>Flexxo (KL) Sdn Bhd</p>`,
  })
}

export async function sendGenericEmail(params: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<void> {
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Flexxo Sales'}" <${process.env.GMAIL_USER}>`,
    ...params,
  })
}
