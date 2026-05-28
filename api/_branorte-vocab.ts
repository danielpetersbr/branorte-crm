// Glossário Branorte usado pelo pos-processamento de transcricao de audio.
// Whisper/gpt-4o-mini-transcribe erra termos tecnicos do dominio (chupim vira
// "chumbim", BNMM vira "bilim", etc.). Este vocabulario alimenta o pos-processor
// gpt-5.4-mini com instrucao explicita "corrige APENAS o que estiver
// manifestamente errado contra este glossario, preserve o resto".
//
// Fontes:
// - Catalogo precos_branorte (319+ SKUs, 22 categorias)
// - SKILL branorte-orcamentos
// - Conversas reais do copiloto IA Branorte

export const BRANORTE_VOCAB = {
  // Equipamentos principais (categoria → termos canonicos)
  equipamentos: [
    'chupim', 'chupim helicoidal',
    'transportador helicoidal', 'TH', 'helicoidal',
    'rosca transportadora', 'rosca',
    'moinho de martelo', 'moinho martelo', 'BNMM',
    'misturador vertical', 'BNMV',
    'misturador horizontal', 'BNMH',
    'caçamba de pesagem', 'caçamba',
    'silo metálico', 'silo de ração', 'silo de milho',
    'ensacadeira', 'ensacadeira semiautomática',
    'balança eletrônica', 'balança',
    'elevador de canecas', 'elevador',
    'pré-limpeza',
    'moega', 'moega de descarga',
    'caixa de ração', 'caixa de armazenamento',
    'compacta 01', 'compacta 02', 'compacta 03',
    'master', 'master jr', 'mini fábrica', 'mini',
    'fábrica de ração',
    'aglutinador', 'biomart', 'ciclone', 'motorredutor',
    'painel elétrico', 'painel',
    'talha elétrica',
    'esteira transportadora', 'esteira',
    'elevador de sacaria',
    'suporte de big bag', 'suporte big bag',
    'descarga', 'passarela',
    'helicóide', 'helicoide',
  ],

  // Códigos/modelos (sempre maiúsculas, podem vir transcritos errados)
  codigos: [
    'BNMM', 'BNMV', 'BNMH', 'BNCH', 'BNHC', 'BNCX', 'BNPL', 'BNSP',
    'EC-2310', 'EC-4012', 'EC-5014', 'EC-5020', 'EC-5025',
    'SAB471', 'SAB718', 'SAB965', 'SAB1313', 'SAB1897', 'SAB2481',
    'SAB3065', 'SAB3727', 'SAB4695', 'SAB5663',
  ],

  // Medidas e numeros tipicos (Whisper tende a confundir "210" com "duzentos e dez",
  // "5 metros" com "cinco metros" — queremos numerico)
  medidas_diametro_mm: [160, 210, 250, 300],
  medidas_comprimento_m: [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10, 12, 15],
  capacidades_kg_h: [75, 150, 300, 500, 1000, 2000, 5000],
  capacidades_ton: [3.1, 4.7, 6.3, 8.5, 12.3, 16.1, 19.9, 24.2, 28, 35.2, 42.5,
                   196.5, 249.8, 298.5, 368.3, 333.8, 474.8, 961.5, 1008.8, 1388.3,
                   1415.3, 1972.5, 1992.8],
  capacidades_litros: [600, 1000, 1900, 3000],
  potencias_cv: [1, 1.5, 2, 3, 4, 5, 5.5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 75, 100],

  // Termos de motor
  motor: ['CV', 'cv', 'mono', 'monofásico', 'trifásico', 'trif', '4 polos', '6 polos',
          'motor', 'motor incluso', 'sem motor', 'motorredutor'],

  // Materiais
  materiais: ['aço inox', 'inox', 'aço carbono', 'galvanizado', 'chapa', 'chapa #14',
              'chapa #16', 'chapa #18'],

  // Acoes do copiloto
  acoes: ['orçamento', 'gerar PDF', 'mandar no WhatsApp', 'envia', 'manda',
          'adiciona', 'remove', 'troca', 'aumenta', 'diminui',
          'salva', 'finaliza', 'fecha o orçamento'],

  // Confusoes comuns conhecidas (erro → certo)
  // Use isso PRO PROMPT como exemplos do que corrigir
  confusoes_conhecidas: [
    { errado: 'chumbim', certo: 'chupim' },
    { errado: 'chumbinho', certo: 'chupim' },
    { errado: 'cubim', certo: 'chupim' },
    { errado: 'B&M', certo: 'BNMM' },
    { errado: 'bê eme eme', certo: 'BNMM' },
    { errado: 'bilim', certo: 'BNMM' },
    { errado: 'compacta um', certo: 'Compacta 01' },
    { errado: 'compacta zero um', certo: 'Compacta 01' },
    { errado: 'compacta dois', certo: 'Compacta 02' },
    { errado: 'compacta três', certo: 'Compacta 03' },
    { errado: 'misturador BMH', certo: 'misturador BNMH' },
    { errado: 'misturador BMV', certo: 'misturador BNMV' },
    { errado: 'th', certo: 'TH' },
    { errado: 'rosca elicoidal', certo: 'rosca helicoidal' },
    { errado: 'transportadora elicoidal', certo: 'transportador helicoidal' },
    { errado: 'eletor de canecas', certo: 'elevador de canecas' },
    { errado: 'pre limpeza', certo: 'pré-limpeza' },
    { errado: 'pré limpeza', certo: 'pré-limpeza' },
    { errado: 'cacamba', certo: 'caçamba' },
    { errado: 'casamba', certo: 'caçamba' },
    { errado: 'casanga', certo: 'caçamba' },
    { errado: 'big back', certo: 'big bag' },
    { errado: 'big bagg', certo: 'big bag' },
    { errado: 'helicoide', certo: 'helicóide' },
  ],
};

