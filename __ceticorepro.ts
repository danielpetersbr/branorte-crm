// Simula o caminho REAL do relato:
//   vendedor registra "+595 981 123456" no orcamento
//   -> cliente_dados.fone gravado
//   -> trigger: regexp_replace(fone,'[^0-9]','','g'), if length<10 return
//   -> wa_reminders.contato_numero
import { montarFone, separarFone, formatarFone, formatarFoneBr, validarFone } from './src/lib/telefone-ddi'
import { parseClienteText } from './src/lib/parse-cliente-text'

const trigger = (fone: string | null) => {
  const d = (fone ?? '').replace(/[^0-9]/g, '')
  return d.length < 10 ? '(trigger IGNORA — <10 digitos)' : d
}

console.log('=== A) fluxo "Colar" no ClienteEditModal (handleColar -> separarFone -> montarFone) ===')
for (const texto of ['FAZENDA X\n+595 981 123456\nAsuncion - PY', '+595 981 123456']) {
  const { dados } = parseClienteText(texto)
  const sep = dados.fone ? separarFone(dados.fone) : null
  const gravado = sep ? montarFone(sep.numero, sep.ddi) : null
  console.log({
    entrada: texto.replace(/\n/g, ' | '),
    fone_extraido: dados.fone ?? null,
    ddi: sep?.ddi, numero: sep?.numero,
    cliente_dados_fone: gravado,
    contato_numero: trigger(gravado),
  })
}

console.log('\n=== B) fluxo "digitar" (select DDI 595 + digitar 981123456) ===')
{
  const ddi = '595'
  let campo = ''
  for (const ch of '981123456') campo = formatarFone(campo + ch, ddi) // onChange char a char
  const valido = validarFone(campo, ddi)
  const gravado = montarFone(campo, ddi)
  console.log({ campo, valido, cliente_dados_fone: gravado, contato_numero: trigger(gravado) })
}

console.log('\n=== C) fluxo "digitar SEM trocar o DDI" (fica em 55 e digita 595981123456) ===')
{
  const ddi = '55'
  let campo = ''
  for (const ch of '595981123456') campo = formatarFone(campo + ch, ddi)
  const gravado = montarFone(campo, ddi)
  console.log({ campo, cliente_dados_fone: gravado, contato_numero: trigger(gravado), OBS: 'este e o cenario do relato' })
}

console.log('\n=== D) o que o RELATO afirma que sai hoje ===')
console.log({ mascaraBrCrua: formatarFoneBr('+595 981 123456'), contato_numero: trigger(formatarFoneBr('+595 981 123456')) })

console.log('\n=== E) reidratacao: abrir de novo um orcamento ja gravado ===')
{
  const noBanco = montarFone('981123456', '595')
  const sep = separarFone(noBanco)
  const regravado = montarFone(sep.numero, sep.ddi)
  console.log({ noBanco, sep, regravado, contato_numero: trigger(regravado) })
}
