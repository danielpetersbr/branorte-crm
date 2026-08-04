import { montarFone, separarFone } from '@/lib/telefone-ddi'
import { foneCanon } from '@/hooks/useAtendimentos'

const LEAD = foneCanon('5548999999999')
console.log('canon do lead:', LEAD, '\n')

for (const db of ['+55 48 99999-9999', '+5548999999999', '+55 (48) 99999-9999', '+55 48 3333-4444', '+595 981 123456']) {
  const sep = separarFone(db)                       // ClienteEditModal:249 (abre o modal)
  const salvo = montarFone(sep.numero, sep.ddi)     // ClienteEditModal:463 (salva)
  console.log(
    JSON.stringify(db).padEnd(24),
    '-> ddi', sep.ddi.padEnd(4),
    '-> salvo', JSON.stringify(salvo).padEnd(20),
    '-> canon', String(foneCanon(salvo)).padEnd(12),
    foneCanon(salvo) === LEAD ? 'CASA COM O LEAD' : (sep.ddi === '55' ? '*** QUEBROU ***' : '(estrangeiro, nao casa lead por design)')
  )
}

console.log('\n--- codigo ANTIGO (HEAD): fmtFone BR cru em cima do valor do banco ---')
const fmtFoneAntigo = (v: string) => {
  const d = v.replace(/\D/g, '')
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}
const antigo = fmtFoneAntigo('+55 48 99999-9999')
console.log('salvo:', JSON.stringify(antigo), '-> canon', foneCanon(antigo), foneCanon(antigo) === LEAD ? 'CASA' : '*** QUEBROU ***')
