// Gera o conteudo do CONTRATO DE COMPRA E VENDA DE EQUIPAMENTOS INDUSTRIAIS COM
// RESERVA DE DOMINIO como uma lista de blocos, a partir dos dados do orcamento.
//
// Base juridica: modelo unico v2 (fusao do contrato JELMAX 27/07/2026 com o
// "Modelo de Contrato" antigo da casa), com os ajustes decididos em 22/09/2026:
// 3 tipos de comprador (PJ / produtor rural / PF), NR-12 por conta do cliente,
// sem start-up, retomada em 5 dias, entrega em lotes, negativacao expressa e
// FINAME.
//
// Quem renderiza: contrato-docx.ts (Word) e contrato-html.ts (PDF via Chrome).

import type { ContratoDados } from './contrato-dados'
import { formatBRL, valorPorExtenso, numeroPorExtenso, dataPorExtenso } from './extenso'

export type Alinhamento = 'left' | 'center' | 'right'

export interface CelulaBloco {
  txt: string
  align?: Alinhamento
  bold?: boolean
  /** largura relativa (0-100) — o renderizador distribui proporcionalmente */
  larg?: number
}

export type Bloco =
  | { k: 'titulo'; txt: string; ultimo?: boolean }
  | { k: 'clausula'; txt: string }
  | { k: 'p'; txt: string; bold?: boolean; center?: boolean; indent?: number; spaceBefore?: boolean }
  | { k: 'tabela'; head: CelulaBloco[]; linhas: CelulaBloco[][] }
  | { k: 'assinatura'; nome: string; doc: string }

// ── construtores ────────────────────────────────────────────────────────────

function p(
  text: string,
  opts: { bold?: boolean; center?: boolean; size?: number; indent?: number; spaceAfter?: number } = {},
): Bloco {
  return {
    k: 'p',
    txt: text,
    bold: opts.bold,
    center: opts.center,
    // o docx usava twips (340 = ~0,6cm); aqui vira "um nivel de recuo"
    indent: opts.indent ? 1 : undefined,
  }
}

function clausula(titulo: string): Bloco {
  return { k: 'clausula', txt: titulo }
}

function assinatura(linha1: string, linha2: string): Bloco[] {
  return [{ k: 'assinatura', nome: linha1, doc: linha2 }]
}

const VENDEDORA_TXT =
  'VENDEDORA: METALÚRGICA BBA LTDA. (nome fantasia BRANORTE), pessoa jurídica de direito privado, ' +
  'inscrita no CNPJ sob o nº 16.935.999/0001-09, com Inscrição Estadual nº 256.847.320, com sede na ' +
  'Rodovia SC 370, km 139, nº 1.390, bairro Rio Pequeno, Município de Grão-Pará/SC, CEP 88.890-000, ' +
  'telefone (48) 3658-4502, e-mail contato@mbranorte.com.br, neste ato representada na forma de seu ' +
  'contrato social por seu sócio administrador PATRICK ALVES DA SILVA, brasileiro, casado, empresário, ' +
  'inscrito no CPF sob o nº 105.160.259-96, residente e domiciliado na Rua João Effting, nº 765, bairro ' +
  'São Basílio, Município de Braço do Norte/SC, CEP 88.750-000, doravante denominada parte VENDEDORA.'

function vazio(v: string, placeholder: string): string {
  const t = (v || '').trim()
  return t || `[${placeholder}]`
}

function qualificacaoComprador(d: ContratoDados): string {
  const c = d.comprador
  const rep = c.representante
  const cidadeUf = [c.cidade, c.uf].filter(Boolean).join('/')

  const pessoais = [
    vazio(rep.nacionalidade, 'NACIONALIDADE'),
    vazio(rep.estadoCivil, 'ESTADO CIVIL'),
    vazio(rep.profissao, 'PROFISSÃO'),
  ].join(', ')

  // RG, nascimento e filiacao sao OPCIONAIS: entram so quando preenchidos. Deixar
  // "[RG]" no meio da qualificacao suja um documento que ja e' valido sem eles.
  const docPessoal = [
    `inscrito no CPF sob o nº ${vazio(rep.cpf, 'CPF')}`,
    rep.rg.trim() ? `portador do RG nº ${rep.rg.trim()}` : '',
    rep.nascimento.trim() ? `nascido em ${rep.nascimento.trim()}` : '',
    rep.mae.trim() ? `filho de ${rep.mae.trim()}` : '',
  ].filter(Boolean).join(', ')

  if (c.tipoPessoa === 'pj') {
    return (
      `COMPRADORA: ${vazio(c.nome, 'RAZÃO SOCIAL')}, pessoa jurídica de direito privado, inscrita no ` +
      `CNPJ sob o nº ${vazio(c.cnpj, 'CNPJ')}, com Inscrição Estadual nº ${vazio(c.ie, 'INSCRIÇÃO ESTADUAL')}, ` +
      `com sede na ${vazio(c.endereco, 'ENDEREÇO')}, Município de ${vazio(cidadeUf, 'CIDADE/UF')}, ` +
      `CEP ${vazio(c.cep, 'CEP')}, telefone ${vazio(c.telefone, 'TELEFONE')}, e-mail ${vazio(c.email, 'E-MAIL')}, ` +
      `neste instrumento representada na forma de seu contrato social por seu sócio administrador ` +
      `${vazio(rep.nome, 'NOME DO REPRESENTANTE')}, ${pessoais}, ${docPessoal}, doravante denominada parte COMPRADORA.`
    )
  }

  if (c.tipoPessoa === 'produtor_rural') {
    return (
      `COMPRADOR: ${vazio(c.nome, 'NOME COMPLETO')}, ${vazio(rep.nacionalidade, 'NACIONALIDADE')}, ` +
      `${vazio(rep.estadoCivil, 'ESTADO CIVIL')}, produtor rural, ${docPessoal}, inscrito no Cadastro de ` +
      `Produtor Rural / Inscrição Estadual sob o nº ${vazio(c.ie, 'INSCRIÇÃO DE PRODUTOR')}, ` +
      (c.propriedadeNome ? `com estabelecimento rural denominado ${c.propriedadeNome}, ` : '') +
      `situado em ${vazio(c.propriedadeEndereco || c.endereco, 'ENDEREÇO DA PROPRIEDADE')}, ` +
      `Município de ${vazio(cidadeUf, 'CIDADE/UF')}, CEP ${vazio(c.cep, 'CEP')}, telefone ` +
      `${vazio(c.telefone, 'TELEFONE')}, e-mail ${vazio(c.email, 'E-MAIL')}, doravante denominado parte COMPRADORA.`
    )
  }

  return (
    `COMPRADOR: ${vazio(c.nome, 'NOME COMPLETO')}, ${pessoais}, ${docPessoal}, residente e domiciliado na ` +
    `${vazio(c.endereco, 'ENDEREÇO')}, Município de ${vazio(cidadeUf, 'CIDADE/UF')}, CEP ${vazio(c.cep, 'CEP')}, ` +
    `telefone ${vazio(c.telefone, 'TELEFONE')}, e-mail ${vazio(c.email, 'E-MAIL')}, doravante denominado parte COMPRADORA.`
  )
}

