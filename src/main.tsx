import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fonts are bundled rather than pulled from Google Fonts: the APK has to look
// right with no network, and a webview cold-start shouldn't wait on a CDN.
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import '@fontsource/baloo-2/600.css'
import '@fontsource/baloo-2/700.css'
import '@fontsource/baloo-2/800.css'

import './index.css'
import App from './App'
import { StoreProvider } from './app/store'
import { DeviceProvider } from './platform/device'
import { DiagnosticsBoundary, installGlobalDiagnostics } from './app/DiagnosticsBoundary'

installGlobalDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiagnosticsBoundary>
      <DeviceProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </DeviceProvider>
    </DiagnosticsBoundary>
  </StrictMode>,
)
