import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Apps2 from './apps2.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Apps2 />
  </StrictMode>,
)