function qualificacaoGarantidor(d: ContratoDados): string {
  const g = d.garantidor
  // Garantidor = proprio comprador: repetir a qualificacao inteira polui o
  // preambulo e ainda arrisca divergir dos dados de cima se alguem editar um lado.
  if (g.mesmoQueComprador) {
    return (
      'GARANTIDOR: o próprio COMPRADOR, acima qualificado, que assina este instrumento também na ' +
      'qualidade de devedor solidário de todas as obrigações nele assumidas, respondendo com seu ' +
      'patrimônio pessoal, sem benefício de ordem.'
    )
  }
  const doc = [
    `inscrito no CPF sob o nº ${vazio(g.cpf, 'CPF')}`,
    g.rg.trim() ? `portador do RG nº ${g.rg.trim()}` : '',
    g.nascimento.trim() ? `nascido em ${g.nascimento.trim()}` : '',
    g.mae.trim() ? `filho de ${g.mae.trim()}` : '',
  ].filter(Boolean).join(', ')
  return (
    `GARANTIDOR: ${vazio(g.nome, 'NOME DO GARANTIDOR')}, ${vazio(g.nacionalidade, 'NACIONALIDADE')}, ` +
    `${vazio(g.estadoCivil, 'ESTADO CIVIL')}, ${vazio(g.profissao, 'PROFISSÃO')}, ${doc}, residente e ` +
    `domiciliado na ${vazio(g.endereco, 'ENDEREÇO COMPLETO')}, Município de ${vazio(g.cidadeUf, 'CIDADE/UF')}, ` +
    `CEP ${vazio(g.cep, 'CEP')}, que assina o presente instrumento na qualidade de devedor solidário de ` +
    `todas as obrigações assumidas pela COMPRADORA.`
  )
}


// ── tabelas ──────────────────────────────────────────────────────────────────

function tabelaItens(d: ContratoDados): Bloco {
  return {
    k: 'tabela',
    head: [
      { txt: 'Item', align: 'center', bold: true, larg: 7 },
      { txt: 'Descrição do equipamento / modelo / acionamentos inclusos', bold: true, larg: 60 },
      { txt: 'Qtd.', align: 'center', bold: true, larg: 8 },
      { txt: 'Valor (R$)', align: 'right', bold: true, larg: 25 },
    ],
    linhas: [
      ...d.itens.map(it => ([
        { txt: it.letra, align: 'center' as Alinhamento },
        { txt: it.descricao },
        { txt: String(it.qtd), align: 'center' as Alinhamento },
        { txt: it.rotulo ?? formatBRL(it.valorLinha), align: 'right' as Alinhamento },
      ])),
      [
        { txt: 'VALOR TOTAL', bold: true },
        { txt: '' },
        { txt: '' },
        { txt: formatBRL(d.valorTotal), align: 'right' as Alinhamento, bold: true },
      ],
    ],
  }
}

function tabelaParcelas(d: ContratoDados): Bloco {
  // A coluna Forma so aparece quando ha forma preenchida: quadro com uma coluna
  // vazia inteira passa a impressao de contrato mal preenchido.
  const comForma = d.parcelas.some(pc => pc.metodo.trim())
  const head: CelulaBloco[] = [
    { txt: 'Parcela', align: 'center', bold: true, larg: 18 },
    { txt: 'Vencimento', align: 'center', bold: true, larg: 30 },
    { txt: 'Valor (R$)', align: 'right', bold: true, larg: 30 },
  ]
  if (comForma) head.push({ txt: 'Forma', align: 'center', bold: true, larg: 22 })

  return {
    k: 'tabela',
    head,
    linhas: d.parcelas.map(pc => {
      const cols: CelulaBloco[] = [
        { txt: pc.numero, align: 'center' },
        { txt: pc.vencimento || '—', align: 'center' },
        { txt: formatBRL(pc.valor), align: 'right' },
      ]
      if (comForma) cols.push({ txt: pc.metodo || '—', align: 'center' })
      return cols
    }),
  }
}

