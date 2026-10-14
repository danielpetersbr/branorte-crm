import { useEffect } from 'react'
import { toast } from 'sonner'
import { supabase as controle } from '@/lib/controle-supabase/client'
import {
  destravarSomNoPrimeiroGesto, reivindicarVenda, somVendaLiberado, tocarSomVenda, vendaLancadaAqui,
} from '@/lib/pedido-venda/somVenda'

// ============================================================================
// VENDA NOVA EM TODO CRM ABERTO (pedido do Daniel, 14/10/2026)
//
// A cada 30 s olha se entrou pedido em `pedidos_venda` (banco do controle, leitura
// anon — a mesma que o resto do CRM usa) e, havendo venda, toca o ka-ching e mostra
// "PEDRO vendeu R$ 83.322". Pega pedido lançado pelo CRM E pelo controle antigo.
//
//  • Garantia não é venda: entra com valor 0 e fica de fora.
//  • Abrir a tela não "anuncia" o passado: a primeira consulta só marca o ponto de
//    partida (o pedido mais recente que já existia).
//  • Várias abas no mesmo computador: o aviso aparece em todas, mas `reivindicarVenda`
//    deixa UMA tocar. Quem lançou já ouviu na hora e não ouve nem vê de novo.
//  • Aba que ninguém clicou desde que abriu fica muda — regra do navegador. O aviso
//    escrito aparece mesmo assim.
// ============================================================================

const INTERVALO_MS = 30_000

type PedidoNovo = { id: string; vendedor: string | null; valor_total: number | null; created_at: string }

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

export default function AvisoVendaNova() {
  useEffect(() => {
    const soltarGesto = destravarSomNoPrimeiroGesto()
    let base: string | null = null
    let parado = false
    let ocupado = false

    async function olhar() {
      if (ocupado || parado) return
      ocupado = true
      try {
        if (base === null) {
          const { data, error } = await controle
            .from('pedidos_venda').select('created_at').order('created_at', { ascending: false }).limit(1)
          if (error) return
          base = (data?.[0] as { created_at?: string } | undefined)?.created_at ?? new Date().toISOString()
          return
        }
        const { data, error } = await controle
          .from('pedidos_venda')
          .select('id,vendedor,valor_total,created_at')
          .gt('created_at', base)
          .order('created_at', { ascending: true })
          .limit(20)
        if (error || parado || !data?.length) return
        const novos = data as PedidoNovo[]
        base = novos[novos.length - 1].created_at
        for (const p of novos) {
          const valor = Number(p.valor_total) || 0
          if (valor <= 0) continue
          // O aviso escrito sai em TODA aba (ele pode estar olhando qualquer uma); o som,
          // uma vez por navegador. Quem lançou já viu o sucesso e ouviu na hora.
          if (vendaLancadaAqui(p.id)) continue
          const quem = (p.vendedor || 'Alguém').trim()
          toast.success(`💰 Venda nova! ${quem} vendeu ${brl(valor)}`, { duration: 12_000 })
          if (somVendaLiberado() && await reivindicarVenda(p.id)) tocarSomVenda()
        }
      } catch {
        // rede caiu: tenta no próximo ciclo, sem incomodar ninguém
      } finally {
        ocupado = false
      }
    }

    void olhar()
    const t = window.setInterval(() => { void olhar() }, INTERVALO_MS)
    return () => { parado = true; window.clearInterval(t); soltarGesto() }
  }, [])

  return null
}
