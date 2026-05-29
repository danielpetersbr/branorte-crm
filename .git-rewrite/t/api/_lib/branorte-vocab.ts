// Glossário Branorte usado pelo pos-processamento de transcricao de audio.
// Whisper/gpt-4o-mini-transcribe erra termos tecnicos do dominio (chupim vira
// "chumbim", BNMM vira "bilim", etc.). Este vocabulario alimenta o pos-processor
// gpt-5.4-mini com instrucao explicita "corrige APENAS o que estiver
// manifestamente errado contra este glossario, preserve o resto".
//
// Fontes:
// - Skill branorte-orcamentos v1.2 (3.925 orçamentos reais 2025-2026 analisados)
// - Catálogo precos_branorte (319+ SKUs, 22 categorias)
// - Catálogo PDF 2026 (80+ modelos)
// - Glossário interno da skill + ranking de frequência de uso

export const BRANORTE_VOCAB = {
  // Equipamentos principais (categoria → termos canonicos)
  // Ordenado por frequência de uso 2025-2026 (skill seção 3.3)
  equipamentos: [
    // TOP 5 (>15% do uso)
    'moinho martelo', 'moinho de martelo', 'triturador de grãos', 'BNMM',
    'chupim', 'BNCH',
    'ensacadeira', 'ensacadeira semiautomática', 'ensacadeira saco valvulado',
    'misturador vertical', 'BNMV',
    'misturador horizontal', 'BNMH', 'misturador horizontal com pulmão',
    'misturador horizontal sem pulmão',
    // Fábricas (linha principal)
    'Compacta 01', 'Compacta 02', 'Compacta 03',
    'Compacta 01 Master', 'Compacta 02 Master', 'Compacta 03 Master',
    'Master', 'Master JR', 'Mini Fábrica', 'Mini Fábrica de Ração',
    'Compacta JR', 'Fábrica de Ração', 'fábrica de ração',
    // Transporte
    'transportador helicoidal', 'TH', 'helicoidal', 'BNHC',
    'rosca transportadora', 'rosca',
    'elevador de canecas', 'elevador', 'EC-2310', 'EC-4012', 'EC-5014',
    'esteira transportadora', 'esteira',
    'elevador de sacaria',
    // Pesagem e armazenamento
    'caçamba de pesagem', 'caçamba',
    'silo metálico', 'silo de ração', 'silo de milho', 'BNSP',
    'caixa de ração', 'caixa de picados', 'caixa de recepção',
    'caixa de armazenamento', 'caixa de matéria-prima', 'BNCX',
    // Processo
    'pré-limpeza', 'BNPL',
    'peneira', 'peneira vibratória',
    'martelos', 'martelo',
    'moega', 'moega de descarga', 'moega de recepção', 'BNM3X1',
    'helicóide', 'helicoide',
    // Acessórios estruturais
    'balança eletrônica', 'balança',
    'painel elétrico', 'painel', 'quadro elétrico',
    'suporte de big bag', 'suporte big bag', 'big bag', 'talha elétrica',
    'descarga', 'boca de descarga', 'passarela',
    'alimentador', 'aglutinador', 'ciclone', 'motorredutor',
    'cabine de enclausuramento', 'fecho rápido', 'cabo de aço',
    // Biomart (linha INOX 304)
    'Biomart', 'aço inox 304', 'INOX 304', 'misturador grajador',
    'elevador skyp', 'caixa ensaque',
    // Industriais especiais
    'embaladeira', 'redler', 'transportador de corrente',
    'linha extrusora', 'Welex', 'Union',
    'calha 60T', 'aço inox 316',
    'display digital', 'cabine', 'plataforma com escada',
    // Linha Proteinado
    'linha proteinado inox', 'proteinado',
  ],

  // Códigos/modelos (sempre maiúsculas, podem vir transcritos errados)
  codigos: [
    // Prefixos BN canônicos (skill seção 3.1)
    'BNMM', 'BNMV', 'BNMH', 'BNCH', 'BNHC', 'BNCX', 'BNPL', 'BNSP', 'BNM3X1',
    // Elevadores de Canecas
    'EC-2310', 'EC-4012', 'EC-5014', 'EC-5020', 'EC-5025',
    // Silos legados (modelos SAB)
    'SAB471', 'SAB718', 'SAB965', 'SAB1313', 'SAB1897', 'SAB2481',
    'SAB3065', 'SAB3727', 'SAB4695', 'SAB5663',
    // Variações comuns
    'BNMM130', 'BNMM210', 'BNMM320', 'BNMM440',
    'BNMH 600L', 'BNMH 1000L',
    'BNCH160', 'BNCH210', 'BNCH2310',
    'BNHC160',
    'BNPL3T', 'BNPL7T', 'BNPL10T',
  ],

  // Medidas e numeros tipicos (Whisper tende a confundir "210" com "duzentos e dez",
  // "5 metros" com "cinco metros" — queremos numerico)
  medidas_diametro_mm: [160, 210, 250, 300],
  medidas_comprimento_m: [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10, 12, 15],
  capacidades_kg_h: [75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000,
                     4000, 5000, 6000, 7500, 10000],
  capacidades_ton: [3.1, 4.7, 6.3, 8.5, 12.3, 16.1, 19.9, 24.2, 28, 35.2, 42.5,
                   196.5, 249.8, 298.5, 368.3, 333.8, 474.8, 961.5, 1008.8, 1388.3,
                   1415.3, 1972.5, 1992.8],
  capacidades_litros: [200, 300, 600, 900, 1000, 1500, 1900, 2000, 3000, 4000,
                       5000, 6000, 7000, 8000],
  potencias_cv: [0.75, 1, 1.5, 2, 3, 4, 5, 5.5, 7.5, 10, 12.5, 15, 20, 25, 30,
                 40, 50, 60, 75, 100],

  // Configuracoes Compacta (skill seção 6) — nomenclatura "moinho-misturador"
  configuracoes_compacta: [
    '75300', '75500', '100300', '100500', '1001000',
    '150500', '1501000', '200500', '2001000',
    '5001000', '5002000-8000-8000', '300500-6000-6000',
  ],

  // Termos de motor (skill seção 4.3.1)
  motor: [
    'CV', 'cv', 'mono', 'monofásico', 'trifásico', 'trif',
    '2 polos', '4 polos', '6 polos',
    'motor', 'motor incluso', 'motor não incluso', 'sem motor',
    'motorredutor', 'motorredutor incluso',
    'polias e correias', 'acoplamento elástico',
    'motor 3F', 'motor trifásico', 'motor monofásico',
  ],

  // Materiais (skill seção 4.7, 4.8)
  materiais: [
    'aço inox', 'inox', 'INOX 304', 'INOX 316',
    'aço carbono', 'aço galvanizado', 'galvanizado',
    'chapa', 'chapa 14', 'chapa 16', 'chapa 18',
    'chapa nº 14', 'chapa nº 16', 'chapa nº 18',
    'cantoneira', 'estrutura em cantoneira',
  ],

  // Acoes do copiloto e termos comerciais
  acoes: [
    'orçamento', 'proposta', 'proposta comercial',
    'gerar PDF', 'mandar no WhatsApp', 'envia', 'manda',
    'adiciona', 'remove', 'troca', 'aumenta', 'diminui',
    'salva', 'finaliza', 'fecha o orçamento',
    'frete', 'prazo de entrega', 'forma de pagamento',
    'FINAME', 'financiamento', 'BNDES', 'Moderagro',
    'CNPJ', 'CPF', 'I.E.', 'inscrição estadual',
  ],

  // Subcategorias técnicas importantes
  subcategorias: [
    'peneira 3mm', 'peneira 3,0mm', 'peneira 5mm',
    'tempo de mistura', '8 min', 'batelada',
    'densidade ração', '0,65', 'densidade grão', '0,75',
    'milho', 'soja', 'farelo', 'premix', 'quirela',
  ],

  // Confusoes comuns conhecidas (erro → certo)
  // Expandido com base em padrões de erro do gpt-4o-mini-transcribe
  confusoes_conhecidas: [
    // Chupim
    { errado: 'chumbim', certo: 'chupim' },
    { errado: 'chumbinho', certo: 'chupim' },
    { errado: 'cubim', certo: 'chupim' },
    { errado: 'tupim', certo: 'chupim' },
    { errado: 'supim', certo: 'chupim' },
    // BNMM e códigos BN
    { errado: 'B&M', certo: 'BNMM' },
    { errado: 'BM&M', certo: 'BNMM' },
    { errado: 'BMM', certo: 'BNMM' },
    { errado: 'bê eme eme', certo: 'BNMM' },
    { errado: 'bilim', certo: 'BNMM' },
    { errado: 'B&N M', certo: 'BNMM' },
    { errado: 'misturador BMH', certo: 'misturador BNMH' },
    { errado: 'misturador BMV', certo: 'misturador BNMV' },
    { errado: 'BNCX', certo: 'BNCX' },
    { errado: 'BNPL', certo: 'BNPL' },
    // Compactas (numeração)
    { errado: 'compacta um', certo: 'Compacta 01' },
    { errado: 'compacta zero um', certo: 'Compacta 01' },
    { errado: 'compacta dois', certo: 'Compacta 02' },
    { errado: 'compacta zero dois', certo: 'Compacta 02' },
    { errado: 'compacta três', certo: 'Compacta 03' },
    { errado: 'compacta zero três', certo: 'Compacta 03' },
    { errado: 'Compacta 1', certo: 'Compacta 01' },
    { errado: 'Compacta 2', certo: 'Compacta 02' },
    { errado: 'Compacta 3', certo: 'Compacta 03' },
    // Master e JR
    { errado: 'compacta master', certo: 'Compacta Master' },
    { errado: 'master júnior', certo: 'Master JR' },
    { errado: 'master junior', certo: 'Master JR' },
    { errado: 'mini fabrica', certo: 'Mini Fábrica' },
    { errado: 'mini-fábrica', certo: 'Mini Fábrica' },
    // Transportador / TH
    { errado: 'th', certo: 'TH' },
    { errado: 'tê agá', certo: 'TH' },
    { errado: 'rosca elicoidal', certo: 'rosca helicoidal' },
    { errado: 'transportadora elicoidal', certo: 'transportador helicoidal' },
    { errado: 'transportador elicoidal', certo: 'transportador helicoidal' },
    { errado: 'elicoide', certo: 'helicóide' },
    { errado: 'elicoidal', certo: 'helicoidal' },
    // Elevador
    { errado: 'eletor de canecas', certo: 'elevador de canecas' },
    { errado: 'elevator de canecas', certo: 'elevador de canecas' },
    { errado: 'elevador de canequas', certo: 'elevador de canecas' },
    { errado: 'EC 2310', certo: 'EC-2310' },
    { errado: 'EC 4012', certo: 'EC-4012' },
    { errado: 'EC 5014', certo: 'EC-5014' },
    // Pré-limpeza
    { errado: 'pre limpeza', certo: 'pré-limpeza' },
    { errado: 'pré limpeza', certo: 'pré-limpeza' },
    { errado: 'pre-limpeza', certo: 'pré-limpeza' },
    // Caçamba
    { errado: 'cacamba', certo: 'caçamba' },
    { errado: 'casamba', certo: 'caçamba' },
    { errado: 'casanga', certo: 'caçamba' },
    { errado: 'casamga', certo: 'caçamba' },
    { errado: 'cassamba', certo: 'caçamba' },
    // Big Bag
    { errado: 'big back', certo: 'big bag' },
    { errado: 'big bagg', certo: 'big bag' },
    { errado: 'bigue bague', certo: 'big bag' },
    { errado: 'bigi bague', certo: 'big bag' },
    // Helicoide vs Helicoidal
    { errado: 'helicoide', certo: 'helicóide' },
    { errado: 'rosca cem fim', certo: 'rosca sem fim' },
    // Biomart
    { errado: 'biomart', certo: 'Biomart' },
    { errado: 'bio mart', certo: 'Biomart' },
    { errado: 'bio marte', certo: 'Biomart' },
    { errado: 'inox trezentos e quatro', certo: 'INOX 304' },
    { errado: 'inox 304', certo: 'INOX 304' },
    { errado: 'inox 316', certo: 'INOX 316' },
    { errado: 'grajador', certo: 'grajador' },
    { errado: 'misturador granjador', certo: 'misturador grajador' },
    { errado: 'skyp', certo: 'Skyp' },
    { errado: 'eskypi', certo: 'Skyp' },
    { errado: 'eskype', certo: 'Skyp' },
    // Aglutinador / Ciclone / Talha
    { errado: 'a glutinador', certo: 'aglutinador' },
    { errado: 'aglutinator', certo: 'aglutinador' },
    { errado: 'siclone', certo: 'ciclone' },
    { errado: 'ciclonne', certo: 'ciclone' },
    { errado: 'talha elétrica', certo: 'talha elétrica' },
    { errado: 'talha eletrica', certo: 'talha elétrica' },
    { errado: 'troley', certo: 'trolley' },
    { errado: 'troli', certo: 'trolley' },
    // Quirela / outros
    { errado: 'cirela', certo: 'quirela' },
    { errado: 'kirela', certo: 'quirela' },
    { errado: 'kerela', certo: 'quirela' },
    // Motor / acionamento
    { errado: 'C V', certo: 'CV' },
    { errado: 'cê vê', certo: 'CV' },
    { errado: 'monofásico', certo: 'monofásico' },
    { errado: 'mono fásico', certo: 'monofásico' },
    { errado: 'trifásico', certo: 'trifásico' },
    { errado: 'tri fásico', certo: 'trifásico' },
    { errado: 'motor redutor', certo: 'motorredutor' },
    { errado: 'motoredutor', certo: 'motorredutor' },
    { errado: 'polos', certo: 'polos' },
    { errado: 'pólos', certo: 'polos' },
    // Misturador (variações comuns)
    { errado: 'misturador vert', certo: 'misturador vertical' },
    { errado: 'misturador horiz', certo: 'misturador horizontal' },
    { errado: 'misturador com pulmão', certo: 'misturador horizontal com pulmão' },
    { errado: 'misturador sem pulmão', certo: 'misturador horizontal sem pulmão' },
    // Caixa
    { errado: 'caixa de picado', certo: 'caixa de picados' },
    { errado: 'caixa de recepção', certo: 'caixa de recepção' },
    { errado: 'caixa de materia prima', certo: 'caixa de matéria-prima' },
    { errado: 'caixa milho soja', certo: 'caixa de milho/soja' },
    // FINAME
    { errado: 'finami', certo: 'FINAME' },
    { errado: 'finam', certo: 'FINAME' },
    { errado: 'fhname', certo: 'FINAME' },
    // Silo
    { errado: 'silo metalico', certo: 'silo metálico' },
    { errado: 'silos metalicos', certo: 'silos metálicos' },
    { errado: 'silo de raçao', certo: 'silo de ração' },
    // Ensacadeira
    { errado: 'in sacadeira', certo: 'ensacadeira' },
    { errado: 'ensacaderia', certo: 'ensacadeira' },
    { errado: 'saco valvulado', certo: 'saco valvulado' },
    // Moega
    { errado: 'moega', certo: 'moega' },
    { errado: 'mojega', certo: 'moega' },
    { errado: 'BNM 3x1', certo: 'BNM3X1' },
    // Peneira (granulometria)
    { errado: 'peneira 3 mm', certo: 'peneira 3 mm' },
    { errado: 'peneira três', certo: 'peneira 3 mm' },
    { errado: 'peneira três milímetros', certo: 'peneira 3 mm' },
    // Acoplamento
    { errado: 'acoplamento elastico', certo: 'acoplamento elástico' },
    // Painel
    { errado: 'painel eletrico', certo: 'painel elétrico' },
    { errado: 'quadro eletrico', certo: 'quadro elétrico' },
    // Sigla 3F
    { errado: 'motor três F', certo: 'motor 3F' },
    { errado: 'motor três efe', certo: 'motor 3F' },
  ],
};

