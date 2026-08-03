/**
 * A proposta que o CLIENTE vê.
 *
 * O componente recebe `DadosProposta` — e SÓ ele. Custo, margem, lucro,
 * comissão, imposto, preço mínimo e desconto máximo nem chegam aqui como prop,
 * então não tem como vazar num descuido de layout.
 *
 * Impressão: seta html.vr-printing e chama window.print(). O CSS de
 * @media print isola #vr-print-area (mesmo mecanismo do Due Diligence). O
 * "Salvar em PDF" é o próprio diálogo de impressão do navegador — evita puxar
 * jsPDF/html2canvas pro chunk só pra isso.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, MessageCircle, Printer } from 'lucide-react'
import { brl, dataBR, numero } from '@/lib/venda-racao/formato'
import { linkWhatsApp, resumoTexto, textoWhatsApp, type DadosProposta } from '@/lib/venda-racao/proposta'

function useCopia(): [boolean, (t: string) => void] {
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    if (!copiado) return
    const t = setTimeout(() => setCopiado(false), 2000)
    return () => clearTimeout(t)
  }, [copiado])
  const copiar = (texto: string) => {
    navigator.clipboard?.writeText(texto)
      .then(() => setCopiado(true))
      .catch(() => {
        // Fallback pra navegador sem permissão de clipboard (http, iframe…)
        const ta = document.createElement('textarea')
        ta.value = texto
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); setCopiado(true) } catch { /* segue sem copiar */ }
        document.body.removeChild(ta)
      })
  }
  return [copiado, copiar]
}

export function imprimirProposta() {
  document.documentElement.classList.add('vr-printing')
  const limpar = () => {
    document.documentElement.classList.remove('vr-printing')
    window.removeEventListener('afterprint', limpar)
  }
  window.addEventListener('afterprint', limpar)
  window.print()
  // Safari/iOS às vezes não dispara afterprint — rede de segurança.
  setTimeout(limpar, 4000)
}

