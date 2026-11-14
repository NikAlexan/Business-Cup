import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { queryRetry } from './api/api'
import App from './App'
import './styles/screens.css'
import './styles/app.css'

const client = new QueryClient({
  defaultOptions: { queries: { retry: queryRetry, staleTime: 10_000 }, mutations: { retry: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
