import { useState } from 'react'
import { Upload, X, Check, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { parseDocxModelo, type ParsedModelo } from '@/lib/parse-docx-modelo'
import { subirModeloCustomizado } from '@/hooks/useOrcamentoBuilder'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: (modeloId: number) => void
}

const PACOTES_SUGESTAO = [
  'COMPACTA 01', 'COMPACTA 02', 'COMPACTA 03', 'MINI FABRICA',
  'ACESSÓRIOS', 'PEÇAS DE REPOSIÇÃO', 'MOTORES', 'OUTROS',
]

// Pacotes que NÃO precisam de voltagem (peças, acessórios soltos, etc.)
const PACOTES_SEM_VOLTAGEM = ['ACESSÓRIOS', 'PEÇAS DE REPOSIÇÃO', 'MOTORES', 'OUTROS']

// Detecta pacote pelo nome do arquivo (Peneiras → ACESSÓRIOS, etc.)
function detectarPacote(nome: string): string {
  const n = nome.toLowerCase()
  if (/compacta\s*0?3/.test(n)) return 'COMPACTA 03'
  if (/compacta\s*0?2/.test(n)) return 'COMPACTA 02'
  if (/compacta\s*0?1/.test(n)) return 'COMPACTA 01'
  if (/mini\s*f[áa]brica/.test(n)) return 'MINI FABRICA'
  if (/peneiras?|martelos?|chupim|moinho|crivos?/.test(n)) return 'ACESSÓRIOS'
  if (/motor(es)?/.test(n)) return 'MOTORES'
  if (/pe[çc]as?\s+de\s+reposi/.test(n)) return 'PEÇAS DE REPOSIÇÃO'
  return 'ACESSÓRIOS'
}

