// Nimiq user-friendly addresses are IBAN-style: "NQ" + 2 check digits + 32 base32 chars.

const BODY = /^[0-9A-HJ-NP-VXY]{32}$/

export function compactAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export function isValidNimiqAddress(address: string): boolean {
  const compact = compactAddress(address)
  if (compact.length !== 36 || !/^NQ\d{2}$/.test(compact.slice(0, 4)) || !BODY.test(compact.slice(4))) {
    return false
  }
  // ISO 13616 mod-97 check.
  let remainder = 0
  for (const char of compact.slice(4) + compact.slice(0, 4)) {
    for (const digit of String(parseInt(char, 36))) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

export function formatAddress(address: string): string {
  return compactAddress(address).replace(/(.{4})(?=.)/g, '$1 ')
}

export function sameAddress(a: string, b: string): boolean {
  return compactAddress(a) === compactAddress(b)
}
