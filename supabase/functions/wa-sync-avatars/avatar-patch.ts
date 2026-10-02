export type AvatarResult = { pic_url?: unknown; pic_checked?: unknown }

// A nullable result from older extensions also meant lookup failure. Only an
// explicit successful lookup may remove a cached picture for privacy/no-photo.
export function avatarPatch(result: AvatarResult, storedUrl: string | null, checkedAt: string): Record<string, unknown> | null {
  if (storedUrl) return { foto_url: storedUrl, foto_checked_at: checkedAt }
  if (result.pic_checked === true && result.pic_url === null) return { foto_url: null, foto_checked_at: checkedAt }
  // Failed downloads/lookups remain eligible for the next batch.
  return null
}

// Keyset pagination lets ANA advance beyond unavailable/undefined WPP lookups.
export function normalizeAvatarCursor(value: unknown): string | null {
  return typeof value==='string' && /^[+0-9]{7,40}$/.test(value) ? value : null
}
export function nextAvatarCursor(rows: {phone:string}[]): string | null {
  return rows.length ? rows[rows.length-1].phone : null
}
