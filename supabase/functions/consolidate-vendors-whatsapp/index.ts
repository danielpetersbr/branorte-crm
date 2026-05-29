import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Tag {
  id: string;
  name: string;
  count: number;
  hexColor?: string;
}

interface VendorTokens {
  [key: string]: string;
}

// Tokens dos vendedores (sincronizado com wascriptTokens.ts)
const WASCRIPT_TOKENS: VendorTokens = {
  eder: "1737484288214-5c09c79e4a04d4e5167082bdb5813964",
  edilsonjr: "1751651601078-74dbe9f054d0ee9d60a98b09f4c34bd8",
  alvaro: "1751387001230-cbcbe0ea5564553c48d9ba6cdfaca889",
  gustavo: "1737476706499-ab668ba289b89925084072d0b6662ec9",
  jardel: "1737659615179-5db225351ba0bdada09f774351f71372",
  pedro: "1752159247481-f92663b691974f1997937745ec7eb92a"
};

const fetchVendorData = async (token: string): Promise<Tag[]> => {
  try {
    console.log(`🔄 Fetching data for token: ${token}`);
    const response = await fetch(`https://api-whatsapp.wascript.com.br/api/listar-etiquetas/${token}`);
    
    if (!response.ok) {
      console.error(`❌ HTTP error! status: ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      console.error('❌ API returned success: false');
      throw new Error('API returned success: false');
    }
    
    return data.etiquetas || [];
  } catch (error) {
    console.error('❌ Error fetching vendor data:', error);
    return [];
  }
};

const categorizeLabel = (name: string) => {
  const upperName = name.toUpperCase();
  
  // Funil de Vendas
  if (['PROSPECÇÃO', 'NOVO LEAD', 'FOLLOW UP', 'VENDIDOS'].includes(upperName)) {
    return {
      category: 'funil',
      key: upperName
    };
  }
  
  // Status Geral
  if (['ABERTO', 'FECHADO'].includes(upperName)) {
    return {
      category: 'status',
      key: upperName
    };
  }
  
  // Temperatura
  if (['QUENTE', 'MORNO', 'FRIO', 'LEAD QUENTE', 'LEAD MORNO', 'LEAD FRIO'].includes(upperName)) {
    let key = upperName;
    if (upperName.startsWith('LEAD ')) {
      key = upperName.replace('LEAD ', '');
    }
    return {
      category: 'temperatura',
      key: key
    };
  }
  
  return null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Iniciando consolidação de dados WhatsApp de todos os vendedores...');

    const consolidatedData = {
      funil: { PROSPECÇÃO: 0, 'NOVO LEAD': 0, 'FOLLOW UP': 0, VENDIDOS: 0 },
      status: { ABERTO: 0, FECHADO: 0 },
      temperatura: { QUENTE: 0, MORNO: 0, FRIO: 0 }
    };

    const vendorResults = [];

    // Processar cada vendedor
    for (const [vendorName, token] of Object.entries(WASCRIPT_TOKENS)) {
      if (!token) {
        console.log(`⚠️ Token vazio para ${vendorName}, pulando...`);
        continue;
      }

      try {
        console.log(`📊 Processando dados de ${vendorName}...`);
        const labels = await fetchVendorData(token);
        
        const vendorStats = {
          vendedor: vendorName,
          funil: { PROSPECÇÃO: 0, 'NOVO LEAD': 0, 'FOLLOW UP': 0, VENDIDOS: 0 },
          status: { ABERTO: 0, FECHADO: 0 },
          temperatura: { QUENTE: 0, MORNO: 0, FRIO: 0 },
          total: 0
        };

        labels.forEach(label => {
          const categorized = categorizeLabel(label.name);
          if (categorized) {
            const count = label.count || 0;
            
            if (categorized.category === 'funil') {
              vendorStats.funil[categorized.key as keyof typeof vendorStats.funil] = count;
              consolidatedData.funil[categorized.key as keyof typeof consolidatedData.funil] += count;
            } else if (categorized.category === 'status') {
              vendorStats.status[categorized.key as keyof typeof vendorStats.status] = count;
              consolidatedData.status[categorized.key as keyof typeof consolidatedData.status] += count;
            } else if (categorized.category === 'temperatura') {
              vendorStats.temperatura[categorized.key as keyof typeof vendorStats.temperatura] = count;
              consolidatedData.temperatura[categorized.key as keyof typeof consolidatedData.temperatura] += count;
            }
          }
        });

        vendorStats.total = labels.reduce((acc, label) => acc + (label.count || 0), 0);
        vendorResults.push(vendorStats);
        
        console.log(`✅ ${vendorName}: ${labels.length} etiquetas processadas`);
      } catch (error) {
        console.error(`❌ Erro ao processar ${vendorName}:`, error);
        vendorResults.push({
          vendedor: vendorName,
          erro: error.message,
          funil: { PROSPECÇÃO: 0, 'NOVO LEAD': 0, 'FOLLOW UP': 0, VENDIDOS: 0 },
          status: { ABERTO: 0, FECHADO: 0 },
          temperatura: { QUENTE: 0, MORNO: 0, FRIO: 0 },
          total: 0
        });
      }
    }

    // Calcular percentuais para funil
    const totalFunil = Object.values(consolidatedData.funil).reduce((acc, val) => acc + val, 0);
    const funnelData = Object.entries(consolidatedData.funil).map(([etapa, total]) => ({
      etapa,
      total,
      pct: totalFunil > 0 ? Math.round((total / totalFunil) * 100 * 10) / 10 : 0
    })).filter(item => item.total > 0);

    // Calcular percentuais para status
    const totalStatus = Object.values(consolidatedData.status).reduce((acc, val) => acc + val, 0);
    const statusData = Object.entries(consolidatedData.status).map(([status, total]) => ({
      status,
      total,
      pct: totalStatus > 0 ? Math.round((total / totalStatus) * 100 * 10) / 10 : 0
    })).filter(item => item.total > 0);

    // Calcular percentuais para temperatura
    const totalTemperatura = Object.values(consolidatedData.temperatura).reduce((acc, val) => acc + val, 0);
    const temperaturaData = Object.entries(consolidatedData.temperatura).map(([classe, total]) => ({
      classe,
      total,
      pct: totalTemperatura > 0 ? Math.round((total / totalTemperatura) * 100 * 10) / 10 : 0
    })).filter(item => item.total > 0);

    console.log('✅ Consolidação completa:', {
      vendedores_processados: vendorResults.length,
      total_funil: totalFunil,
      total_status: totalStatus,
      total_temperatura: totalTemperatura
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          funil: funnelData,
          status: statusData,
          temperatura: temperaturaData,
          consolidado: consolidatedData,
          vendedores: vendorResults,
          timestamp: new Date().toISOString()
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('❌ Erro geral na consolidação:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        details: 'Erro ao consolidar dados do WhatsApp'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});