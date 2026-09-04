import { Button } from "@/components/pedido-ui/button";
import { Textarea } from "@/components/pedido-ui/textarea";
import { Input } from "@/components/pedido-ui/input";
import { Label } from "@/components/pedido-ui/label";
import { Badge } from "@/components/pedido-ui/badge";
import { Plus, Trash2, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface EquipamentoDetalhado {
  descricao: string;
  unidade: string;
  quantidade: number;
  valor: number;
}

interface EquipamentosEditorProps {
  equipamentos: string[];
  equipamentosDetalhados?: EquipamentoDetalhado[];
  onChange: (equipamentos: string[], detalhados?: EquipamentoDetalhado[]) => void;
}

export function EquipamentosEditor({ equipamentos, equipamentosDetalhados, onChange }: EquipamentosEditorProps) {
  const [localEquipamentos, setLocalEquipamentos] = useState<string[]>(equipamentos);
  const [localDetalhados, setLocalDetalhados] = useState<EquipamentoDetalhado[] | undefined>(equipamentosDetalhados);

  // Sincronizar com props quando mudarem (ex: ao carregar pedido existente)
  useEffect(() => {
    setLocalEquipamentos(equipamentos);
    setLocalDetalhados(equipamentosDetalhados);
  }, [equipamentos, equipamentosDetalhados]);

  // Detectar tipo especial de item (EXISTENTE, CORTESIA, BRINDE)
  const detectarTipoEspecial = (descricao: string): { tipo: string | null; badge: string | null } => {
    const descNorm = descricao.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    if (descNorm.includes('JA EXISTENTE') || descNorm.includes('JÁ EXISTENTE') || 
        descNorm.includes('(EXISTENTE)') || /\bEXISTENTE\b/.test(descNorm)) {
      return { tipo: 'EXISTENTE', badge: 'Já Existente' };
    }
    if (descNorm.includes('CORTESIA') || descNorm.includes('(CORTESIA)')) {
      return { tipo: 'CORTESIA', badge: 'Cortesia' };
    }
    if (descNorm.includes('BRINDE') || descNorm.includes('(BRINDE)')) {
      return { tipo: 'BRINDE', badge: 'Brinde' };
    }
    
    return { tipo: null, badge: null };
  };

  const handleAdd = () => {
    const newEquipamentos = [...localEquipamentos, ""];
    const newDetalhados = localDetalhados 
      ? [...localDetalhados, { descricao: "", unidade: "UN", quantidade: 1, valor: 0 }]
      : undefined;
    setLocalEquipamentos(newEquipamentos);
    setLocalDetalhados(newDetalhados);
    onChange(newEquipamentos, newDetalhados);
  };

  const handleRemove = (index: number) => {
    const newEquipamentos = localEquipamentos.filter((_, i) => i !== index);
    const newDetalhados = localDetalhados?.filter((_, i) => i !== index);
    setLocalEquipamentos(newEquipamentos);
    setLocalDetalhados(newDetalhados);
    onChange(newEquipamentos, newDetalhados);
  };

  const handleChangeDescricao = (index: number, value: string) => {
    const newEquipamentos = [...localEquipamentos];
    newEquipamentos[index] = value;
    
    if (localDetalhados) {
      const newDetalhados = [...localDetalhados];
      newDetalhados[index] = { ...newDetalhados[index], descricao: value };
      setLocalEquipamentos(newEquipamentos);
      setLocalDetalhados(newDetalhados);
      onChange(newEquipamentos, newDetalhados);
    } else {
      setLocalEquipamentos(newEquipamentos);
      onChange(newEquipamentos);
    }
  };

  const handleChangeDetalhado = (index: number, field: keyof EquipamentoDetalhado, value: any) => {
    if (!localDetalhados) return;
    
    const newDetalhados = [...localDetalhados];
    newDetalhados[index] = { ...newDetalhados[index], [field]: value };
    setLocalDetalhados(newDetalhados);
    onChange(localEquipamentos, newDetalhados);
  };

  // Calcular o total da soma de todos os equipamentos (excluindo itens especiais)
  const calcularTotal = () => {
    if (!localDetalhados) return 0;
    return localDetalhados.reduce((total, item, index) => {
      const { tipo } = detectarTipoEspecial(item.descricao);
      // Não incluir no total se for EXISTENTE, CORTESIA ou BRINDE
      if (tipo) return total;
      return total + (item.quantidade * item.valor);
    }, 0);
  };

  const totalGeral = calcularTotal();

  return (
    <div className="space-y-4">
      {/* Header com título e total */}
      <div className="flex items-center justify-between pb-3 border-b">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-base text-foreground">Equipamentos</h3>
          {localDetalhados && localDetalhados.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {localDetalhados.length} {localDetalhados.length === 1 ? 'item' : 'itens'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {localDetalhados && localDetalhados.length > 0 && totalGeral > 0 && (
            <div className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
              <div className="flex flex-col items-end">
                <span className="text-xs text-muted-foreground font-medium">Valor Total</span>
                <span className="text-lg font-bold text-primary">
                  {new Intl.NumberFormat('pt-BR', { 
                    style: 'currency', 
                    currency: 'BRL' 
                  }).format(totalGeral)}
                </span>
              </div>
            </div>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleAdd}
            className="h-9"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Adicionar Item
          </Button>
        </div>
      </div>

      {/* Lista de Equipamentos */}
      <div className="relative">
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 scroll-smooth">
        {localEquipamentos.length === 0 ? (
          <div className="text-center py-8 px-4 border-2 border-dashed rounded-lg bg-muted/30">
            <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum equipamento adicionado</p>
            <p className="text-xs text-muted-foreground mt-1">Clique em "Adicionar Item" para começar</p>
          </div>
        ) : (
          localEquipamentos.map((eq, index) => {
            const detalhado = localDetalhados?.[index];
            const { tipo, badge } = detectarTipoEspecial(eq);
            const isItemEspecial = tipo !== null;
            
            return (
              <div 
                key={index} 
                className={cn(
                  "group relative flex gap-3 items-start p-4 rounded-lg border-2 transition-all",
                  isItemEspecial 
                    ? "bg-gradient-to-r from-amber-50/50 to-amber-50/20 border-amber-200 dark:from-amber-950/30 dark:to-amber-950/10 dark:border-amber-800/50"
                    : "bg-card border-border hover:border-primary/40 hover:shadow-sm"
                )}
              >
                {/* Número do Item */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary">{index + 1}</span>
                </div>

                <div className="flex-1 space-y-3">
                  {/* Descrição com Badge */}
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Label className="text-xs font-semibold text-foreground">Descrição</Label>
                      {badge && (
                        <Badge variant="outline" className="text-xs bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
                          {badge}
                        </Badge>
                      )}
                    </div>
                    <Textarea
                      value={eq}
                      onChange={(e) => handleChangeDescricao(index, e.target.value)}
                      placeholder="Ex: A - TRANSPORTADOR HELICOIDAL 160 X 6,0 M"
                      className="min-h-[70px] text-sm resize-none"
                    />
                  </div>

                  {/* Detalhes (Quantidade, Unidade, Valor) */}
                  {detalhado && !isItemEspecial && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs font-semibold text-foreground mb-1.5 block">Quantidade</Label>
                          <Input
                            type="number"
                            min="1"
                            value={detalhado.quantidade}
                            onChange={(e) => handleChangeDetalhado(index, 'quantidade', parseInt(e.target.value) || 1)}
                            className="text-sm h-10"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold text-foreground mb-1.5 block">Unidade</Label>
                          <Input
                            value={detalhado.unidade}
                            onChange={(e) => handleChangeDetalhado(index, 'unidade', e.target.value)}
                            placeholder="UN"
                            className="text-sm h-10"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold text-foreground mb-1.5 block">Valor Unit. (R$)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={detalhado.valor || ''}
                            onChange={(e) => handleChangeDetalhado(index, 'valor', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                            placeholder="0,00"
                            className="text-sm h-10"
                          />
                        </div>
                      </div>
                      
                      {/* Valor Total do Item */}
                      {detalhado.quantidade > 0 && detalhado.valor > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
                          <span className="text-xs font-medium text-muted-foreground">Valor Total deste Item:</span>
                          <span className="text-sm font-bold text-primary">
                            {new Intl.NumberFormat('pt-BR', { 
                              style: 'currency', 
                              currency: 'BRL' 
                            }).format(detalhado.quantidade * detalhado.valor)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Apenas quantidade e unidade para itens especiais */}
                  {detalhado && isItemEspecial && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-foreground mb-1.5 block">Quantidade</Label>
                        <Input
                          type="number"
                          min="1"
                          value={detalhado.quantidade}
                          onChange={(e) => handleChangeDetalhado(index, 'quantidade', parseInt(e.target.value) || 1)}
                          className="text-sm h-10"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-foreground mb-1.5 block">Unidade</Label>
                        <Input
                          value={detalhado.unidade}
                          onChange={(e) => handleChangeDetalhado(index, 'unidade', e.target.value)}
                          placeholder="UN"
                          className="text-sm h-10"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Botão Remover */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(index)}
                  className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })
        )}
        </div>
        
        {/* Indicador de mais itens abaixo */}
        {localEquipamentos.length > 5 && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none flex items-end justify-center pb-2">
            <span className="text-xs text-muted-foreground animate-bounce">↓ Role para ver mais itens ↓</span>
          </div>
        )}
      </div>
    </div>
  );
}
