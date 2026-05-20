// Phone numbers come in as "+62 812-3456-7890", "0812345...", etc.
// Normalize to digits-only so duplicates and contact lookups work regardless
// of formatting. Leading zeros are preserved since they're meaningful in some
// national dialing plans.
export function normalizePhone(phone: string | undefined | null) {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

// Mask the middle digits of a phone number while preserving the original
// formatting (spaces, dashes, leading "+"). The DB still stores the full
// number — censoring only happens at the display/export boundary.
export function censorPhone(
  phone: string | undefined | null,
  opts: { prefix?: number; suffix?: number } = {},
): string {
  if (!phone) return ''
  const prefix = opts.prefix ?? 3
  const suffix = opts.suffix ?? 4
  const digitCount = (phone.match(/\d/g) ?? []).length
  // Too short to meaningfully censor — leave as-is rather than dump asterisks.
  if (digitCount <= prefix + suffix) return phone

  let seen = 0
  let out = ''
  for (const ch of phone) {
    if (/\d/.test(ch)) {
      out += seen < prefix || seen >= digitCount - suffix ? ch : '*'
      seen++
    } else {
      out += ch
    }
  }
  return out
}
