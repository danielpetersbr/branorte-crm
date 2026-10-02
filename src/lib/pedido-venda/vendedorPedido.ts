export interface IdentidadeVendedorPedido {
  fixo: boolean
  nome: string
  bloqueado: boolean
  aviso: string | null
}

export function identificarVendedorPedido(args: {
  role: string | null | undefined
  vendorId: string | null | undefined
  nomeCadastro: string | null | undefined
  carregando: boolean
  erro: boolean
}): IdentidadeVendedorPedido {
  if (args.role !== 'vendor') return { fixo: false, nome: '', bloqueado: false, aviso: null }

  let aviso: string | null = null
  if (!args.vendorId) {
    aviso = 'Seu usuário ainda não está vinculado a um vendedor. Peça ao administrador para conferir seu cadastro.'
  } else if (args.carregando) {
    aviso = 'Carregando seu cadastro de vendedor...'
  } else if (args.erro) {
    aviso = 'Não foi possível confirmar seu vendedor. Atualize a página para tentar novamente.'
  } else if (!args.nomeCadastro?.trim()) {
    aviso = 'Seu vínculo de vendedor não tem nome cadastrado. Peça ao administrador para conferir seu cadastro.'
  }
  return {
    fixo: true,
    nome: aviso ? '' : args.nomeCadastro!.trim().toUpperCase(),
    bloqueado: aviso !== null,
    aviso,
  }
}

export function vendedorPrincipalPedido(identidade: IdentidadeVendedorPedido, escolhido: string): string {
  if (identidade.bloqueado) throw new Error(identidade.aviso || 'Confirme seu cadastro de vendedor antes de gerar o pedido.')
  const nome = identidade.fixo ? identidade.nome : escolhido.trim()
  if (!nome) throw new Error('Selecione um vendedor responsável.')
  return nome
}

export function destinoAposCriarPedido(vendedorFixo: boolean, pedidoId: string | null | undefined): string {
  const id = pedidoId?.trim()
  return vendedorFixo && id ? `/controle/pedidos/${encodeURIComponent(id)}` : '/controle/pedidos'
}
