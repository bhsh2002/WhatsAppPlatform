import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from './context/LanguageContext.jsx'
import AppProviders from './AppProviders.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider>
      <AppProviders />
    </LanguageProvider>
  </StrictMode>,
)
