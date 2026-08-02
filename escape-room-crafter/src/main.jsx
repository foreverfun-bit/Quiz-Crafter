import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { RoomsProvider } from './store/RoomsContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <RoomsProvider>
        <App />
      </RoomsProvider>
    </BrowserRouter>
  </StrictMode>,
)
