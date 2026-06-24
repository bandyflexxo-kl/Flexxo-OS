import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return new Response('Unauthorized', { status: 401 })
  }

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:   { id, status: { not: 'cart' } },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
      company:   { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  })

  if (!quotation) return new Response('Not found', { status: 404 })

  const denied = assertPortalCompanyAccess(quotation.companyId, session)
  if (denied) return new Response('Forbidden', { status: 403 })

  const total      = quotation.totalAmount ? Number(quotation.totalAmount) : 0
  const currency   = quotation.currency
  const dateStr    = new Date(quotation.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })
  const expiryStr  = quotation.expiresAt
    ? new Date(quotation.expiresAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  const itemRows = quotation.items.map((item, i) => `
    <tr>
      <td style="color:#aaa;font-size:12px">${i + 1}</td>
      <td>
        <div style="font-weight:500">${esc(item.description)}</div>
        ${item.brand ? `<div style="font-size:11px;color:#888;margin-top:2px">${esc(item.brand)}</div>` : ''}
      </td>
      <td style="text-align:right">${Number(item.qty).toFixed(0)}${item.unit ? ` ${esc(item.unit)}` : ''}</td>
      <td style="text-align:right">${Number(item.unitPrice).toFixed(2)}</td>
      <td style="text-align:right;font-weight:600">${Number(item.lineTotal).toFixed(2)}</td>
    </tr>
  `).join('')

  const statusLabels: Record<string, string> = {
    pending_review: 'Pending Review',
    approved:       'Approved',
    sent:           'Sent',
    accepted:       'Accepted',
    declined:       'Declined',
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(quotation.referenceNo ?? 'Quotation')} — Flexxo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; background: white; }
    .toolbar { background: #f0fdf4; border-bottom: 1px solid #bbf7d0; padding: 12px 40px; display: flex; align-items: center; gap: 12px; }
    .btn-print { padding: 8px 20px; background: #16a34a; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-back { font-size: 13px; color: #555; text-decoration: none; }
    .hint { font-size: 11px; color: #888; margin-left: auto; }
    .page { max-width: 800px; margin: 0 auto; padding: 40px; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f5f5f5; padding: 10px 12px; text-align: left; font-size: 12px; color: #555; border-bottom: 2px solid #e0e0e0; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .tr { text-align: right; }
    .meta-box { background: #fafafa; border-radius: 8px; border: 1px solid #e5e5e5; padding: 20px; margin-bottom: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #f3e8ff; color: #7c3aed; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 11px; color: #aaa; text-align: center; }
    @media print {
      .toolbar { display: none !important; }
      .page { padding: 20px !important; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn-print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <a class="btn-back" href="/shop/quotations/${id}">← Back</a>
    <span class="hint">Tip: Set destination to "Save as PDF" in print dialog</span>
  </div>

  <div class="page">

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
      <div>
        <div style="font-size:26px;font-weight:800;color:#15803d;margin-bottom:4px">Flexxo (KL) Sdn Bhd</div>
        <div style="font-size:12px;color:#666;line-height:1.7">
          Lot 2772F, Jalan Industri 12, Kampung Baru Sungai Buloh<br>
          47000 Shah Alam, Selangor
        </div>
      </div>
      <div style="text-align:right">
        <div class="label">Quotation</div>
        <div style="font-size:20px;font-weight:700;font-family:monospace">${esc(quotation.referenceNo ?? 'QT')}</div>
        <div style="margin-top:6px"><span class="badge">${esc(statusLabels[quotation.status] ?? quotation.status)}</span></div>
      </div>
    </div>

    <!-- Meta -->
    <div class="meta-box">
      <div>
        <div class="label">Prepared for</div>
        <div style="font-weight:600;font-size:15px">${esc(quotation.company.name)}</div>
      </div>
      <div class="meta-grid">
        <div>
          <div class="label">Sales Rep</div>
          <div style="font-weight:600">${esc(quotation.createdBy.name)}</div>
        </div>
        <div>
          <div class="label">Date</div>
          <div style="font-weight:600">${esc(dateStr)}</div>
        </div>
        ${expiryStr ? `
        <div>
          <div class="label">Valid Until</div>
          <div style="font-weight:600;color:#b45309">${esc(expiryStr)}</div>
        </div>` : ''}
        ${quotation.poNumber ? `
        <div>
          <div class="label">PO Number</div>
          <div style="font-weight:600;font-family:monospace">${esc(quotation.poNumber)}</div>
        </div>` : ''}
      </div>
    </div>

    <!-- Items table -->
    <table>
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Description</th>
          <th class="tr" style="width:70px">Qty</th>
          <th class="tr" style="width:105px">Unit (${esc(currency)})</th>
          <th class="tr" style="width:105px">Total (${esc(currency)})</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" class="tr" style="font-weight:700;font-size:14px;border-top:2px solid #e0e0e0;border-bottom:none;background:#fafafa">
            Total (${esc(currency)})
          </td>
          <td class="tr" style="font-size:18px;font-weight:800;border-top:2px solid #e0e0e0;border-bottom:none;background:#fafafa">
            ${total.toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>

    ${quotation.costCentre ? `
    <div style="margin-top:20px;padding:12px;background:#fafafa;border:1px solid #e5e5e5;border-radius:6px">
      <div class="label">Remark</div>
      <div style="font-size:13px;margin-top:4px">${esc(quotation.costCentre)}</div>
    </div>` : ''}

    ${quotation.termsConditions ? `
    <div style="margin-top:20px;padding:12px;background:#fafafa;border:1px solid #e5e5e5;border-radius:6px">
      <div class="label" style="margin-bottom:6px">Terms &amp; Conditions</div>
      <div style="font-size:12px;color:#555;white-space:pre-wrap;line-height:1.6">${esc(quotation.termsConditions)}</div>
    </div>` : ''}

    <div class="footer">This quotation was generated by the Flexxo Sales OS</div>
  </div>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
