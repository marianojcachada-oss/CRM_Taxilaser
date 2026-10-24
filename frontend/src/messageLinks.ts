type AllowedLinkDomain = {
  hostname: string
  includeSubdomains?: boolean
  pathPrefix?: string
}

export const ALLOWED_LINK_DOMAINS: readonly AllowedLinkDomain[] = [
  { hostname: 'maps.google.com', includeSubdomains: true },
  { hostname: 'maps.app.goo.gl' },
  { hostname: 'maps.apple.com' },
  { hostname: 'finghub.com', includeSubdomains: true },
  { hostname: 'google.com', pathPrefix: '/maps' },
  { hostname: 'www.google.com', pathPrefix: '/maps' },
  { hostname: 'goo.gl', pathPrefix: '/maps' },
]

const URL_CANDIDATE_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

function trimTrailingPunctuation(candidate: string): string {
  let url = candidate.replace(/[.,!?;:]+$/, '')
  const bracketPairs: [string, string][] = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ]

  for (const [opening, closing] of bracketPairs) {
    while (
      url.endsWith(closing) &&
      [...url].filter((character) => character === closing).length >
        [...url].filter((character) => character === opening).length
    ) {
      url = url.slice(0, -1)
    }
  }

  return url
}

function isAllowedUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')

  return ALLOWED_LINK_DOMAINS.some(({ hostname: allowedHost, includeSubdomains, pathPrefix }) => {
    const hostMatches =
      hostname === allowedHost ||
      (includeSubdomains === true && hostname.endsWith(`.${allowedHost}`))
    const pathMatches =
      pathPrefix === undefined ||
      url.pathname === pathPrefix ||
      url.pathname.startsWith(`${pathPrefix}/`)

    return hostMatches && pathMatches
  })
}

export function hasUnrecognizedLinks(message: string): boolean {
  URL_CANDIDATE_PATTERN.lastIndex = 0

  for (const match of message.matchAll(URL_CANDIDATE_PATTERN)) {
    const candidate = trimTrailingPunctuation(match[0])
    let url: URL

    try {
      url = new URL(/^www\./i.test(candidate) ? `https://${candidate}` : candidate)
    } catch {
      return true
    }

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isAllowedUrl(url)) {
      return true
    }
  }

  return false
}
