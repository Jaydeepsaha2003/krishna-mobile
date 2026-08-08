/**
 * Builds a standalone HTML invoice for printing / PDF export.
 * The string is loaded into a hidden BrowserWindow in the main process, so it
 * must be fully self-contained — no external CSS, fonts or images.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inr(value: unknown): string {
  const n = Number(value ?? 0)
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function d(value?: string | null): string {
  if (!value) return '—'
  const dt = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(dt.getTime())
    ? String(value)
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

/** Indian numbering: crore / lakh / thousand. */
export function amountInWords(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'Zero Rupees Only'
  const parts: string[] = []
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const hundred = Math.floor((n % 1000) / 100)
  const rest = n % 100

  if (crore) parts.push(`${twoDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (rest) parts.push(twoDigits(rest))

  const paise = Math.round((Math.abs(value) - n) * 100)
  const rupees = `${parts.join(' ')} Rupees`
  return paise > 0 ? `${rupees} and ${twoDigits(paise)} Paise Only` : `${rupees} Only`
}

export interface InvoicePayload {
  sale: any
  raw: any
  items: any[]
  payments: any[]
}

export function buildInvoiceHtml({ sale, raw, items, payments }: InvoicePayload): string {
  const shopAddress = [raw.shop_address, raw.shop_city, raw.shop_state].filter(Boolean).join(', ')
  const custAddress = [raw.address_line1, raw.city, raw.state, raw.pincode].filter(Boolean).join(', ')

  const rows = items
    .map(
      (it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>
          <div class="b">${esc(it.description ?? `${it.brand_name} ${it.model_name}`)}</div>
          ${it.imei1 ? `<div class="s mono">IMEI: ${esc(it.imei1)}</div>` : ''}
          ${it.hsn ? `<div class="s">HSN: ${esc(it.hsn)}</div>` : ''}
        </td>
        <td class="c">${it.qty}</td>
        <td class="r">${inr(it.unit_price)}</td>
        <td class="r">${it.discount > 0 ? `- ${inr(it.discount)}` : '—'}</td>
        <td class="c">${Number(it.gst_rate ?? 0)}%</td>
        <td class="r b">${inr(it.line_total)}</td>
      </tr>`
    )
    .join('')

  const gstGroups = new Map<number, { taxable: number; tax: number }>()
  for (const it of items) {
    const rate = Number(it.gst_rate ?? 0)
    const taxable = Number(it.line_total ?? 0) - Number(it.tax_amount ?? 0)
    const g = gstGroups.get(rate) ?? { taxable: 0, tax: 0 }
    g.taxable += taxable
    g.tax += Number(it.tax_amount ?? 0)
    gstGroups.set(rate, g)
  }

  const gstRows = [...gstGroups.entries()]
    .map(
      ([rate, g]) => `
      <tr>
        <td class="c">${rate}%</td>
        <td class="r">${inr(g.taxable)}</td>
        <td class="r">${inr(g.tax / 2)}</td>
        <td class="r">${inr(g.tax / 2)}</td>
        <td class="r b">${inr(g.tax)}</td>
      </tr>`
    )
    .join('')

  const paymentRows = payments
    .map(
      (p) => `
      <tr>
        <td>${d(p.payment_date)}</td>
        <td>${esc(p.mode ?? '—')}</td>
        <td>${esc(p.reference ?? '')}</td>
        <td class="r">${inr(p.amount)}</td>
      </tr>`
    )
    .join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(sale.invoiceNo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #101828; margin: 0; padding: 24px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #101828; padding-bottom: 14px; }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
  .muted { color: #667085; }
  .s { font-size: 10.5px; color: #667085; }
  .b { font-weight: 600; }
  .mono { font-family: Consolas, monospace; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; }
  .grid { display: flex; gap: 24px; margin: 18px 0 14px; }
  .grid > div { flex: 1; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #667085; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f2f4f7; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
       color: #475467; padding: 7px 8px; border-bottom: 1px solid #d0d5dd; }
  td { padding: 7px 8px; border-bottom: 1px solid #eaecf0; vertical-align: top; }
  .r { text-align: right; }
  .c { text-align: center; }
  .totals { margin-left: auto; width: 300px; margin-top: 12px; }
  .totals td { border: 0; padding: 4px 8px; }
  .totals .grand td { border-top: 2px solid #101828; font-size: 15px; font-weight: 700; padding-top: 8px; }
  .box { border: 1px solid #eaecf0; border-radius: 8px; padding: 10px 12px; margin-top: 14px; }
  .credit { border-color: #f79009; background: #fffaeb; }
  .words { margin-top: 10px; font-size: 11px; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
  .sign { text-align: center; width: 200px; border-top: 1px solid #98a2b3; padding-top: 6px; font-size: 11px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #475467; margin: 0 0 6px; }
  @page { size: A4; margin: 12mm; }
</style></head>
<body>
  <div class="head">
    <div>
      <div class="brand">${esc(raw.company_name)}</div>
      <div class="s">${esc(raw.shop_name)}${shopAddress ? ` · ${esc(shopAddress)}` : ''}</div>
      ${raw.shop_phone ? `<div class="s">Phone: ${esc(raw.shop_phone)}</div>` : ''}
      ${raw.shop_gstin || raw.company_gstin ? `<div class="s">GSTIN: ${esc(raw.shop_gstin || raw.company_gstin)}</div>` : ''}
    </div>
    <div class="title">
      <h1>Tax Invoice</h1>
      <div class="b mono">${esc(sale.invoiceNo)}</div>
      <div class="s">Date: ${d(sale.saleDate)}</div>
    </div>
  </div>

  <div class="grid">
    <div>
      <div class="label">Billed to</div>
      <div class="b">${esc(sale.customerName)}</div>
      ${sale.customerPhone ? `<div class="s">${esc(sale.customerPhone)}</div>` : ''}
      ${custAddress ? `<div class="s">${esc(custAddress)}</div>` : ''}
      ${raw.customer_gstin ? `<div class="s">GSTIN: ${esc(raw.customer_gstin)}</div>` : ''}
    </div>
    <div>
      <div class="label">Payment</div>
      <div>${esc(sale.paymentMode ?? '—')}</div>
      <div class="s">Billed by ${esc(sale.createdByName ?? '—')}</div>
    </div>
  </div>

  ${
    sale.saleType && sale.saleType !== 'product'
      ? `<div class="box"><h3>${sale.saleType === 'repair' ? 'Repair details' : 'Recharge'}</h3>
         ${sale.serviceTitle ? `<div class="b">${esc(sale.serviceTitle)}</div>` : ''}
         ${sale.serviceDetails ? `<div class="s">${esc(sale.serviceDetails)}</div>` : ''}</div>`
      : ''
  }

  <table>
    <thead>
      <tr>
        <th style="width:32px" class="c">#</th>
        <th>Description</th>
        <th style="width:44px" class="c">Qty</th>
        <th style="width:90px" class="r">Rate</th>
        <th style="width:80px" class="r">Discount</th>
        <th style="width:52px" class="c">GST</th>
        <th style="width:100px" class="r">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td class="muted">Sub total</td><td class="r">${inr(sale.subtotal)}</td></tr>
    <tr><td class="muted">GST</td><td class="r">${inr(sale.taxAmount)}</td></tr>
    ${Number(sale.discount) > 0 ? `<tr><td class="muted">Bill discount</td><td class="r">- ${inr(sale.discount)}</td></tr>` : ''}
    ${Number(sale.otherCharges) > 0 ? `<tr><td class="muted">Other charges</td><td class="r">${inr(sale.otherCharges)}</td></tr>` : ''}
    <tr class="grand"><td>Grand total</td><td class="r">${inr(sale.total)}</td></tr>
    <tr><td class="muted">Paid</td><td class="r">${inr(sale.paidAmount)}</td></tr>
    ${Number(sale.dueAmount) > 0 ? `<tr><td class="b" style="color:#b54708">Balance due</td><td class="r b" style="color:#b54708">${inr(sale.dueAmount)}</td></tr>` : ''}
  </table>

  <div class="words"><span class="muted">Amount in words:</span> <span class="b">${esc(amountInWords(Number(sale.total)))}</span></div>

  ${
    gstRows
      ? `<div class="box"><h3>GST summary</h3>
    <table><thead><tr><th class="c">Rate</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">Total tax</th></tr></thead>
    <tbody>${gstRows}</tbody></table></div>`
      : ''
  }

  ${
    Number(sale.dueAmount) > 0
      ? `<div class="box credit"><h3>Credit terms</h3>
         <div><span class="b">${inr(sale.dueAmount)}</span> to be paid by <span class="b">${d(sale.dueDate)}</span>.</div>
         ${sale.promisedNote ? `<div class="s">${esc(sale.promisedNote)}</div>` : ''}</div>`
      : ''
  }

  ${
    paymentRows
      ? `<div class="box"><h3>Payments received</h3>
         <table><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th class="r">Amount</th></tr></thead>
         <tbody>${paymentRows}</tbody></table></div>`
      : ''
  }

  ${raw.terms ? `<div class="box"><h3>Terms</h3><div class="s">${esc(raw.terms)}</div></div>` : ''}

  <div class="foot">
    <div class="s" style="max-width:340px">
      Goods once sold are covered by the manufacturer's warranty only. Please keep this invoice safe —
      it is required for any warranty or service claim.
    </div>
    <div class="sign">For ${esc(raw.company_name)}</div>
  </div>
</body></html>`
}
