// Descrições cadastradas por modelo — viram o nome do arquivo do orçamento
// (formato: "Número - Cliente (descrição)").
//
// Fonte: lista do Gustavo Vicente (WhatsApp 2026-07-22), no formato "limpo" (sem os
// parênteses da mensagem original). Editar/adicionar aqui = novas opções no picker
// da seção "Descrição do orçamento" do FinalizarMontarModal.
//
// PENDENTE (Gustavo ainda não enviou / mensagem cortou):
//   - Mini Fábrica 300
//   - Mini Fábrica 600
//   - confirmar se "Compacta 01 Master" e "Compacta 02 Master" estão completas
//
// Modelos SEM entrada aqui (ex.: "Equipamento Avulso", "Mini Fábrica 300/600") continuam
// funcionando como atalho de texto livre (o chip só preenche o nome do modelo).

export const DESCRICOES_POR_MODELO: Record<string, string[]> = {
  'Compacta 01': [
    'Compacta 01 - 100500 monofásico',
    'Compacta 01 - 100500 trifásico',
    'Compacta 01 - 150500 monofásico',
    'Compacta 01 - 150500 trifásico',
    'Compacta 01 - 1001000 monofásico',
    'Compacta 01 - 1001000 trifásico',
    'Compacta 01 - 1501000 monofásico',
    'Compacta 01 - 1501000 trifásico',
    'Compacta 01 - 2001000 trifásico',
  ],
  'Compacta 01 Master': [
    'Compacta 01 Master - 100300 monofásico',
    'Compacta 01 Master - 100300 trifásico',
    'Compacta 01 Master - 100500 monofásico',
    'Compacta 01 Master - 100500 trifásico',
    'Compacta 01 Master - 150500 monofásico',
    'Compacta 01 Master - 150500 trifásico',
    'Compacta 01 Master - 200500 trifásico',
    'Compacta 01 Master 75300 monofásico',
    'Compacta 01 Master 75300 trifásico',
    'Compacta 01 Master JR 75150 monofásico',
    'Compacta 01 Master JR 75150 trifásico',
  ],
  'Compacta 02': [
    'Compacta 02 - 75500 monofásico',
    'Compacta 02 - 75500 trifásico',
    'Compacta 02 - 100500 monofásico',
    'Compacta 02 - 100500 trifásico',
    'Compacta 02 - 150500 monofásico',
    'Compacta 02 - 150500 trifásico',
    'Compacta 02 - 1001000 monofásico',
    'Compacta 02 - 1001000 trifásico',
    'Compacta 02 - 1501000 monofásico',
    'Compacta 02 - 1501000 trifásico',
    'Compacta 02 - 2001000 trifásico',
  ],
  'Compacta 02 Master': [
    'Compacta 02 Master - 100500 monofásico',
    'Compacta 02 Master - 100500 trifásico',
    'Compacta 02 Master - 150500 monofásico',
    'Compacta 02 Master - 150500 trifásico',
    'Compacta 02 Master - 200500 trifásico',
    'Compacta 02 Master - 250500 trifásico',
    'Compacta 02 Master - 1501000 monofásico',
    'Compacta 02 Master - 1501000 trifásico',
    'Compacta 02 Master - 2001000 trifásico',
    'Compacta 02 Master - 2501000 trifásico',
  ],
  'Compacta 03': [
    'Compacta 03 - 100500 - 4000 - 4000 com ensacadeira monofásico',
    'Compacta 03 - 100500 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 - 150500 - 4000 - 4000 com ensacadeira monofásico',
    'Compacta 03 - 150500 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 - 1001000 - 4000 - 4000 com ensacadeira monofásico',
    'Compacta 03 - 1001000 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 - 1501000 - 4000 - 4000 com ensacadeira monofásico',
    'Compacta 03 - 1501000 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 - 2001000 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 - 2001000 - 6000 - 6000 com ensacadeira trifásico',
    'Compacta 03 - 3001000 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 - 3001000 - 6000 - 6000 com ensacadeira trifásico',
    'Compacta 03 - 5001000 - 6000 - 6000 com ensacadeira trifásico',
  ],
  'Compacta 03 Master': [
    'Compacta 03 Master - 150500 - 4000 - 4000 com ensacadeira monofásico',
    'Compacta 03 Master - 150500 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 Master - 200500 - 4000 - 4000 com ensacadeira trifásico',
    'Compacta 03 Master - 200500 - 6000 - 6000 com ensacadeira trifásico',
    'Compacta 03 Master - 300500 - 6000 - 6000 com ensacadeira trifásico',
    'Compacta 03 Master - 3001000 - 6000 - 6000 com ensacadeira trifásico',
    'Compacta 03 Master - 5001000 - 6000 - 6000 com ensacadeira trifásico',
  ],
}