/**
 * Monta o system prompt do pos-processador de transcricao.
 * Inclui o glossario + instrucoes restritivas para evitar alucinacao.
 */
export function buildCorrecaoPrompt(): string {
  const v = BRANORTE_VOCAB;
  return `Você é um corretor ortográfico ESPECIALIZADO em transcrições de áudio de orçamentos da metalúrgica Branorte (Grão Pará/SC).

REGRA #1 (CRÍTICA): Corrija APENAS palavras manifestamente erradas comparando com o glossário abaixo. NÃO reescreva, NÃO reformule, NÃO mude ordem das frases, NÃO traduza. Preserve TUDO que não estiver claramente errado.

REGRA #2: Se em dúvida sobre uma correção, MANTENHA O ORIGINAL. É melhor deixar um erro do que inventar uma palavra errada.

REGRA #3: Mantenha os números como vieram (210, 5 metros, 40 toneladas, 100 CV). Só converta extenso pra dígito se for óbvio (ex: "cento e sessenta por cinco metros" → "160 por 5 metros").

REGRA #4: Mantenha pontuação e capitalização naturais do texto. Não force letras maiúsculas exceto para códigos técnicos (BNMM, TH, EC-2310, etc.).

GLOSSÁRIO BRANORTE — termos canônicos que devem aparecer corretos:

EQUIPAMENTOS: ${v.equipamentos.join(', ')}.

CÓDIGOS TÉCNICOS (sempre maiúsculo): ${v.codigos.join(', ')}.

MEDIDAS COMUNS:
- Diâmetros (mm): ${v.medidas_diametro_mm.join(', ')}
- Comprimentos (m): ${v.medidas_comprimento_m.join(', ')}
- Capacidades (kg/h): ${v.capacidades_kg_h.join(', ')}
- Capacidades silo (toneladas): ${v.capacidades_ton.slice(0, 12).join(', ')}...
- Potências (CV): ${v.potencias_cv.join(', ')}

MOTOR: ${v.motor.join(', ')}.

AÇÕES DO USUÁRIO: ${v.acoes.join(', ')}.

CONFUSÕES CONHECIDAS (corrija sempre que aparecer):
${v.confusoes_conhecidas.map(c => `- "${c.errado}" → "${c.certo}"`).join('\n')}

FORMATO DE SAÍDA: retorne APENAS o texto corrigido, sem aspas, sem explicação, sem markdown, sem prefixo. Se nada precisar ser corrigido, retorne o texto original idêntico.

EXEMPLOS:
Input: "Quero um chumbim de 210 por 5 metros mais um misturador BMH"
Output: Quero um chupim de 210 por 5 metros mais um misturador BNMH

Input: "Compacta dois com moinho B&M e casamba de pesagem"
Output: Compacta 02 com moinho BNMM e caçamba de pesagem

Input: "manda no whatsapp do cliente"
Output: manda no whatsapp do cliente`;
}
