export function isNavigationItemActive(
  destination: string,
  pathname: string,
  search: string,
  end = false,
): boolean {
  const queryIndex = destination.indexOf('?')
  const destinationPath = queryIndex < 0 ? destination : destination.slice(0, queryIndex)
  const pathMatches = end
    ? pathname === destinationPath
    : pathname === destinationPath || pathname.startsWith(destinationPath + '/')
  if (!pathMatches) return false

  const required = new URLSearchParams(queryIndex < 0 ? '' : destination.slice(queryIndex + 1))
  const current = new URLSearchParams(search)
  for (const [key, value] of required) {
    if (current.get(key) !== value) return false
  }
  return true
}
