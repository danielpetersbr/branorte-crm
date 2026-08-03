/**
 * A apresentação do estudo que o CLIENTE vê.
 *
 * Recebe `DadosEstudo` — e SÓ ele. Observação interna do vendedor e status
 * comercial nem chegam aqui como prop, então não tem como vazar num descuido de
 * layout.
 *
 * Impressão: seta html.vr-printing e chama window.print(). O CSS de @media
 * print isola #vr-print-area (mesmo mecanismo do Due Diligence). O "Salvar em
 * PDF" é o próprio diálogo do navegador — evita puxar jsPDF/html2canvas pro
 * chunk só pra isso.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, MessageCircle, Printer } from 'lucide-react'
import { anos, brl, brlKg, dataBR, kgHora, meses, numero, pct } from '@/lib/venda-racao/formato'
import {
  fraseInvestimento, frasePrincipal, linkWhatsApp, resumoTexto, textoWhatsApp,
  type DadosEstudo,
} from '@/lib/venda-racao/estudo'

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

export function imprimirEstudo() {
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

export function ApresentacaoEstudo({ dados }: { dados: DadosEstudo }) {
  const [copiado, copiar] = useCopia()
  const [texto, setTexto] = useState(() => textoWhatsApp(dados))
  const [editandoTexto, setEditandoTexto] = useState(false)

  // Enquanto o vendedor não editar à mão, o texto acompanha os números.
  useEffect(() => {
    if (editandoTexto) return
    setTexto(textoWhatsApp(dados))
  }, [dados, editandoTexto])

  const d = dados

  return (
    <div>
      <div className="vr-cta vr-no-print" style={{ marginTop: 0, marginBottom: 16 }}>
        <a className="vr-btn primary" href={linkWhatsApp(d, texto)} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
        </a>
        <button type="button" className="vr-btn ghost" onClick={() => copiar(resumoTexto(d))}>
          {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiado ? 'Copiado!' : 'Copiar resumo'}
        </button>
        <button type="button" className="vr-btn ghost" onClick={imprimirEstudo}>
          <Printer className="h-4 w-4" /> Gerar PDF / Imprimir
        </button>
      </div>

      {/* ------------------------------------------------------ a folha */}
      <div className="vr-folha" id="vr-print-area">
        {/* --- capa */}
        <div className="vr-folha-hdr">
          <div>
            {/* Mesmo asset e mesmo ratio do orçamento (natural 2715x427 = 6,36).
                Dimensões explícitas porque width:auto quebra na impressão. */}
            <img
              src="/branorte-logo.png"
              alt="BRANORTE"
              width={191}
              height={30}
              style={{ display: 'block', width: 191, height: 30, maxWidth: '100%', marginBottom: 8 }}
            />
            <h2>Estudo de viabilidade da produção própria</h2>
            <div style={{ fontSize: 12, color: '#5c6b60' }}>Fábricas de ração e nutrição animal</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#5c6b60' }}>
            <div style={{ fontWeight: 700, color: '#17231a' }}>{d.codigo}</div>
            <div>Data do estudo: {dataBR(d.data)}</div>
            <div>Preços válidos até: {dataBR(d.validade)}</div>
          </div>
        </div>

        <div className="vr-selo-estimativa">
          Documento de ESTIMATIVA · não é proposta comercial nem garantia de resultado
        </div>

        {/* --- cliente */}
        <div className="vr-folha-bloco">
          <div className="bt">Cliente</div>
          <table>
            <tbody>
              <tr><td>Nome</td><td>{d.clienteNome || '—'}</td></tr>
              {d.clienteEmpresa && <tr><td>Propriedade / empresa</td><td>{d.clienteEmpresa}</td></tr>}
              {(d.clienteCidade || d.clienteUf) && (
                <tr><td>Cidade / UF</td><td>{[d.clienteCidade, d.clienteUf].filter(Boolean).join(' / ')}</td></tr>
              )}
              {d.clienteTelefone && <tr><td>Telefone</td><td>{d.clienteTelefone}</td></tr>}
              <tr><td>Produto analisado</td><td>{d.produto}{d.categoria ? ` — ${d.categoria}` : ''}</td></tr>
            </tbody>
          </table>
        </div>

        {d.textoApresentacao && (
          <div className="vr-folha-bloco">
            <div className="bt">Objetivo do estudo</div>
            <div style={{ fontSize: 13, color: '#5c6b60', lineHeight: 1.6 }}>{d.textoApresentacao}</div>
          </div>
        )}

        {/* --- situação atual + consumo */}
        <div className="vr-folha-bloco">
          <div className="bt">Situação atual e necessidade</div>
          <table>
            <tbody>
              <tr>
                <td>Como se abastece hoje</td>
                <td>{d.compraRacaoPronta ? 'Compra ração pronta' : 'Já produz de outra forma'}</td>
              </tr>
              <tr><td>Necessidade diária</td><td>{numero(d.consumoDiarioKg)} kg</td></tr>
              <tr><td>Necessidade mensal</td><td>{numero(d.consumoMensalKg)} kg ({numero(d.toneladasMes, 1)} t)</td></tr>
              <tr><td>Necessidade anual</td><td>{numero(d.consumoAnualKg)} kg</td></tr>
              <tr><td>Custo atual por kg</td><td>{brl(d.custoAtualPorKg, 2)}</td></tr>
              <tr><td>Custo atual mensal</td><td>{brl(d.custoAtualMensal)}</td></tr>
              <tr><td>Custo atual anual</td><td>{brl(d.custoAtualAnual)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* --- comparação */}
        <div className="vr-folha-bloco">
          <div className="bt">Comparação entre comprar e produzir</div>
          <div className="vr-folha-lado">
            <div className="col">
              <div className="ct">Comprando ração pronta</div>
              <div className="cm">{brl(d.custoAtualPorKg, 2)}<span>/kg</span></div>
              <div className="cs">{brl(d.custoAtualPorTonelada)}/t</div>
              <div className="cs">{brl(d.custoAtualMensal)} por mês</div>
              <div className="cs">{brl(d.custoAtualAnual)} por ano</div>
            </div>
            <div className="col verde">
              <div className="ct">Produzindo na propriedade</div>
              <div className="cm">{brl(d.custoProprioPorKg, 2)}<span>/kg</span></div>
              <div className="cs">Ingredientes {brl(d.custoIngredientesPorKg, 4)}/kg</div>
              <div className="cs">Operação {brl(d.custoOperacionalPorKg, 4)}/kg</div>
              <div className="cs">{brl(d.custoProprioPorTonelada)}/t</div>
              <div className="cs">{brl(d.custoProprioMensal)} por mês</div>
              <div className="cs">{brl(d.custoProprioAnual)} por ano</div>
            </div>
          </div>

          {/* gráfico de custos — barras simples, sobrevive à impressão */}
          <div className="vr-folha-barras">
            {[
              { rot: 'Comprando pronta', valor: d.custoAtualPorKg, cor: '#c0492f' },
              { rot: 'Produzindo', valor: d.custoProprioPorKg, cor: '#1f6d3a' },
            ].map(b => {
              const maior = Math.max(d.custoAtualPorKg, d.custoProprioPorKg, 0.0001)
              return (
                <div className="lin" key={b.rot}>
                  <span className="rot">{b.rot}</span>
                  <span className="trilha">
                    <i style={{ width: `${(b.valor / maior) * 100}%`, background: b.cor }} />
                  </span>
                  <span className="val">{brl(b.valor, 2)}/kg</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* --- resultado */}
        <div className={`vr-folha-total${d.vantajoso ? '' : ' neutro'}`}>
          <div>
            <div className="tl">{d.vantajoso ? 'Economia estimada por mês' : 'Resultado com os dados atuais'}</div>
            <div style={{ fontSize: 12, color: '#5c6b60', marginTop: 3 }}>
              {d.vantajoso
                ? `${brl(d.economiaAnual)} por ano · ${brl(d.economiaPorKg, 4)} por kg · ${pct(d.reducaoPct, 1)} de redução`
                : 'Produzir sai igual ou mais caro que comprar com os números informados.'}
            </div>
          </div>
          <div className="tv">{brl(d.economiaMensal)}</div>
        </div>

        <div className="vr-folha-frase">{frasePrincipal(d)}</div>

        {/* --- capacidade */}
        {d.capacidadeSugeridaKgHora > 0 && (
          <div className="vr-folha-bloco">
            <div className="bt">Capacidade de produção recomendada</div>
            <table>
              <tbody>
                <tr><td>Capacidade mínima calculada</td><td>{kgHora(d.capacidadeMinimaKgHora)}</td></tr>
                <tr><td>Capacidade recomendada</td><td>{kgHora(d.capacidadeRecomendadaKgHora)}</td></tr>
                <tr>
                  <td>Capacidade sugerida para análise</td>
                  <td><strong>aproximadamente {kgHora(d.capacidadeSugeridaKgHora)}</strong></td>
                </tr>
                <tr><td>Tempo estimado de funcionamento</td><td>{numero(d.horasPorDia, 1)} h por dia de produção</td></tr>
                <tr><td>Utilização da fábrica</td><td>{pct(d.utilizacaoPct, 0)} do tempo disponível</td></tr>
              </tbody>
            </table>
            {d.rotinaSugerida && (
              <div style={{ fontSize: 12.5, color: '#5c6b60', marginTop: 8 }}>{d.rotinaSugerida}</div>
            )}
            {d.acimaDaLinha && (
              <div style={{ fontSize: 12.5, color: '#8a4b1f', marginTop: 6 }}>
                A necessidade ultrapassa a maior capacidade da linha padrão — o dimensionamento
                final será tratado como projeto especial.
              </div>
            )}
          </div>
        )}

        {/* --- investimento e retorno */}
        {d.investimentoConsiderado > 0 && (
          <div className="vr-folha-bloco">
            <div className="bt">Investimento e retorno estimados</div>
            <table>
              <tbody>
                <tr><td>Investimento estimado</td><td>{brl(d.investimentoTotal)}</td></tr>
                {d.custoFinanceiro > 0 && (
                  <tr><td>Custo financeiro informado</td><td>{brl(d.custoFinanceiro)}</td></tr>
                )}
                <tr><td>Economia mensal estimada</td><td>{brl(d.economiaMensal)}</td></tr>
                <tr><td>Economia anual estimada</td><td>{brl(d.economiaAnual)}</td></tr>
                <tr>
                  <td>Retorno estimado</td>
                  <td>{d.paybackAplicavel ? `${meses(d.paybackMeses, 1)} (${anos(d.paybackAnos)})` : 'não aplicável'}</td>
                </tr>
              </tbody>
            </table>

            <div className="bt" style={{ marginTop: 14 }}>Economia acumulada</div>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Período</th>
                  <th style={{ textAlign: 'right' }}>Economia acumulada</th>
                  <th style={{ textAlign: 'right' }}>Descontando o investimento</th>
                </tr>
              </thead>
              <tbody>
                {d.acumulado.map(a => (
                  <tr key={a.ano}>
                    <td>{a.ano} {a.ano === 1 ? 'ano' : 'anos'}</td>
                    <td style={{ textAlign: 'right' }}>{brl(a.economia)}</td>
                    <td style={{ textAlign: 'right', color: a.liquido >= 0 ? '#1f6d3a' : '#c0492f' }}>{brl(a.liquido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {fraseInvestimento(d) && (
              <div className="vr-folha-frase" style={{ marginTop: 12 }}>{fraseInvestimento(d)}</div>
            )}
          </div>
        )}

        {/* --- cenários */}
        <div className="vr-folha-bloco">
          <div className="bt">Cenários considerados</div>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Cenário</th>
                <th style={{ textAlign: 'right' }}>Custo próprio</th>
                <th style={{ textAlign: 'right' }}>Economia mensal</th>
                <th style={{ textAlign: 'right' }}>Economia anual</th>
                <th style={{ textAlign: 'right' }}>Retorno</th>
              </tr>
            </thead>
            <tbody>
              {d.cenarios.map(c => (
                <tr key={c.chave}>
                  <td>{c.rotulo}</td>
                  <td style={{ textAlign: 'right' }}>{brlKg(c.custoProprioPorKg, 2)}</td>
                  <td style={{ textAlign: 'right' }}>{brl(c.economiaMensal)}</td>
                  <td style={{ textAlign: 'right' }}>{brl(c.economiaAnual)}</td>
                  <td style={{ textAlign: 'right' }}>{c.paybackAplicavel ? meses(c.paybackMeses, 0) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* --- premissas */}
        <div className="vr-folha-bloco" id="vr-premissas">
          <div className="bt">Premissas utilizadas</div>
          <table>
            <tbody>
              {d.premissas.map((p, i) => (
                <tr key={`${p.rotulo}-${i}`}>
                  <td>{p.rotulo}</td>
                  <td>
                    {p.valor}
                    {p.nota && <div style={{ fontSize: 11.5, color: '#8a988d', marginTop: 2 }}>{p.nota}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* --- rodapé */}
        <div className="vr-folha-rodape">
          <div style={{ color: '#17231a', fontWeight: 700, fontSize: 13 }}>
            {d.vendedorNome || 'Equipe comercial'} · Branorte
          </div>
          {d.clienteTelefone && <div style={{ marginTop: 2 }}>Contato do cliente: {d.clienteTelefone}</div>}
          <div style={{ marginTop: 6 }}>{d.avisoEstimativa}</div>
          <div style={{ marginTop: 6 }}>{d.avisoNutricional}</div>
          <div style={{ marginTop: 6 }}>
            Estudo {d.codigo} · emitido em {dataBR(d.data)} · preços de referência válidos até {dataBR(d.validade)}.
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ texto WhatsApp */}
      <div className="vr-card vr-no-print" id="vr-whats" style={{ marginTop: 18 }}>
        <h2>Mensagem para o WhatsApp</h2>
        <div className="vr-hint" style={{ marginBottom: 8 }}>
          Edite se quiser — o botão acima só ABRE a conversa com este texto pronto.
          Nada é enviado automaticamente.
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
