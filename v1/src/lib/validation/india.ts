/**
 * India statutory identifier validation.
 *
 * The database enforces FORMAT (cheap regex CHECK constraints that cannot be
 * bypassed by any code path). This module enforces CORRECTNESS — checksums,
 * cross-field consistency — where a useful error message can be produced and
 * shown next to the offending field.
 *
 * Both layers are needed. Format-only validation accepts `29AABCU9603R1ZZ`,
 * which looks perfectly well-formed and is not a real GSTIN. Discovering that
 * at invoice time in M6, after three POs have shipped, is expensive.
 */

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** GST state codes → state name. Position 1–2 of every GSTIN. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
}

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/
/** E.164. Indian mobile numbers begin 6–9; landlines and other countries differ. */
export const E164_REGEX = /^\+[1-9][0-9]{7,14}$/
export const INDIAN_MOBILE_REGEX = /^\+91[6-9][0-9]{9}$/

/**
 * Computes the GSTIN check character for the first 14 characters.
 *
 * Algorithm (GSTN specification): each character's index in the 36-character
 * alphanumeric set is multiplied by an alternating 1,2,1,2… factor; the digits
 * of each product in base 36 are summed; the check character is whatever brings
 * the total to a multiple of 36.
 */
export function gstinCheckDigit(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARSET.indexOf(first14[i])
    if (value < 0) throw new Error(`Invalid GSTIN character at position ${i + 1}`)
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36]
}

export interface ValidationResult {
  valid: boolean
  /** Present when invalid. Written for a Procurement Head, not a developer. */
  error?: string
}

export function validateGstin(raw: string): ValidationResult {
  const gstin = raw.trim().toUpperCase()

  if (gstin.length !== 15) {
    return { valid: false, error: `A GSTIN is 15 characters; this one has ${gstin.length}.` }
  }
  if (!GSTIN_REGEX.test(gstin)) {
    return { valid: false, error: 'That is not a valid GSTIN format.' }
  }

  const stateCode = gstin.slice(0, 2)
  if (!(stateCode in GST_STATE_CODES)) {
    return { valid: false, error: `"${stateCode}" is not a valid GST state code.` }
  }

  const expected = gstinCheckDigit(gstin.slice(0, 14))
  if (gstin[14] !== expected) {
    // Almost always a transcription slip off a photographed certificate.
    return {
      valid: false,
      error: `Checksum failed — the last character should be "${expected}", not "${gstin[14]}". Please re-check the certificate.`,
    }
  }

  return { valid: true }
}

export function validatePan(raw: string): ValidationResult {
  const pan = raw.trim().toUpperCase()
  if (!PAN_REGEX.test(pan)) {
    return { valid: false, error: 'A PAN looks like AAAAA9999A (5 letters, 4 digits, 1 letter).' }
  }
  return { valid: true }
}

export function validateIfsc(raw: string): ValidationResult {
  const ifsc = raw.trim().toUpperCase()
  if (!IFSC_REGEX.test(ifsc)) {
    return {
      valid: false,
      error: 'An IFSC is 11 characters: 4 bank letters, a 0, then 6 branch characters (e.g. HDFC0001234).',
    }
  }
  return { valid: true }
}

/** The PAN is embedded at GSTIN positions 3–12; a mismatch means one is wrong. */
export function gstinMatchesPan(gstin: string, pan: string): boolean {
  return gstin.trim().toUpperCase().slice(2, 12) === pan.trim().toUpperCase()
}

export function stateCodeFromGstin(gstin: string): string | null {
  const code = gstin.trim().slice(0, 2)
  return code in GST_STATE_CODES ? code : null
}

/**
 * Normalises Indian phone input to E.164.
 *
 * Vendors type numbers every imaginable way — `98765 43210`, `098765-43210`,
 * `+91 98765 43210`. Rejecting those instead of normalising them creates
 * exactly the friction that pushes people back to WhatsApp.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '')

  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`
  if (/^0?[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(-10)}`
  // Already-valid non-Indian E.164 passes through for future overseas vendors.
  if (E164_REGEX.test(digits)) return digits

  return null
}

/**
 * Statutory maximum credit period for a micro or small MSME supplier.
 *
 * Income Tax Act s.43B(h): payments beyond this window are disallowed as an
 * expense for the financial year. Enforced in the database too — this is the
 * value the UI shows before the write is attempted.
 */
export const MSME_MAX_PAYMENT_DAYS = 45

export function maxPaymentTermsDays(msmeCategory: string): number {
  return msmeCategory === 'micro' || msmeCategory === 'small' ? MSME_MAX_PAYMENT_DAYS : 180
}