export function UploadModeloModal({ open, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedModelo | null>(null)
  const [parsing, setParsing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Campos do formulário
  const [basename, setBasename] = useState('')
  const [pacote, setPacote] = useState('ACESSÓRIOS')
  const [voltagem, setVoltagem] = useState<'monofasico' | 'trifasico'>('trifasico')
  const [salvando, setSalvando] = useState(false)

  async function handleFile(f: File | null) {
    if (!f) return
    setFile(f)
    setErro(null)
    setParsing(true)
    try {
      const result = await parseDocxModelo(f)
      setParsed(result)
      // Auto-preenche basename do nome do arquivo
      const cleanName = f.name.replace(/\.docx$/i, '').replace(/^\([^)]*\)\s*/, '')
      setBasename(cleanName)
      // Auto-detecta pacote (Peneiras → ACESSÓRIOS, Compacta 01 → COMPACTA 01, etc.)
      const pacoteDetectado = detectarPacote(f.name)
      setPacote(pacoteDetectado)
    } catch (e) {
      setErro('Não consegui parsear o .docx: ' + (e as Error).message)
      setParsed(null)
    } finally {
      setParsing(false)
    }
  }

  async function handleSalvar() {
    if (!file || !parsed) return
    if (!basename.trim()) {
      setErro('Nome do modelo obrigatório')
      return
    }
    if (!parsed.total_proposta) {
      setErro('Não achei VALOR TOTAL DA PROPOSTA no .docx. Verifica o arquivo.')
      return
    }
    // Pacotes "sem voltagem" (ACESSÓRIOS, PEÇAS, etc.) salvam sempre como "trifasico" no banco
    // (a coluna do DB exige um valor, mas é ignorado na UI)
    const voltagemFinal = PACOTES_SEM_VOLTAGEM.includes(pacote) ? 'trifasico' : voltagem
    setSalvando(true)
    setErro(null)
    try {
      const modelo = await subirModeloCustomizado({
        basename: basename.trim(),
        pacote,
        voltagem: voltagemFinal,
        is_master: false,
        is_jr: false,
        com_balanca: false,
        com_ensacadeira: false,
        com_chupim: false,
        producao_kgh: null,
        armazenamento_kg: null,
        itens: parsed.itens,
        acessorios: parsed.acessorios,
        motores: parsed.motores,
        total_equipamentos: parsed.total_equipamentos,
        total_motores: parsed.total_motores,
        total_proposta: parsed.total_proposta,
        arquivo_docx: file,
      })
      onSuccess(modelo.id)
      // Reset
      setFile(null)
      setParsed(null)
      setBasename('')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-[16px] font-semibold text-ink flex items-center gap-2">
            <Upload className="h-4 w-4 text-accent" />
            Subir novo modelo de orçamento
          </h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Step 1: File picker */}
          {!file && (
            <div>
              <label className="block">
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-accent/50 transition-colors cursor-pointer">
                  <Upload className="h-8 w-8 text-ink-faint mx-auto mb-2" />
                  <p className="text-[13px] font-medium text-ink">Clique pra escolher um .docx</p>
                  <p className="text-[11px] text-ink-faint mt-1">
                    Sistema vai parsear automaticamente items, motores e valores.
                  </p>
                </div>
                <input
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={e => handleFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          )}

          {/* Step 2: Parsing in progress */}
          {file && parsing && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 text-accent mx-auto mb-2 animate-spin" />
              <p className="text-[13px] text-ink-muted">Parseando {file.name}...</p>
            </div>
          )}

          {/* Step 3: Parsed - show preview + ask for metadata */}
          {file && parsed && !parsing && (
            <>
              <div className="p-3 bg-success-bg/15 border border-success/30 rounded-md text-[12px]">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-success" />
                  <span className="font-semibold text-success">Arquivo carregado: {file.name}</span>
                </div>
                <ul className="space-y-0.5 text-[11px] text-ink-muted ml-6">
                  {parsed.itens.length > 0 && (
                    <li>{parsed.itens.length} {parsed.itens.length === 1 ? 'item' : 'items'} de equipamento detectados</li>
                  )}
                  {parsed.motores.length > 0 && (
                    <li>{parsed.motores.length} {parsed.motores.length === 1 ? 'motor' : 'motores'}</li>
                  )}
                  {parsed.acessorios && parsed.acessorios.items.length > 0 && (
                    <li>{parsed.acessorios.items.length} acessórios na seção</li>
                  )}
                  {parsed.total_proposta && (
                    <li className="text-ink font-semibold">
                      Total: R$ {parsed.total_proposta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </li>
                  )}
                  {!parsed.total_proposta && (
                    <li className="text-warning">⚠️ Não achei VALOR TOTAL DA PROPOSTA — vai precisar editar manualmente.</li>
                  )}
                  {parsed.itens.length === 0 && parsed.motores.length === 0 && (
                    <li className="text-[10px] italic">O .docx será usado como template completo (sem parsing de items individuais — funciona pra modelos avulsos).</li>
                  )}
                </ul>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                    Nome do modelo *
                  </label>
                  <Input
                    value={basename}
                    onChange={e => setBasename(e.target.value)}
                    placeholder="Ex: Avulso - Martelos e Peneiras"
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Pacote</label>
                  <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-1.5">
                    {PACOTES_SUGESTAO.map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPacote(p)}
                        className={`text-[11px] px-2 py-1.5 rounded font-semibold transition-all ${
                          pacote === p
                            ? 'bg-accent text-white'
                            : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={pacote}
                    onChange={e => setPacote(e.target.value)}
                    placeholder="Ou digite custom"
                    className="mt-2"
                  />
                </div>

                {!PACOTES_SEM_VOLTAGEM.includes(pacote) ? (
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Voltagem</label>
                    <div className="mt-1 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setVoltagem('monofasico')}
                        className={`flex-1 text-[12px] py-1.5 rounded font-semibold ${
                          voltagem === 'monofasico'
                            ? 'bg-warning text-white'
                            : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                        }`}
                      >
                        Monofásico
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoltagem('trifasico')}
                        className={`flex-1 text-[12px] py-1.5 rounded font-semibold ${
                          voltagem === 'trifasico'
                            ? 'bg-info text-white'
                            : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                        }`}
                      >
                        Trifásico
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-ink-faint italic">
                    Pacote "{pacote}" não usa voltagem — campo escondido.
                  </div>
                )}
              </div>
            </>
          )}

          {erro && (
            <div className="p-3 bg-danger-bg/15 border border-danger/30 rounded-md text-[11px] text-danger">
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={() => {
              setFile(null)
              setParsed(null)
              setBasename('')
              setErro(null)
              onClose()
            }}
            disabled={salvando}
            className="text-[12px] px-4 py-2 rounded bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink font-semibold disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={!parsed || salvando || !basename.trim()}
            className="text-[12px] px-5 py-2 rounded bg-accent hover:bg-accent-700 text-white font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {salvando ? 'Salvando...' : 'Salvar modelo'}
          </button>
        </div>
      </div>
    </div>
  )
}