export function PropostaCliente({ dados }: { dados: DadosProposta }) {
  const [copiado, copiar] = useCopia()
  const [texto, setTexto] = useState(() => textoWhatsApp(dados))
  const [editandoTexto, setEditandoTexto] = useState(false)

  // Enquanto o vendedor não editar à mão, o texto acompanha os números.
  useEffect(() => {
    if (editandoTexto) return
    setTexto(textoWhatsApp(dados))
  }, [dados, editandoTexto])

  const sacos = Math.round(dados.sacos)

  return (
    <div>
      <div className="vr-cta vr-no-print" style={{ marginTop: 0, marginBottom: 16 }}>
        <a className="vr-btn primary" href={linkWhatsApp(dados, texto)} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="h-4 w-4" /> Enviar pelo WhatsApp
        </a>
        <button type="button" className="vr-btn ghost" onClick={() => copiar(resumoTexto(dados))}>
          {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiado ? 'Copiado!' : 'Copiar resumo'}
        </button>
        <button type="button" className="vr-btn ghost" onClick={imprimirProposta}>
          <Printer className="h-4 w-4" /> Imprimir / Salvar em PDF
        </button>
      </div>

      {/* ------------------------------------------------------ a folha */}
      <div className="vr-folha" id="vr-print-area">
        <div className="vr-folha-hdr">
          <div>
            <div className="vr-brand" style={{ color: '#1f6d3a' }}>BRA<b style={{ color: '#2f8f4e' }}>NORTE</b></div>
            <h2>Proposta comercial</h2>
            <div style={{ fontSize: 12, color: '#5c6b60' }}>Fábricas de ração e nutrição animal</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#5c6b60' }}>
            <div style={{ fontWeight: 700, color: '#17231a' }}>{dados.codigo}</div>
            <div>Emissão: {dataBR(dados.data)}</div>
            <div>Validade: {dataBR(dados.validade)}</div>
          </div>
        </div>

        <div className="vr-folha-bloco">
          <div className="bt">Cliente</div>
          <table>
            <tbody>
              <tr><td>Nome</td><td>{dados.clienteNome || '—'}</td></tr>
              {dados.clienteEmpresa && <tr><td>Empresa / propriedade</td><td>{dados.clienteEmpresa}</td></tr>}
              {(dados.clienteCidade || dados.clienteUf) && (
                <tr><td>Cidade / UF</td><td>{[dados.clienteCidade, dados.clienteUf].filter(Boolean).join(' / ')}</td></tr>
              )}
              {dados.clienteTelefone && <tr><td>Telefone</td><td>{dados.clienteTelefone}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="vr-folha-bloco">
          <div className="bt">Produto</div>
          <table>
            <tbody>
              <tr><td>Tipo de ração</td><td>{dados.produto}</td></tr>
              {dados.categoria && <tr><td>Categoria / fase</td><td>{dados.categoria}</td></tr>}
              <tr><td>Quantidade</td><td>{numero(dados.quantidadeKg)} kg ({numero(dados.toneladas, 1)} t)</td></tr>
              <tr>
                <td>Embalagem</td>
                <td>{sacos > 0 ? `${numero(sacos)} sacos de ${numero(dados.pesoSaco)} kg` : 'A combinar'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="vr-folha-bloco">
          <div className="bt">Valores</div>
          <table>
            <tbody>
              <tr><td>Preço por kg</td><td>{brl(dados.precoPorKg, 2)}</td></tr>
              <tr><td>Preço por saco de {numero(dados.pesoSaco)} kg</td><td>{brl(dados.precoPorSaco)}</td></tr>
              <tr><td>Preço por tonelada</td><td>{brl(dados.precoPorTonelada)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="vr-folha-total">
          <div>
            <div className="tl">Valor total do fornecimento</div>
            <div style={{ fontSize: 12, color: '#5c6b60', marginTop: 3 }}>
              {numero(dados.quantidadeKg)} kg · {sacos > 0 ? `${numero(sacos)} sacos` : 'a granel'}
            </div>
          </div>
          <div className="tv">{brl(dados.valorTotal)}</div>
        </div>

        <div className="vr-folha-bloco">
          <div className="bt">Condições</div>
          <table>
            <tbody>
              <tr><td>Forma de pagamento</td><td>{dados.formaPagamento || 'A combinar'}</td></tr>
              <tr><td>Prazo de pagamento</td><td>{dados.prazoPagamento || 'A combinar'}</td></tr>
              <tr><td>Entrega / frete</td><td>{dados.condicaoEntrega || 'A combinar'}</td></tr>
              <tr><td>Validade da proposta</td><td>{dataBR(dados.validade)}</td></tr>
            </tbody>
          </table>
        </div>

        {dados.textoComercial && (
          <div className="vr-folha-bloco">
            <div className="bt">Observações</div>
            <div style={{ fontSize: 13, color: '#5c6b60', lineHeight: 1.6 }}>{dados.textoComercial}</div>
          </div>
        )}

        <div className="vr-folha-rodape">
          <div style={{ color: '#17231a', fontWeight: 700, fontSize: 13 }}>
            {dados.vendedorNome || 'Equipe comercial'} · Branorte
          </div>
          <div style={{ marginTop: 6 }}>{dados.avisoNutricional}</div>
          <div style={{ marginTop: 6 }}>
            Proposta {dados.codigo} · emitida em {dataBR(dados.data)} · válida até {dataBR(dados.validade)}.
            Valores sujeitos a confirmação após a validade.
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ texto WhatsApp */}
      <div className="vr-card vr-no-print" style={{ marginTop: 18 }}>
        <h2>Mensagem para o WhatsApp</h2>
        <div className="vr-hint" style={{ marginBottom: 8 }}>
          Edite se quiser — o botão acima envia exatamente o que estiver aqui.
          Nenhum custo, margem ou comissão entra nesta mensagem.
        </div>
        <textarea
          className="vr-msgbox"
          value={texto}
          onChange={e => { setEditandoTexto(true); setTexto(e.target.value) }}
        />
        <div className="vr-cta">
          <button type="button" className="vr-btn ghost" onClick={() => copiar(texto)}>
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiado ? 'Copiado!' : 'Copiar mensagem'}
          </button>
          {editandoTexto && (
            <button
              type="button" className="vr-btn ghost"
              onClick={() => { setEditandoTexto(false); setTexto(textoWhatsApp(dados)) }}
            >
              Restaurar texto padrão
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
