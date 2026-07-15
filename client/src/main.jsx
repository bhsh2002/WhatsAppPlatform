import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/alexandria'
import { LanguageProvider } from './context/LanguageContext.jsx'
import AppProviders from './AppProviders.jsx'
import './index.css'

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('axe') === '1') {
  import('./accessibility/axeDevAudit.js')
    .then(({ runAxeDevAudit }) => runAxeDevAudit())
    .catch((error) => {
      console.error('Failed to initialize the development accessibility audit:', error)
    })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider>
      <AppProviders />
    </LanguageProvider>
  </StrictMode>,
)
