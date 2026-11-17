import { installBrowserRelease } from './browserRelease.js'

installBrowserRelease({
  release: import.meta.env.VITE_WA_CLIENT_RELEASE || '',
  apiBase: (import.meta.env.VITE_API_URL || '').replace(/\/+$/, ''),
})
