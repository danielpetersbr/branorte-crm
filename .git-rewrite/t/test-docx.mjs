// Teste local: gera DOCX com dados mock pra inspecionar visualmente.
// Roda: node test-docx.mjs
// Saída: d:/tmp/test-orcamento.docx

import { writeFileSync, mkdirSync } from 'fs'

// Workaround pra alias @/ — precisamos do tsx, mas vou usar require dinâmico
// que TypeScript-aware via tsx
import { gerarOrcamentoCustomDocx } from './src/lib/orcamento-custom-docx.ts'

// Dados mock que cobrem casos reais
const mockOpts = {
  numero: '2026 - 0937',
  dataEmissao: '26/05/2026',
  cliente: {
    nome: 'DANIEL DE OLIVEIRA PETERS',
    ac: 'DANIEL DE OLIVEIRA PETERS',
    fone: '+5548998313374',
    cidade: 'Braço do Norte',
    bairro: 'nossa senhora de fátima',
    endereco: 'Rua Paulo Andre Guesser 1080, Casa',
    cep: '88750-000',
    cnpj: '—',
    ie: '—',
    email: '—',
  },
  voltagem: 'trifasico',
  itens: [
    {
      letra: 'A',
      qtd: 1,
      nome: 'TRITURADOR DE GRÃOS 50 CV',
      specs: [
        'Construído em aço galvanizado',
        'Capacidade 5.000 kg/h (na densidade do milho e peneira 3,0mm)',
        'Acoplamento elástico',
        'Montado com peneira 3,0mm',
        'Equipamento fabricado com 36 martelos',
        'Acionamento: potência 50,0 CV. (motor não incluso)',
      ],
      valor: 51503.00,
      brinde: false,
      motor_cv: 50,
      motor_polos: 2,
      motor_qtd: 1,
      foto_url: '/test-equipment.png',
    },
  ],
  motores: [
    { cv: 50, polos: 2, qtd: 1, valor_unit: 24122, valor_total: 24122, item_nome: 'TRITURADOR DE GRÃOS 50 CV' },
  ],
  acessorios: null,
  totalEquip: 51503,
  totalMotores: 24122,
  totalProposta: 75625,
  formaPagamento: 'À vista (PIX) com 5% de desconto',
  dataVenda: '26/05/2026',
  prazoEntrega: '90 dias (úteis)',
  observacoes: null,
  vendedorNome: 'Daniel Peters',
}

console.log('[test] Gerando DOCX...')
const blob = await gerarOrcamentoCustomDocx(mockOpts)
console.log(`[test] DOCX gerado: ${blob.size} bytes`)

const buf = Buffer.from(await blob.arrayBuffer())
try { mkdirSync('d:/tmp', { recursive: true }) } catch {}
writeFileSync('d:/tmp/test-orcamento.docx', buf)
console.log('[test] Salvo em d:/tmp/test-orcamento.docx')
