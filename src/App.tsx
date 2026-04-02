import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Contacts } from '@/pages/Contacts'
import { Assign } from '@/pages/Assign'
import { Orcamentos } from '@/pages/Orcamentos'
import { Vendidos } from '@/pages/Vendidos'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contatos" element={<Contacts />} />
            <Route path="/atribuir" element={<Assign />} />
            <Route path="/orcamentos" element={<Orcamentos />} />
            <Route path="/vendidos" element={<Vendidos />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
