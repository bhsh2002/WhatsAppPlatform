export const CLIENT_RELEASE_HEADER = 'X-WA-Client-Release'
const INSTALLATION = Symbol.for('wa-savana.browser-release')

const configuredRelease = value => {
  const release = String(value ?? '').trim()
  if (release && !/^[a-f0-9]{64}$/.test(release)) {
    throw new Error('VITE_WA_CLIENT_RELEASE must be empty or a lowercase SHA-256 content identifier')
  }
  return release
}

const apiScope = (apiBase, locationHref) => {
  const page = new URL(locationHref)
  const base = new URL(apiBase || page.origin, `${page.origin}/`)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('The configured API base must be an HTTP origin/path without credentials, query or fragment')
  }
  return { origin: base.origin, path: `${base.pathname.replace(/\/+$/, '')}/api` }
}

export const createBrowserReleaseFetch = (fetchImpl, { release = '', apiBase = '', locationHref } = {}) => {
  const current = configuredRelease(release)
  if (!current) return fetchImpl
  const scope = apiScope(apiBase, locationHref)
  return function browserReleaseFetch(input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request
    let url
    try {
      url = new URL(isRequest ? input.url : input, locationHref)
    } catch {
      return Reflect.apply(fetchImpl, this, arguments)
    }
    if (url.origin !== scope.origin || url.username || url.password
      || !(url.pathname === scope.path || url.pathname.startsWith(`${scope.path}/`))) {
      return Reflect.apply(fetchImpl, this, arguments)
    }
    // RequestInit.headers replaces Request.headers in native fetch; retain that
    // precedence without cloning/consuming a Request body or changing credentials.
    const headers = new Headers(init?.headers === undefined && isRequest ? input.headers : init?.headers)
    headers.set(CLIENT_RELEASE_HEADER, current)
    const redirect = init?.redirect ?? (isRequest ? input.redirect : 'follow')
    return Reflect.apply(fetchImpl, this, [input, {
      ...init,
      headers,
      // A custom header can survive cross-origin redirects. Never follow a
      // tagged API redirect or automatically replay the original mutation.
      redirect: redirect === 'follow' ? 'error' : redirect,
    }])
  }
}

export const installBrowserRelease = ({ target = globalThis, release = '', apiBase = '', locationHref = target.location?.href } = {}) => {
  const current = configuredRelease(release)
  if (!current) return { enabled: false, release: null }
  if (target[INSTALLATION]) return { ...target[INSTALLATION] }
  if (typeof target.fetch !== 'function') throw new Error('Browser fetch is required for release negotiation')
  target.fetch = createBrowserReleaseFetch(target.fetch, { release: current, apiBase, locationHref })
  const status = Object.freeze({ enabled: true, release: current })
  Object.defineProperty(target, INSTALLATION, { value: status })
  return { ...status }
}