/** Nome do arquivo: CONTRATO - CLIENTE - ORC 2026-1826.docx */
export function nomeArquivoContrato(d: ContratoDados, ext: 'docx' | 'pdf'): string {
  const cliente = (d.comprador.nome || 'CLIENTE').toUpperCase().replace(/[\\/:*?"<>|]/g, '').trim()
  const num = (d.orcamentoNumero || '').replace(/\s/g, '')
  return `CONTRATO - ${cliente} - ORC ${num}.${ext}`
}

/**
 * Conteudo do contrato como ESTRUTURA — uma fonte so pra Word e PDF.
 *
 * Antes o texto das 17 clausulas morava dentro do gerador de .docx e o PDF saia
 * por outro caminho (ConvertAPI). No dia em que aquele servico caiu, nao havia
 * como gerar PDF sem reescrever o contrato inteiro num segundo lugar — e texto
 * juridico duplicado em dois geradores diverge sozinho na primeira correcao.
 */
export function montarBlocosContrato(d: ContratoDados): Bloco[] {
  const b: Bloco[] = []
  const c = d.comprador
  const temParcelas = d.parcelas.length > 0
  const cidadeUfComprador = [c.cidade, c.uf].filter(Boolean).join('/')

  // título
  b.push({ k: 'titulo', txt: 'CONTRATO DE COMPRA E VENDA DE EQUIPAMENTOS INDUSTRIAIS' })
  b.push({ k: 'titulo', txt: 'COM RESERVA DE DOMÍNIO', ultimo: true })

  // partes
  b.push(p(VENDEDORA_TXT))
  b.push(p(qualificacaoComprador(d)))
  if (d.garantidor.incluir) b.push(p(qualificacaoGarantidor(d)))

  b.push(p(
    'As partes acima qualificadas, considerando que: (i) a COMPRADORA aceitou integralmente a proposta ' +
    `comercial consubstanciada no Orçamento nº ${d.orcamentoNumero}, emitido pela VENDEDORA em ` +
    `${d.orcamentoData}, que passa a integrar este contrato como Anexo I; (ii) os equipamentos serão ` +
    'fabricados sob encomenda, conforme todas as especificações técnicas constantes do referido ' +
    'orçamento; e (iii) havendo saldo do preço a ser pago após a entrega dos bens, justifica-se a adoção ' +
    'do pacto de reserva de domínio, resolvem celebrar este CONTRATO DE COMPRA E VENDA DE EQUIPAMENTOS ' +
    'INDUSTRIAIS COM RESERVA DE DOMÍNIO, que se regerá pelas cláusulas e condições seguintes.'))

  // ── 1 OBJETO ──
  b.push(clausula('CLÁUSULA PRIMEIRA – DO OBJETO'))
  b.push(p(
    '1.1. O presente contrato tem por objeto a fabricação sob encomenda e a compra e venda, com reserva ' +
    'de domínio em favor da VENDEDORA, dos equipamentos industriais abaixo relacionados, conforme as ' +
    `especificações técnicas detalhadas no Orçamento nº ${d.orcamentoNumero} (Anexo I):`))
  b.push(tabelaItens(d))
  b.push(p('', { spaceAfter: 120 }))
  b.push(p(
    '1.2. Por ocasião da entrega, a nota fiscal de venda, contendo a descrição individualizada dos ' +
    'equipamentos e os seus respectivos números de série, passará a integrar este contrato como Anexo II, ' +
    'para fins de perfeita caracterização e individualização dos bens, na forma do art. 523 do Código Civil.'))
  b.push(p(
    '1.3. Os equipamentos destinam-se à instalação e permanência no estabelecimento da COMPRADORA situado ' +
    `em ${vazio(d.localInstalacao, 'ENDEREÇO DE INSTALAÇÃO')}, vedada sua remoção sem prévia anuência ` +
    'escrita da VENDEDORA, nos termos da Cláusula Sétima.'))
  b.push(p(
    `1.4. A VENDEDORA declara que os equipamentos descritos no item 1.1 possuem a capacidade nominal ` +
    `indicada no Orçamento nº ${d.orcamentoNumero}, desde que operados dentro das condições de projeto, ` +
    'notadamente com o material de processo previsto na proposta e dentro das faixas de umidade, ' +
    'granulometria, densidade, abrasividade, temperatura e isenção de corpos estranhos ali consideradas, ' +
    'com alimentação elétrica estável e com operação por pessoal treinado. A capacidade declarada é ' +
    'nominal e não se aplica a matéria-prima, produto ou regime de trabalho diversos dos considerados na ' +
    'proposta.'))
  b.push(p(
    '1.5. A COMPRADORA declara que adquire os equipamentos como BEM DE PRODUÇÃO, destinado ao emprego ' +
    'direto na sua atividade econômica industrial, agroindustrial ou rural, integrando-os ao seu processo ' +
    'produtivo, e não como destinatária final. As partes reconhecem, em consequência, que esta contratação ' +
    'é regida pelo Código Civil e pela legislação empresarial aplicável, não configurando relação de consumo.'))
  b.push(p(
    '1.6. Os desenhos, projetos, memórias de cálculo, dimensionamentos, layouts, instruções técnicas e demais ' +
    'documentos técnicos fornecidos pela VENDEDORA permanecem de sua propriedade intelectual exclusiva, ' +
    'sendo cedidos à COMPRADORA em caráter não exclusivo e apenas para a instalação, operação e ' +
    'manutenção dos equipamentos objeto deste contrato. É vedada à COMPRADORA a reprodução, a cópia, a ' +
    'cessão a terceiros, a engenharia reversa e a utilização para a fabricação de equipamentos ' +
    'semelhantes, próprios ou de terceiros, sob pena de multa equivalente a 100% (cem por cento) do preço ' +
    'total previsto no item 2.1, sem prejuízo das perdas e danos que a excederem e das medidas judiciais ' +
    'cabíveis.'))

  // ── 2 PRECO ──
  b.push(clausula('CLÁUSULA SEGUNDA – DO PREÇO E DA FORMA DE PAGAMENTO'))
  b.push(p(
    `2.1. O preço total, certo e ajustado da presente compra e venda é de ${formatBRL(d.valorTotal)} ` +
    `(${valorPorExtenso(d.valorTotal)}).`))

  if (d.entrada || temParcelas) {
    b.push(p('2.2. O preço ajustado será pago da seguinte forma:'))
    if (d.entrada) {
      b.push(p(
        `a) entrada / sinal de ${formatBRL(d.entrada.valor)} (${valorPorExtenso(d.entrada.valor)}), com ` +
        `vencimento em ${d.entrada.vencimento || '[DATA]'}` +
        `${d.entrada.metodo.trim() ? `, mediante ${d.entrada.metodo.trim()}` : ''}; e`, { indent: 340 }))
    }
    if (temParcelas) {
      const somaParcelas = d.parcelas.reduce((s, x) => s + x.valor, 0)
      b.push(p(
        `${d.entrada ? 'b) o saldo de' : 'a)'} ${formatBRL(somaParcelas)} (${valorPorExtenso(somaParcelas)}) ` +
        `em ${d.parcelas.length} (${numeroPorExtenso(d.parcelas.length)}) parcelas sucessivas, ` +
        (d.parcelas.some(pc => pc.metodo.trim())
          ? 'nos valores, vencimentos e formas de pagamento do quadro abaixo:'
          : 'mediante boletos bancários emitidos pela VENDEDORA, nos valores e vencimentos do quadro abaixo:'),
        { indent: 340 }))
      b.push(tabelaParcelas(d))
      b.push(p('', { spaceAfter: 120 }))
    }
  } else if (d.formaPagamentoTexto) {
    // O orcamento tem a condicao escrita a mao e o quadro nao pode ser lido com
    // seguranca: leva o texto do vendedor, PALAVRA POR PALAVRA. Mentir que e' a
    // vista aqui desligaria a reserva de dominio numa venda parcelada.
    b.push(p(
      '2.2. O preço ajustado será pago conforme a condição comercial acordada entre as partes e ' +
      'constante do Orçamento nº ' + d.orcamentoNumero + ' (Anexo I), a saber:'))
    b.push(p(d.formaPagamentoTexto, { indent: 340 }))
    b.push(p(
      '2.2.1. Os pagamentos serão representados por boletos bancários emitidos pela VENDEDORA ou pelo ' +
      'meio indicado acima, permanecendo a reserva de domínio da Cláusula Terceira em vigor até a ' +
      'quitação integral do preço.'))
  } else {
    b.push(p(
      `2.2. O preço ajustado será pago integralmente, de forma antecipada, até a data da entrega dos ` +
      'equipamentos, aplicando-se o disposto no item 3.7.'))
  }

  b.push(p(
    '2.3. Recaindo o vencimento de qualquer parcela em dia não útil, fica automaticamente prorrogado para ' +
    'o primeiro dia útil subsequente, sem quaisquer acréscimos.'))

  if (temParcelas) {
    b.push(p(
      `2.4. Em representação das parcelas, a COMPRADORA emitirá e entregará à VENDEDORA, no ato da ` +
      `assinatura do contrato, ${d.parcelas.length} (${numeroPorExtenso(d.parcelas.length)}) notas ` +
      'promissórias vinculadas a este instrumento, de valores e vencimentos coincidentes com as parcelas ' +
      'descritas no item 2.2, avalizadas pelo GARANTIDOR. A VENDEDORA poderá, ainda, sacar duplicatas ' +
      'mercantis correspondentes à nota fiscal de venda. Os títulos são emitidos “pro solvendo”, de modo ' +
      'que a sua emissão, circulação ou eventual protesto não importa em novação, permanecendo íntegras ' +
      'todas as garantias e condições deste contrato.'))
  }

  b.push(p('2.5. O pagamento antecipado de parcelas é facultado à COMPRADORA a qualquer tempo, sem ônus.'))
  b.push(p(
    '2.6. Os pagamentos serão efetuados por boleto bancário emitido pela VENDEDORA ou, na sua falta, por ' +
    'transferência bancária ou PIX exclusivamente para as contas de titularidade da VENDEDORA abaixo ' +
    'indicadas, somente se considerando quitada a obrigação com o efetivo crédito:'))
  b.push(p('Banco do Brasil – Agência 0738-2 – Conta Corrente 39551-X;', { indent: 340, spaceAfter: 60 }))
  b.push(p('Sicoob Credivale – Banco 756 – Cooperativa 3078 – Conta 109909-4;', { indent: 340, spaceAfter: 60 }))
  b.push(p('PIX (Sicoob) – Chave CNPJ 16.935.999/0001-09.', { indent: 340 }))
  b.push(p(
    '2.6.1. A VENDEDORA não se responsabiliza por pagamentos realizados a terceiros ou em contas diversas ' +
    'das acima indicadas, ainda que informadas por mensagem eletrônica, aplicativo ou boleto não emitido ' +
    'por ela, cabendo à COMPRADORA confirmar os dados pelos canais oficiais antes de qualquer transferência.'))
  b.push(p(
    '2.7. A produção, o faturamento e a liberação dos equipamentos ficam condicionados à aprovação ' +
    'cadastral e creditícia da COMPRADORA e do GARANTIDOR, que declaram estar livres de restrições e ' +
    'autorizam a consulta aos órgãos de proteção ao crédito. Constatada restrição, protesto, execução ou ' +
    'pedido de recuperação judicial antes da entrega, a VENDEDORA poderá suspender a produção e a entrega ' +
    'até a regularização, a prestação de garantia adicional ou a antecipação do saldo, sem que isso ' +
    'caracterize mora de sua parte.'))
  b.push(p(
    '2.8. Os preços consideram as condições vigentes na data da proposta. Caso a entrega seja postergada ' +
    'por prazo superior a 60 (sessenta) dias por fato imputável à COMPRADORA — inclusive por ausência de ' +
    'definição técnica, de local de instalação ou de regularização cadastral —, o saldo não pago será ' +
    'corrigido pela variação do INPC/IBGE no período, sem prejuízo do item 4.5.'))

  // ── 3 RESERVA ──
  b.push(clausula('CLÁUSULA TERCEIRA – DA RESERVA DE DOMÍNIO'))
  b.push(p(
    '3.1. As partes pactuam expressamente que a propriedade dos equipamentos descritos na Cláusula ' +
    'Primeira permanece reservada à VENDEDORA até o pagamento integral do preço, nos termos do art. 521 ' +
    'do Código Civil.'))
  b.push(p(
    '3.2. Com a entrega, transfere-se à COMPRADORA apenas a posse direta e precária dos equipamentos, que ' +
    'deles poderá se utilizar em sua atividade produtiva, permanecendo a VENDEDORA com a posse indireta e ' +
    'o domínio. A transferência da propriedade à COMPRADORA dar-se-á, de pleno direito, no momento em que ' +
    'o preço estiver integralmente pago, na forma do art. 524, primeira parte, do Código Civil.'))
  b.push(p(
    '3.3. Este contrato será levado a registro no Cartório de Registro de Títulos e Documentos da Comarca ' +
    `de ${vazio(d.comarca, 'CIDADE/UF')}, domicílio da COMPRADORA, para plena eficácia da cláusula de ` +
    'reserva de domínio perante terceiros, conforme o art. 522 do Código Civil e o art. 129 da Lei ' +
    'nº 6.015/1973.'))
  // Quem tem o interesse na garantia e' quem registra. Na redacao anterior (herdada
  // do contrato JELMAX) a obrigacao era da COMPRADORA — ou seja, a casa dependia do
  // devedor pra constituir a garantia contra o proprio devedor, e ninguem fiscaliza.
  // O custo continua com ela; o gesto passa pra VENDEDORA.
  b.push(p(
    '3.3.1. O registro será promovido pela VENDEDORA, no prazo de até 15 (quinze) dias contados da ' +
    'assinatura, correndo as despesas e emolumentos por conta da COMPRADORA, que os reembolsará em até ' +
    '10 (dez) dias contados da apresentação do comprovante, ficando a VENDEDORA desde já autorizada a ' +
    'acrescê-los ao saldo devedor na hipótese de não reembolso. A COMPRADORA obriga-se a fornecer os ' +
    'documentos e a praticar os atos que lhe forem solicitados para a efetivação do registro.'))
  b.push(p(
    '3.3.2. Efetivado o registro, a VENDEDORA encaminhará cópia da certidão à COMPRADORA. Caso a ' +
    'COMPRADORA prefira promover o registro por conta própria, deverá comunicá-lo por escrito à ' +
    'VENDEDORA e apresentar-lhe a certidão no prazo do item 3.3.1.'))
  b.push(p(
    '3.4. Quitado integralmente o preço, a VENDEDORA fornecerá termo de quitação no prazo de 10 (dez) dias ' +
    'e promoverá, no mesmo prazo, os atos necessários à averbação da quitação ou baixa do registro, ' +
    'correndo as respectivas despesas por conta da COMPRADORA.'))
  b.push(p(
    '3.5. Enquanto não quitado integralmente o preço, a COMPRADORA obriga-se a manter seguro dos ' +
    'equipamentos contra incêndio, raio, explosão, danos elétricos, vendaval, furto e roubo, em valor não ' +
    'inferior ao saldo devedor, figurando a VENDEDORA como beneficiária da indenização até o limite do seu ' +
    'crédito, com apresentação da apólice em até 30 (trinta) dias contados da entrega e a cada renovação.'))
  b.push(p(
    '3.5.1. Não contratado ou não comprovado o seguro, a VENDEDORA poderá contratá-lo às expensas da ' +
    'COMPRADORA, cobrando-lhe o prêmio acrescido dos encargos deste contrato, ou considerar ' +
    'antecipadamente vencido o saldo devedor, na forma da Cláusula Décima Primeira.'))
  b.push(p(
    '3.6. A indenização securitária eventualmente recebida será imputada ao saldo devedor, entregando-se à ' +
    'COMPRADORA apenas o que exceder o crédito da VENDEDORA e as despesas por esta suportadas.'))
  b.push(p(
    '3.7. Ocorrendo o pagamento integral e antecipado do preço antes da entrega, a reserva de domínio ' +
    'prevista nesta cláusula perde o objeto e a propriedade transfere-se à COMPRADORA com a tradição, ' +
    'permanecendo íntegras as demais cláusulas deste contrato.'))

  // ── 4 ENTREGA ──
  b.push(clausula('CLÁUSULA QUARTA – DA ENTREGA, DO FRETE E DOS RISCOS'))
  const prazoNum = Number(d.prazoEntrega)
  const prazoExt = Number.isFinite(prazoNum) && prazoNum > 0 ? ` (${numeroPorExtenso(prazoNum)})` : ''
  b.push(p(
    `4.1. O prazo de entrega é de ${vazio(d.prazoEntrega, 'NÚMERO')}${prazoExt} dias ${d.prazoTipo}, ` +
    'contados da assinatura do contrato, podendo ser prorrogado por motivo de caso fortuito e/ou força ' +
    'maior, devidamente comunicado à COMPRADORA, pelo período correspondente ao impedimento.'))
  b.push(p(
    '4.1.1. O prazo de entrega somente começa a fluir após a aprovação cadastral prevista no item 2.7, a ' +
    'compensação da entrada prevista no item 2.2, quando houver, e a definição, pela COMPRADORA, de todas ' +
    'as informações técnicas a seu cargo.'))
  b.push(p(
    d.freteFob
      ? '4.2. A venda é realizada na modalidade FOB (free on board), correndo o frete, o transporte, o ' +
        'seguro de transporte e os riscos do deslocamento por conta exclusiva da COMPRADORA, a partir do ' +
        'embarque dos equipamentos no estabelecimento da VENDEDORA, que responde apenas pelo carregamento e ' +
        'acondicionamento.'
      : '4.2. A venda é realizada na modalidade CIF, correndo o frete até o local de entrega por conta da ' +
        'VENDEDORA, permanecendo a cargo da COMPRADORA a descarga, a movimentação no local e o seguro dos ' +
        'bens a partir da chegada.'))
  b.push(p(
    '4.3. Sem prejuízo da reserva de domínio, os riscos de perda, perecimento, deterioração, furto, roubo ' +
    'ou dano dos equipamentos correm por conta da COMPRADORA a partir da entrega, na forma do art. 524 do ' +
    'Código Civil.'))
  b.push(p(
    '4.3.1. A perda ou deterioração dos equipamentos, por qualquer causa, não exonera a COMPRADORA do ' +
    'pagamento integral do preço.'))
  b.push(p(
    '4.4. No ato da entrega será lavrado Termo de Entrega e Recebimento, assinado pelas partes, no qual ' +
    'constarão a data da tradição, o estado dos equipamentos e seus números de série, iniciando-se dali a ' +
    'contagem da garantia técnica prevista na Cláusula Nona.'))
  b.push(p(
    '4.4.1. Eventuais divergências de quantidade, avarias aparentes ou faltas deverão ser registradas no ' +
    'Termo de Entrega e Recebimento e no canhoto do conhecimento de transporte, e comunicadas por escrito ' +
    'à VENDEDORA em até 5 (cinco) dias úteis, sob pena de se presumir o recebimento em perfeitas condições.'))
  b.push(p(
    '4.5. Comunicada a disponibilização dos equipamentos para carregamento, a COMPRADORA deverá retirá-los ' +
    'em até 10 (dez) dias. Decorrido esse prazo sem a retirada por fato a ela imputável, considera-se ' +
    'ocorrida a tradição para todos os efeitos deste contrato, inclusive quanto aos riscos e aos ' +
    'vencimentos da Cláusula Segunda, passando a VENDEDORA a deter os bens em depósito, mediante taxa de ' +
    'armazenagem de 1% (um por cento) ao mês sobre o valor dos equipamentos não retirados, calculada pro ' +
    'rata die.'))
  b.push(p(
    '4.6. A entrega poderá ser realizada de forma parcelada, em lotes, conforme a conclusão da fabricação, ' +
    'emitindo-se nota fiscal e Termo de Entrega e Recebimento próprios para cada lote e contando-se a ' +
    'garantia de cada equipamento a partir da respectiva entrega. A entrega parcelada não altera os ' +
    'vencimentos previstos na Cláusula Segunda.'))

  // ── 5 MONTAGEM ──
  b.push(clausula('CLÁUSULA QUINTA – DA MONTAGEM E DOS SERVIÇOS'))
  b.push(p(
    `5.1. A montagem dos equipamentos ${d.montagemInclusa ? 'ESTÁ' : 'NÃO ESTÁ'} incluída no preço ` +
    `previsto no item 2.1, na exata extensão do que consta do Orçamento nº ${d.orcamentoNumero}, do mesmo ` +
    'modo que o fornecimento do painel elétrico com acionamentos conforme projeto, quando orçado.'))
  b.push(p(
    '5.2. Correm por conta exclusiva da COMPRADORA, não integrando o objeto deste contrato: (a) toda e ' +
    'qualquer obra civil necessária à instalação, inclusive fundações, bases, alvenaria e cobertura; ' +
    '(b) os equipamentos de içamento e movimentação de carga (guindaste, munck ou empilhadeira) e a mão de ' +
    'obra de descarga; (c) a instalação elétrica de alimentação dos equipamentos e do painel, inclusive ' +
    'aterramento, cabeamento e proteções a montante; (d) as adequações do local de instalação; e (e) as ' +
    'despesas de deslocamento, hospedagem e alimentação dos técnicos montadores, quando não previstas ' +
    'expressamente no orçamento.'))
  b.push(p(
    '5.3. A COMPRADORA obriga-se a disponibilizar o local de instalação em condições adequadas ao início ' +
    'da montagem. O atraso na montagem decorrente de pendências do local, de obras civis e/ou de ' +
    'instalações elétricas a cargo da COMPRADORA não caracteriza mora da VENDEDORA nem posterga os ' +
    'vencimentos previstos na Cláusula Segunda.'))
  b.push(p(
    '5.4. Havendo deslocamento de equipe para montagem ou assistência e não sendo possível a execução dos ' +
    'serviços por fato imputável à COMPRADORA, serão por esta reembolsadas as horas paradas, as despesas ' +
    'de deslocamento e de estadia da equipe, bem como o custo de novo deslocamento, conforme a tabela de ' +
    'serviços vigente da VENDEDORA.'))
  b.push(p(
    '5.5. A montagem, quando a cargo da COMPRADORA ou de terceiro por ela contratado, deverá observar ' +
    'rigorosamente os projetos e as instruções técnicas fornecidos, sob pena de perda da garantia prevista na Cláusula ' +
    'Nona quanto aos vícios decorrentes da montagem irregular.'))
  b.push(p(
    '5.6. NÃO INTEGRAM o fornecimento, salvo quando expressamente orçados como item próprio, correndo por ' +
    'conta exclusiva da COMPRADORA: a partida assistida (start-up) e o comissionamento; a regulagem fina ' +
    'de processo; a formulação de produtos ou receitas; a operação assistida; e o treinamento operacional ' +
    'da equipe da COMPRADORA.'))

  // ── 6 NR-12 ──
  b.push(clausula('CLÁUSULA SEXTA – DA SEGURANÇA DAS MÁQUINAS, DA OPERAÇÃO E DO TREINAMENTO'))
  b.push(p(
    '6.1. Os equipamentos são fabricados sob encomenda conforme as especificações do Orçamento (Anexo I) e ' +
    'são fornecidos em sua configuração industrial básica, NÃO INCLUINDO, salvo quando expressamente ' +
    'orçados como item próprio, os dispositivos e sistemas de segurança de que trata a Norma ' +
    'Regulamentadora nº 12 (NR-12), tais como proteções fixas e móveis, intertravamentos, dispositivos de ' +
    'parada de emergência, sensores e cortinas de luz, sinalização de segurança e sistemas de bloqueio.'))
  b.push(p(
    '6.1.1. A COMPRADORA declara ter sido prévia e expressamente informada dessa condição, que foi ' +
    'considerada na formação do preço, e declara conhecer as obrigações que a legislação de segurança e ' +
    'saúde do trabalho lhe impõe na qualidade de empregadora e detentora da posse dos bens.'))
  b.push(p(
    '6.2. São de responsabilidade exclusiva da COMPRADORA, a serem providenciadas ANTES da colocação dos ' +
    'equipamentos em operação: a adequação dos equipamentos e de toda a instalação à NR-12 e às demais ' +
    'normas de segurança e saúde do trabalho; a apreciação de risco; o inventário de máquinas; os ' +
    'procedimentos de trabalho, operação e manutenção; e as demais medidas técnicas e administrativas ' +
    'exigíveis, com a respectiva responsabilidade técnica.'))
  b.push(p(
    '6.3. São igualmente de responsabilidade exclusiva da COMPRADORA: o treinamento e a capacitação dos ' +
    'operadores e dos profissionais de manutenção; o fornecimento e a exigência de uso dos equipamentos de ' +
    'proteção individual; a sinalização e a delimitação das áreas; os procedimentos de bloqueio e ' +
    'etiquetagem durante a manutenção; e a manutenção preventiva dos equipamentos.'))
  b.push(p(
    '6.4. A COMPRADORA obriga-se a operar e a manter os equipamentos conforme as especificações técnicas ' +
    'constantes do Orçamento (Anexo I) e as instruções técnicas fornecidas pela VENDEDORA, que poderão ser ' +
    'solicitadas a qualquer tempo.'))
  b.push(p(
    '6.5. A COMPRADORA responde integralmente por todo e qualquer dano pessoal ou material decorrente da ' +
    'colocação dos equipamentos em operação sem as adequações previstas no item 6.2, da remoção, ' +
    'inutilização ou desativação de proteções e dispositivos de segurança, da operação por pessoal não ' +
    'treinado ou do descumprimento das instruções técnicas e das especificações do equipamento, ' +
    'obrigando-se a manter a VENDEDORA indene e a ressarci-la de ' +
    'quaisquer valores que esta venha a despender a esse título, inclusive em ações regressivas, custas e ' +
    'honorários.'))
  b.push(p(
    '6.6. Mediante orçamento próprio, a VENDEDORA poderá fornecer o conjunto de adequação à NR-12 dos ' +
    'equipamentos objeto deste contrato, o que não está contemplado no preço do item 2.1.'))

  // ── 7 GUARDA ──
  b.push(clausula('CLÁUSULA SÉTIMA – DA GUARDA E CONSERVAÇÃO DOS EQUIPAMENTOS'))
  b.push(p('7.1. Enquanto não quitado integralmente o preço, a COMPRADORA obriga-se a:'))
  for (const t of [
    'a) manter os equipamentos no endereço indicado no item 1.3, vedada sua remoção, total ou parcial, sem prévia e expressa anuência escrita da VENDEDORA;',
    'b) não vender, ceder, locar, emprestar, dar em comodato, empenhar, caucionar e/ou por qualquer forma alienar ou onerar os equipamentos, no todo ou em parte;',
    'c) conservar os equipamentos em perfeito estado, utilizando-os conforme as especificações técnicas e a finalidade a que se destinam, respondendo pela sua guarda na qualidade de depositária;',
    'd) permitir que a VENDEDORA, mediante aviso prévio de 48 (quarenta e oito) horas, inspecione os equipamentos em horário comercial;',
    'e) comunicar à VENDEDORA, no prazo máximo de 48 (quarenta e oito) horas, qualquer penhora, arresto, sequestro, constrição judicial ou administrativa, turbação ou esbulho que recaia ou ameace recair sobre os equipamentos, fazendo constar, perante quem de direito, que os bens são de propriedade da VENDEDORA por força da reserva de domínio;',
    'f) arcar com todos os tributos, taxas e encargos incidentes sobre a posse e o uso dos equipamentos a partir da entrega;',
    'g) manter vigente o seguro previsto no item 3.5;',
    'h) não realizar modificações, adaptações ou acoplações nos equipamentos sem prévia anuência escrita da VENDEDORA, nem remover, adulterar ou encobrir as placas de identificação e os números de série.',
  ]) b.push(p(t, { indent: 340, spaceAfter: 80 }))
  b.push(p(
    '7.2. O descumprimento de qualquer das obrigações desta cláusula autoriza a VENDEDORA a considerar ' +
    'antecipadamente vencida a totalidade do saldo devedor, na forma da Cláusula Décima Primeira.'))

  // ── 8 TRIBUTOS ──
  b.push(clausula('CLÁUSULA OITAVA – DOS TRIBUTOS E DO FINANCIAMENTO'))
  b.push(p(
    '8.1. As condições deste contrato consideram os tributos e taxas vigentes na data da proposta. ' +
    'Quaisquer alterações de tributos municipais, estaduais ou federais que onerem a operação serão ' +
    'repassadas à COMPRADORA e/ou correrão sob sua responsabilidade, incluindo o pagamento, ou a ' +
    'apresentação de documento de exoneração fiscal, da diferença de alíquota de ICMS devida ao Estado de ' +
    'destino, bem como eventuais custos de retenção do transporte em posto fiscal de fronteira.'))
  b.push(p(
    '8.2. Caso a COMPRADORA não seja contribuinte de ICMS, deverá depositar à VENDEDORA, até a data do ' +
    'embarque, o valor correspondente ao diferencial de alíquota de ICMS relativo ao objeto deste ' +
    'contrato, cujo comprovante de recolhimento será encaminhado juntamente com a nota fiscal de venda.'))
  b.push(p(
    '8.3. Correrão à exclusiva conta da VENDEDORA todas as despesas relativas à fabricação dos ' +
    'equipamentos no que tange à mão de obra e aos encargos tributários de qualquer espécie incidentes ' +
    'sobre a produção.'))
  b.push(p(
    '8.4. Sendo a operação objeto de financiamento (FINAME/BNDES, crédito rural ou equivalente): (a) a ' +
    'obtenção do crédito, a apresentação de documentos e o cumprimento das exigências do agente financeiro ' +
    'são de responsabilidade exclusiva da COMPRADORA, e a eventual não aprovação do financiamento não a ' +
    'exonera das obrigações deste contrato nem caracteriza condição resolutiva; (b) creditado à VENDEDORA ' +
    'o valor financiado, esta dará a respectiva quitação e, quitado integralmente o preço, promoverá a ' +
    'baixa da reserva de domínio, de modo a permitir a constituição da garantia exigida pelo agente ' +
    'financeiro; e (c) enquanto não creditado o valor, permanecem íntegras a reserva de domínio e todas as ' +
    'garantias deste contrato.'))

  // ── 9 GARANTIA ──
  b.push(clausula('CLÁUSULA NONA – DA GARANTIA TÉCNICA'))
  b.push(p(
    '9.1. Os equipamentos fornecidos pela VENDEDORA são garantidos, quanto ao seu funcionamento, pelo ' +
    'prazo máximo de 12 (doze) meses contados da data da entrega, comprovada pelo Termo de Entrega e ' +
    'Recebimento, pelo canhoto da nota fiscal ou pelo conhecimento de transporte, desde que armazenados, ' +
    'montados e operados dentro de todas as condições para as quais foram projetados.'))
  b.push(p(
    '9.2. Durante o prazo de garantia serão reparadas ou substituídas, sem custo da peça, as peças que ' +
    'apresentarem defeito de fabricação, correndo por conta da COMPRADORA as despesas de frete das peças, ' +
    'de envio do componente defeituoso à fábrica da VENDEDORA e de deslocamento, estadia e alimentação dos ' +
    'técnicos.'))
  b.push(p(
    '9.3. Ficam excluídos da garantia: canalizações e dispositivos de interligação; peças de desgaste ' +
    'natural, tais como martelos, peneiras, facas, correias, lonas, mancais e rolamentos; componentes ' +
    'fabricados ou montados por terceiros, como motores elétricos, redutores, chaves e quadros de comando ' +
    'elétrico, que contam apenas com a garantia dos respectivos fabricantes; e toda e qualquer obra civil, ' +
    'de responsabilidade da COMPRADORA.'))
  b.push(p(
    '9.4. A garantia não abrange, cessando de pleno direito, os danos decorrentes de: transporte e ' +
    'descarga; montagem realizada por terceiros em desacordo com os projetos e as instruções técnicas ' +
    'fornecidos; operação por pessoal não treinado ou em desacordo com as especificações do equipamento; ' +
    'sobrecarga ou uso de material de processo fora das ' +
    'especificações ou com corpos estranhos; falta de manutenção preventiva; oscilação, ' +
    'subdimensionamento ou ausência de proteção na rede elétrica; uso de peças não originais; e ' +
    'intervenção, reparo ou modificação realizados por terceiros sem autorização escrita da VENDEDORA.'))
  b.push(p(
    '9.5. Expirado o prazo de garantia, a VENDEDORA prestará assistência técnica mediante solicitação e ' +
    'orçamento próprio.'))
  b.push(p(
    '9.6. Eventual discussão sobre vícios, defeitos ou garantia não autoriza a COMPRADORA a suspender ou ' +
    'reter o pagamento das parcelas do preço, nem a compensar valores.'))
  b.push(p(
    '9.7. A responsabilidade da VENDEDORA limita-se à reparação ou substituição das peças defeituosas na ' +
    'forma desta cláusula, não respondendo, em nenhuma hipótese, por lucros cessantes, perda de produção, ' +
    'perda de matéria-prima, danos indiretos ou danos a terceiros.'))

  // ── 10 DESISTENCIA ──
  b.push(clausula('CLÁUSULA DÉCIMA – DA DESISTÊNCIA E DO CANCELAMENTO'))
  b.push(p(
    '10.1. Tratando-se de equipamentos fabricados sob encomenda, a desistência ou o pedido de cancelamento ' +
    'pela COMPRADORA, após a assinatura deste contrato e antes da entrega, sujeitá-la-á ao pagamento de ' +
    'taxa de cancelamento de 20% (vinte por cento) do preço total previsto no item 2.1, destinada a cobrir ' +
    'as perdas decorrentes do cancelamento, incluindo custos de produção, armazenamento e distribuição.'))
  b.push(p(
    '10.2. Estando a fabricação concluída ou em estágio avançado de execução, a VENDEDORA poderá, ' +
    'alternativamente à taxa do item 10.1, exigir o cumprimento total do contrato, com a entrega dos ' +
    'equipamentos e o pagamento do preço na forma ajustada.'))
  b.push(p(
    '10.3. A taxa prevista no item 10.1 constitui cláusula penal compensatória mínima, convencionando as ' +
    'partes, na forma do parágrafo único do art. 416 do Código Civil, a possibilidade de cobrança de ' +
    'indenização suplementar pelos prejuízos que a excederem, competindo à VENDEDORA prová-los.'))
  b.push(p(
    '10.4. Após a entrega dos equipamentos, não caberá desistência, arrependimento ou devolução unilateral ' +
    'pela COMPRADORA, permanecendo devido o preço integral na forma da Cláusula Segunda.'))
  b.push(p(
    '10.5. Os valores já pagos serão imputados, em primeiro lugar, à taxa de cancelamento e às despesas ' +
    'previstas nesta cláusula, devolvendo-se à COMPRADORA apenas o saldo remanescente, se houver, em até ' +
    '30 (trinta) dias.'))

  // ── 11 INADIMPLEMENTO ──
  b.push(clausula('CLÁUSULA DÉCIMA PRIMEIRA – DO INADIMPLEMENTO E DA EXECUÇÃO'))
  b.push(p(
    `11.1. O atraso no pagamento de qualquer parcela sujeitará a COMPRADORA, de pleno direito, à multa ` +
    `moratória de ${d.multaPct}% (${numeroPorExtenso(d.multaPct)} por cento) sobre o valor em atraso, ` +
    'juros de mora de 1% (um por cento) ao mês, calculados pro rata die, e correção monetária pelo ' +
    'INPC/IBGE, desde o vencimento até o efetivo pagamento.'))
  b.push(p(
    '11.2. O inadimplemento de qualquer parcela no respectivo dia, bem como o descumprimento das ' +
    'obrigações da Cláusula Sétima, faculta à VENDEDORA considerar antecipadamente vencida a integralidade ' +
    'do saldo devedor, independentemente de aviso ou interpelação para esse fim, sem prejuízo da ' +
    'constituição em mora prevista no item 11.3 para a execução da cláusula de reserva de domínio.'))
  b.push(p(
    '11.3. Para a execução da cláusula de reserva de domínio, a COMPRADORA será constituída em mora na ' +
    'forma do art. 525 do Código Civil, mediante protesto do título ou interpelação judicial, admitindo-se ' +
    'ainda a notificação extrajudicial promovida por Cartório de Registro de Títulos e Documentos, ' +
    'dirigida ao endereço da COMPRADORA indicado no preâmbulo.'))
  b.push(p(
    '11.4. Constituída a COMPRADORA em mora, poderá a VENDEDORA, à sua escolha, na forma do art. 526 do ' +
    'Código Civil, mover ação de cobrança das prestações vencidas e vincendas e do que mais lhe for ' +
    'devido, ou recuperar a posse dos equipamentos vendidos.'))
  b.push(p(
    '11.5. Optando a VENDEDORA pela retomada, a COMPRADORA obriga-se a entregar os equipamentos no prazo ' +
    'de 5 (cinco) dias contados do recebimento da notificação, na qualidade de depositária, autorizando ' +
    'desde já o ingresso de prepostos da VENDEDORA no local da instalação, em horário comercial, para ' +
    'vistoria, desmontagem e remoção dos bens, correndo tais despesas por conta da COMPRADORA. A recusa ou ' +
    'a criação de embaraços sujeita a COMPRADORA às medidas judiciais cabíveis e ao ressarcimento das ' +
    'despesas daí decorrentes.'))
  b.push(p(
    '11.6. Recebidos os equipamentos, a VENDEDORA realizará vistoria no ato e poderá reter, das prestações ' +
    'pagas, o necessário para cobrir a depreciação dos bens, as despesas realizadas, inclusive de ' +
    'desmontagem, transporte e recondicionamento, e o mais que de direito lhe for devido, na forma do ' +
    'art. 527 do Código Civil.'))
  b.push(p(
    '11.7. A COMPRADORA e o GARANTIDOR responderão, ainda, pelas despesas de cobrança extrajudicial e ' +
    'judicial, incluindo custas, emolumentos de protesto e de notificação e honorários advocatícios, estes ' +
    'fixados, na fase extrajudicial, em 20% (vinte por cento) sobre o valor do débito.'))
  b.push(p(
    '11.8. A COMPRADORA e o GARANTIDOR autorizam expressamente a VENDEDORA a levar a protesto os títulos e ' +
    'o próprio contrato e a inscrever seus nomes nos cadastros de inadimplentes e de proteção ao crédito ' +
    '(SERASA, SPC e congêneres), na forma da lei, ficando a VENDEDORA obrigada a promover a baixa das ' +
    'anotações em até 5 (cinco) dias úteis contados da quitação do débito.'))
  b.push(p(
    '11.9. Estando em mora a COMPRADORA, a VENDEDORA poderá suspender a fabricação, a entrega, a montagem ' +
    'e a assistência técnica, inclusive em garantia, até a purgação da mora, sem que tal suspensão ' +
    'caracterize descumprimento de sua parte ou gere direito a indenização.'))
  b.push(p(
    '11.10. A falência, a recuperação judicial e/ou extrajudicial ou a insolvência da COMPRADORA autoriza ' +
    'a VENDEDORA a exercer os direitos decorrentes da reserva de domínio na forma da legislação aplicável, ' +
    'permanecendo os equipamentos de sua propriedade até a quitação integral do preço.'))

  // ── 12 GARANTIA PESSOAL ──
  if (d.garantidor.incluir) {
    b.push(clausula('CLÁUSULA DÉCIMA SEGUNDA – DA GARANTIA PESSOAL'))
    b.push(p(
      (d.garantidor.mesmoQueComprador
        ? '12.1. O COMPRADOR, na qualidade de GARANTIDOR, declara-se, por meio deste instrumento e na forma dos '
        : '12.1. O GARANTIDOR, qualificado no preâmbulo, declara-se, por meio deste instrumento e na forma dos ') +
      'arts. 264 e 265 do Código Civil, devedor solidário de todas as obrigações assumidas pela COMPRADORA ' +
      'neste contrato, principais e acessórias, incluindo o preço, encargos, multas, despesas e ' +
      'honorários, respondendo com seu patrimônio pessoal, sem benefício de ordem e sem qualquer limitação ' +
      'de valor.'))
    if (temParcelas) {
      b.push(p('12.2. O GARANTIDOR apõe, ainda, seu aval em cada uma das notas promissórias referidas no item 2.4.'))
    }
    b.push(p(
      '12.3. A solidariedade e o aval subsistem em caso de prorrogação de prazos, concessão de tolerâncias, ' +
      'renegociação de valores e/ou substituição de títulos, para as quais o GARANTIDOR desde já manifesta ' +
      'sua anuência.'))
    b.push(p(
      '12.4. Sendo casado o GARANTIDOR — ou a própria COMPRADORA, quando pessoa física —, o respectivo ' +
      'cônjuge assina este instrumento para os fins do art. 1.647, inciso III, do Código Civil, ' +
      'manifestando sua expressa anuência à garantia prestada.'))
  }

  // ── 13 FORCA MAIOR ──
  b.push(clausula('CLÁUSULA DÉCIMA TERCEIRA – DO CASO FORTUITO E DA FORÇA MAIOR'))
  b.push(p(
    '13.1. Nenhuma das partes responderá por atraso ou inadimplemento decorrente de caso fortuito ou força ' +
    'maior, assim compreendidos os eventos imprevisíveis e inevitáveis, tais como calamidades, eventos ' +
    'climáticos extremos, greves, bloqueios de vias, falta generalizada de energia elétrica, atos de ' +
    'autoridade e desabastecimento de matéria-prima no mercado, ficando os prazos suspensos pelo período ' +
    'do impedimento, mediante comunicação escrita à outra parte.'))
  b.push(p(
    '13.2. A ocorrência de caso fortuito ou força maior não suspende nem exonera a COMPRADORA das ' +
    'obrigações de pagamento já vencidas.'))

  // ── 14 LGPD ──
  b.push(clausula('CLÁUSULA DÉCIMA QUARTA – DA CONFIDENCIALIDADE E DA PROTEÇÃO DE DADOS'))
  b.push(p(
    '14.1. As partes obrigam-se a manter sigilo sobre as informações técnicas e comerciais a que tiverem ' +
    'acesso em razão deste contrato, notadamente preços, projetos, desenhos e processos produtivos, ' +
    'durante a sua vigência e pelo prazo de 5 (cinco) anos contados do seu término.'))
  b.push(p(
    '14.2. As partes tratarão os dados pessoais eventualmente compartilhados em conformidade com a Lei ' +
    'nº 13.709/2018 (LGPD), exclusivamente para a execução deste contrato, o cumprimento de obrigações ' +
    'legais e regulatórias e o exercício regular de direitos, inclusive análise de crédito, cobrança e ' +
    'cessão de créditos, adotando medidas técnicas e administrativas de segurança.'))
  if (d.usoImagem) {
    b.push(p(
      '14.3. A COMPRADORA autoriza a VENDEDORA a divulgar, para fins comerciais e institucionais, imagens ' +
      'dos equipamentos fornecidos e da sua instalação, ressalvadas as informações de preço.'))
  }

  // ── 15 DECLARACOES ──
  b.push(clausula('CLÁUSULA DÉCIMA QUINTA – DAS DECLARAÇÕES DAS PARTES'))
  b.push(p('15.1. Ambas as partes declaram, neste ato:'))
  for (const t of [
    'a) que receberam previamente a minuta do presente instrumento, a fim de que fosse examinada, inclusive com a liberdade de se assessorar por advogado de sua confiança, tendo permanecido com a referida minuta em seu poder;',
    'b) que as cláusulas e condições aqui descritas são de sua inteira e integral compreensão e alcance, nada podendo ser alegado, futuramente, sobre não ter tido conhecimento ou ter sido surpreendida;',
    'c) que as obrigações assumidas neste instrumento estão de acordo com a sua capacidade econômico-financeira; e',
    'd) que se obrigam a guardar, tanto na execução como na conclusão do presente contrato, os princípios de probidade e de boa-fé.',
  ]) b.push(p(t, { indent: 340, spaceAfter: 80 }))
  b.push(p(
    '15.2. As partes declaram, ainda, que cumprem a legislação anticorrupção, trabalhista e ambiental ' +
    'aplicável, e que não utilizam trabalho infantil ou análogo ao de escravo.'))

  // ── 16 GERAIS ──
  b.push(clausula('CLÁUSULA DÉCIMA SEXTA – DAS DISPOSIÇÕES GERAIS'))
  b.push(p(
    '16.1. As comunicações entre as partes serão feitas por escrito, considerando-se válidas as ' +
    'encaminhadas aos endereços físicos e eletrônicos indicados no preâmbulo, cabendo a cada parte manter ' +
    'seus dados atualizados e comunicar qualquer alteração em até 5 (cinco) dias.'))
  b.push(p(
    '16.1.1. As partes reconhecem como válidas e eficazes, para todos os fins deste contrato, as ' +
    'comunicações enviadas para os endereços de e-mail e para os números de telefone e de aplicativo de ' +
    'mensagens indicados no preâmbulo, inclusive as relativas a cobrança, ressalvadas as hipóteses em que ' +
    'a lei exija forma específica.'))
  b.push(p(
    '16.2. A tolerância de qualquer das partes quanto ao descumprimento de obrigação da outra não importa ' +
    'novação, renúncia ou alteração do pactuado.'))
  b.push(p(
    '16.3. A COMPRADORA não poderá ceder este contrato, nem os direitos e obrigações dele decorrentes, sem ' +
    'prévia anuência escrita da VENDEDORA. A VENDEDORA poderá ceder ou descontar os créditos decorrentes ' +
    'deste contrato, comunicando a COMPRADORA.'))
  b.push(p('16.4. Este contrato obriga as partes, seus herdeiros e sucessores a qualquer título.'))
  b.push(p(
    '16.5. O presente instrumento, assinado pelas partes e por 2 (duas) testemunhas, constitui título ' +
    'executivo extrajudicial, na forma do art. 784, inciso III, do Código de Processo Civil.'))
  b.push(p(
    '16.6. As partes admitem a assinatura deste contrato por meio eletrônico, com utilização de ' +
    'certificado digital ICP-Brasil, do assinador eletrônico oficial do Governo Federal (gov.br) e/ou de ' +
    'plataforma de assinatura eletrônica que assegure a autenticidade, a integridade e a autoria do ' +
    'documento, reconhecendo-lhe a mesma validade da assinatura de próprio punho, nos termos da Medida ' +
    'Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.'))
  b.push(p(
    '16.6.1. Assinado o contrato por meio eletrônico em plataforma que registre a trilha de auditoria e ' +
    'confira a integridade do documento, fica dispensada a assinatura das testemunhas, permanecendo ' +
    'íntegra a sua natureza de título executivo extrajudicial, na forma do art. 784, § 4º, do Código de ' +
    'Processo Civil.'))
  b.push(p(
    '16.7. Este contrato, com os seus anexos, representa o inteiro acordo entre as partes quanto ao seu ' +
    'objeto, prevalecendo sobre quaisquer tratativas, propostas ou ajustes verbais anteriores. Havendo ' +
    'divergência entre este instrumento e o Orçamento (Anexo I), prevalecerão as disposições deste ' +
    'contrato, salvo quanto às especificações técnicas dos equipamentos.'))
  b.push(p(
    '16.8. Qualquer alteração deste contrato somente terá validade se formalizada por termo aditivo ' +
    'escrito e assinado pelas partes' + (d.garantidor.incluir ? ' e pelo GARANTIDOR.' : '.')))
  b.push(p(
    '16.9. A eventual invalidade ou ineficácia de qualquer cláusula não prejudica as demais, que ' +
    'permanecem em pleno vigor.'))

  // ── 17 FORO ──
  b.push(clausula('CLÁUSULA DÉCIMA SÉTIMA – DO FORO'))
  b.push(p(
    '17.1. As partes elegem o foro da Comarca de Braço do Norte/SC, com renúncia a qualquer outro, por ' +
    'mais privilegiado que seja, para dirimir questões oriundas do presente contrato, ressalvadas as ' +
    'medidas de recuperação da posse dos equipamentos, que poderão ser propostas no foro da situação dos ' +
    'bens, a critério da VENDEDORA.'))
  b.push(p(
    'E, por estarem justas e contratadas, as partes assinam o presente instrumento em 3 (três) vias de ' +
    'igual teor e forma, na presença das testemunhas abaixo.'))
  b.push(p(`Grão-Pará/SC, ${dataPorExtenso(d.dataContrato)}.`, { center: true }))

  // ── assinaturas ──
  b.push(...assinatura('METALÚRGICA BBA LTDA. – VENDEDORA', 'CNPJ 16.935.999/0001-09'))
  const mesmo = d.garantidor.incluir && d.garantidor.mesmoQueComprador
  b.push(...assinatura(
    `${vazio(c.nome, 'NOME DA COMPRADORA')} – ${mesmo ? 'COMPRADOR(A) E GARANTIDOR(A)' : 'COMPRADORA'}`,
    `${c.tipoPessoa === 'pj' ? 'CNPJ' : 'CPF'} ${vazio(c.cnpj, '—')}`))
  if (c.tipoPessoa !== 'pj' && /casad/i.test(c.representante.estadoCivil)) {
    b.push(...assinatura(
      `${vazio(c.representante.conjugeNome, 'NOME DO CÔNJUGE')} – ANUÊNCIA CONJUGAL`,
      `CPF ${vazio(c.representante.conjugeCpf, '—')}`))
  }
  if (d.garantidor.incluir && !mesmo) {
    b.push(...assinatura(
      `${vazio(d.garantidor.nome, 'NOME DO GARANTIDOR')} – GARANTIDOR`,
      `CPF ${vazio(d.garantidor.cpf, '—')}`))
    if (/casad/i.test(d.garantidor.estadoCivil)) {
      b.push(...assinatura(
        `${vazio(d.garantidor.conjugeNome, 'NOME DO CÔNJUGE DO GARANTIDOR')} – ANUÊNCIA CONJUGAL`,
        `CPF ${vazio(d.garantidor.conjugeCpf, '—')}`))
    }
  }

  b.push({ k: 'p', txt: 'TESTEMUNHAS:', bold: true, spaceBefore: true })
  for (const n of ['1.', '2.']) {
    b.push(p(`${n} ______________________________________________________________________________________`, { spaceAfter: 60 }))
    b.push(p('Nome: ____________________________________________ CPF: __________________________', { spaceAfter: 200 }))
  }

  b.push(p(`Anexo I – Orçamento nº ${d.orcamentoNumero}, de ${d.orcamentoData}.`, { spaceAfter: 60 }))
  b.push(p('Anexo II – Nota fiscal de venda com números de série (a integrar por ocasião da entrega).', { spaceAfter: 60 }))
  if (temParcelas) {
    b.push(p(`Anexo III – Notas promissórias nºs 1/${d.parcelas.length} a ${d.parcelas.length}/${d.parcelas.length}, vinculadas ao contrato.`))
  }

  return b
}