/**
 * Monta o system prompt do pos-processador de transcricao.
 * Inclui o glossario + instrucoes restritivas para evitar alucinacao.
 */
export function buildCorrecaoPrompt(): string {
  const v = BRANORTE_VOCAB;
  return `Você é um corretor ortográfico ESPECIALIZADO em transcrições de áudio de orçamentos da metalúrgica Branorte (Grão Pará/SC), fabricante de equipamentos para fábrica de ração.

REGRA #1 (CRÍTICA): Corrija APENAS palavras manifestamente erradas comparando com o glossário abaixo. NÃO reescreva, NÃO reformule, NÃO mude ordem das frases, NÃO traduza. Preserve TUDO que não estiver claramente errado.

REGRA #2: Se em dúvida sobre uma correção, MANTENHA O ORIGINAL. É melhor deixar um erro do que inventar uma palavra errada.

REGRA #3: Mantenha os números como vieram (210, 5 metros, 40 toneladas, 100 CV). Só converta extenso pra dígito se for óbvio (ex: "cento e sessenta por cinco metros" → "160 por 5 metros", "trinta toneladas" → "30 toneladas").

REGRA #4: Mantenha pontuação e capitalização naturais do texto. Não force letras maiúsculas exceto para códigos técnicos (BNMM, TH, EC-2310, INOX 304, FINAME, BNCH, BNHC, BNCX, BNPL, BNSP, etc.).

REGRA #5: Para fábricas Compactas use SEMPRE 2 dígitos no número: "Compacta 01" (não "Compacta 1"), "Compacta 02", "Compacta 03". Aceite variantes Master e JR.

GLOSSÁRIO BRANORTE — termos canônicos que devem aparecer corretos:

EQUIPAMENTOS PRINCIPAIS (ordenados por frequência de uso):
${v.equipamentos.join(', ')}.

CÓDIGOS TÉCNICOS (sempre maiúsculo, com hífen quando aplicável):
${v.codigos.join(', ')}.

CONFIGURAÇÕES COMPACTA (formato {moinho_kgh}{misturador_kg}):
${v.configuracoes_compacta.join(', ')}.

MEDIDAS COMUNS:
- Diâmetros (mm): ${v.medidas_diametro_mm.join(', ')}
- Comprimentos (m): ${v.medidas_comprimento_m.join(', ')}
- Capacidades moinho (kg/h): ${v.capacidades_kg_h.join(', ')}
- Capacidades silo (toneladas): ${v.capacidades_ton.slice(0, 15).join(', ')}...
- Capacidades misturador (litros): ${v.capacidades_litros.join(', ')}
- Potências (CV): ${v.potencias_cv.join(', ')}

MOTOR E ACIONAMENTO:
${v.motor.join(', ')}.

MATERIAIS:
${v.materiais.join(', ')}.

SUBCATEGORIAS TÉCNICAS:
${v.subcategorias.join(', ')}.

AÇÕES DO USUÁRIO E TERMOS COMERCIAIS:
${v.acoes.join(', ')}.

CONFUSÕES CONHECIDAS (corrija sempre que aparecer esse erro):
${v.confusoes_conhecidas.map(c => `- "${c.errado}" → "${c.certo}"`).join('\n')}

FORMATO DE SAÍDA: retorne APENAS o texto corrigido, sem aspas, sem explicação, sem markdown, sem prefixo. Se nada precisar ser corrigido, retorne o texto original idêntico.

EXEMPLOS:

Input: "Quero um chumbim de 210 por 5 metros mais um misturador BMH"
Output: Quero um chupim de 210 por 5 metros mais um misturador BNMH

Input: "Compacta dois com moinho B&M e casamba de pesagem"
Output: Compacta 02 com moinho BNMM e caçamba de pesagem

Input: "Quero uma Compacta 1 master com mini fabrica e silos metalicos de 40 toneladas"
Output: Quero uma Compacta 01 Master com Mini Fábrica e silos metálicos de 40 toneladas

Input: "Adiciona um th de 160 por 3 metros e um eletor de canecas EC 4012"
Output: Adiciona um TH de 160 por 3 metros e um elevador de canecas EC-4012

Input: "Linha biomart com inox trezentos e quatro, misturador granjador e eskypi"
Output: Linha Biomart com INOX 304, misturador grajador e Skyp

Input: "manda no whatsapp do cliente"
Output: manda no whatsapp do cliente`;
}
