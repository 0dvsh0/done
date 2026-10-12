import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource/instrument-serif'
import './styles.css'
import { initTheme } from './theme'
import App from './App'

/* Before the first paint, not after it: the very first frame is already in
   the right ink, so switching modes never costs a flash. */
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
