/**
 * India statutory validation.
 *
 * The GSTIN cases below use real, publicly documented registration numbers
 * (GST training material). Fabricated "example" GSTINs found in blog posts are
 * format-valid but checksum-invalid, so they are useless as positive fixtures —
 * and make excellent negative ones.
 */
import { describe, it, expect } from 'vitest'
import {
  gstinCheckDigit,
  validateGstin,
  validatePan,
  validateIfsc,
  gstinMatchesPan,
  stateCodeFromGstin,
  normalisePhone,
  maxPaymentTermsDays,
  MSME_MAX_PAYMENT_DAYS,
} from '../src/lib/validation/india'

describe('GSTIN', () => {
  it.each([
    ['27AAPFU0939F1ZV', 'Maharashtra'],
    ['29AAGCB7383J1Z4', 'Karnataka'],
    ['24AAACC1206D1ZM', 'Gujarat'],
  ])('accepts the real GSTIN %s', (gstin) => {
    expect(validateGstin(gstin).valid).toBe(true)
  })

  it('computes the check character', () => {
    expect(gstinCheckDigit('27AAPFU0939F1Z')).toBe('V')
    expect(gstinCheckDigit('29AABCU9603R1Z')).toBe('J')
  })

  it('rejects a format-valid GSTIN whose checksum is wrong', () => {
    // The exact failure mode this layer exists to catch: passes the database
    // regex, is not a real registration.
    const result = validateGstin('29AABCU9603R1ZM')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/should be "J"/)
  })

  it('reports the wrong length plainly', () => {
    expect(validateGstin('29AABCU9603R1Z').error).toMatch(/15 characters.*has 14/)
  })

  it('rejects an unassigned state code', () => {
    expect(validateGstin('88AAPFU0939F1ZV').error).toMatch(/not a valid GST state code/)
  })

  it('normalises case and whitespace', () => {
    expect(validateGstin('  27aapfu0939f1zv  ').valid).toBe(true)
  })

  it('extracts the state code', () => {
    expect(stateCodeFromGstin('29AAGCB7383J1Z4')).toBe('29')
    expect(stateCodeFromGstin('88AAGCB7383J1Z4')).toBeNull()
  })

  it('cross-checks the embedded PAN', () => {
    expect(gstinMatchesPan('27AAPFU0939F1ZV', 'AAPFU0939F')).toBe(true)
    expect(gstinMatchesPan('27AAPFU0939F1ZV', 'AABCU9603R')).toBe(false)
  })
})

describe('PAN and IFSC', () => {
  it('accepts well-formed values', () => {
    expect(validatePan('AAPFU0939F').valid).toBe(true)
    expect(validateIfsc('HDFC0001234').valid).toBe(true)
    expect(validateIfsc('SBIN0A12345').valid).toBe(true)
  })

  it('rejects malformed values with a usable message', () => {
    expect(validatePan('AAPFU0939').valid).toBe(false)
    // 5th character of an IFSC is always 0.
    expect(validateIfsc('HDFC1001234').valid).toBe(false)
    expect(validateIfsc('HDFC0001234X').error).toMatch(/11 characters/)
  })
})

describe('phone normalisation', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['  +919876543210 ', '+919876543210'],
  ])('normalises %s', (input, expected) => {
    // Vendors type numbers every possible way. Rejecting instead of normalising
    // is precisely the friction that sends people back to WhatsApp.
    expect(normalisePhone(input)).toBe(expected)
  })

  it('rejects numbers that cannot be Indian mobiles', () => {
    expect(normalisePhone('1234567890')).toBeNull()   // starts 1
    expect(normalisePhone('98765')).toBeNull()        // too short
    expect(normalisePhone('abcdefghij')).toBeNull()
  })
})

describe('MSME payment terms', () => {
  it('caps micro and small suppliers at the statutory 45 days', () => {
    expect(maxPaymentTermsDays('micro')).toBe(MSME_MAX_PAYMENT_DAYS)
    expect(maxPaymentTermsDays('small')).toBe(MSME_MAX_PAYMENT_DAYS)
  })

  it('does not cap medium or unregistered suppliers', () => {
    // s.43B(h) applies to micro and small enterprises only.
    expect(maxPaymentTermsDays('medium')).toBeGreaterThan(MSME_MAX_PAYMENT_DAYS)
    expect(maxPaymentTermsDays('not_registered')).toBeGreaterThan(MSME_MAX_PAYMENT_DAYS)
  })
})
