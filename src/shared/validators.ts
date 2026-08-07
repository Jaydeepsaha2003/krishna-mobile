/**
 * Field validators for Indian identity / contact data.
 * Pure functions — usable from the main process and the renderer alike.
 */

/* -------------------------------------------------------------------------- */
/*  Aadhaar — 12 digits, Verhoeff checksum (UIDAI spec)                        */
/* -------------------------------------------------------------------------- */

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
]

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
]

/** Strips spaces/dashes and returns digits only. */
export function normalizeAadhaar(value: string): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * Full UIDAI validation: 12 digits, cannot start with 0 or 1, and must pass the
 * Verhoeff checksum. This is exactly what real Aadhaar numbers satisfy.
 */
export function isValidAadhaar(value: string): boolean {
  const digits = normalizeAadhaar(value)
  if (!/^[2-9][0-9]{11}$/.test(digits)) return false

  let c = 0
  const reversed = digits.split('').reverse().map(Number)
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]]
  }
  return c === 0
}

/** 1234 5678 9012 — display formatting. */
export function formatAadhaar(value: string): string {
  const d = normalizeAadhaar(value).slice(0, 12)
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

/** Shows only the last 4 digits: XXXX XXXX 9012 */
export function maskAadhaar(value?: string | null): string {
  const d = normalizeAadhaar(value ?? '')
  if (d.length !== 12) return value ?? ''
  return `XXXX XXXX ${d.slice(8)}`
}

/* -------------------------------------------------------------------------- */
/*  PAN — AAAAA9999A                                                           */
/* -------------------------------------------------------------------------- */

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** 4th char encodes the holder type. */
const PAN_HOLDER_TYPES: Record<string, string> = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  A: 'Association of Persons',
  B: 'Body of Individuals',
  G: 'Government Agency',
  J: 'Artificial Juridical Person',
  L: 'Local Authority',
  F: 'Firm / LLP',
  T: 'Trust'
}

export function normalizePan(value: string): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidPan(value: string): boolean {
  const pan = normalizePan(value)
  if (!PAN_RE.test(pan)) return false
  return pan[3] in PAN_HOLDER_TYPES
}

export function panHolderType(value: string): string | null {
  const pan = normalizePan(value)
  return PAN_HOLDER_TYPES[pan[3]] ?? null
}

/* -------------------------------------------------------------------------- */
/*  Mobile number — Indian 10-digit starting 6-9                               */
/* -------------------------------------------------------------------------- */

export function normalizePhone(value: string): string {
  let d = (value ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d
}

export function isValidPhone(value: string): boolean {
  return /^[6-9][0-9]{9}$/.test(normalizePhone(value))
}

export function formatPhone(value?: string | null): string {
  const d = normalizePhone(value ?? '')
  if (d.length !== 10) return value ?? ''
  return `${d.slice(0, 5)} ${d.slice(5)}`
}

/* -------------------------------------------------------------------------- */
/*  IMEI — 15 digits, Luhn checksum                                            */
/* -------------------------------------------------------------------------- */

export function normalizeImei(value: string): string {
  return (value ?? '').replace(/\D/g, '')
}

export function isValidImei(value: string): boolean {
  const d = normalizeImei(value)
  if (!/^[0-9]{15}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    let n = Number(d[i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

/** IMEIs that are 15 digits but fail Luhn still get accepted with a warning —
 *  some grey-market / refurbished handsets genuinely carry them. */
export function imeiCheck(value: string): { ok: boolean; warning?: string } {
  const d = normalizeImei(value)
  if (d.length === 0) return { ok: false, warning: 'IMEI is required' }
  if (d.length !== 15) return { ok: false, warning: 'IMEI must be exactly 15 digits' }
  if (!isValidImei(d)) return { ok: true, warning: 'Checksum does not match — please re-verify' }
  return { ok: true }
}

/* -------------------------------------------------------------------------- */
/*  GSTIN — 15 chars, embeds state code + PAN + checksum                       */
/* -------------------------------------------------------------------------- */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function normalizeGstin(value: string): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidGstin(value: string): boolean {
  const g = normalizeGstin(value)
  if (!GSTIN_RE.test(g)) return false
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(v / 36) + (v % 36)
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36]
  return check === g[14]
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function isValidPincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test((value ?? '').replace(/\D/g, ''))
}

export function isValidIfsc(value: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test((value ?? '').toUpperCase())
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value ?? '')
}

/** PIN: exactly 6 digits, and not something trivially guessable. */
export function pinIssue(pin: string): string | null {
  if (!/^[0-9]{6}$/.test(pin)) return 'PIN must be exactly 6 digits'
  if (/^(\d)\1{5}$/.test(pin)) return 'PIN cannot be the same digit six times'
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin))
    return 'PIN cannot be six digits in a row (e.g. 123456)'
  return null
}
