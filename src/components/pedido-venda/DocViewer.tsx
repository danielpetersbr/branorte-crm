// Visualizador inline de documento (DOCX/PDF), portado de controle.branorte.com
// (`src/components/mapa-vendas/DocViewer.tsx`).
//
// ⚠️ DIFERENÇA DELIBERADA CONTRA A ORIGEM: lá o HTML que o mammoth cospe é
// sanitizado com DOMPurify e injetado com `dangerouslySetInnerHTML`. O CRM não
// tem DOMPurify instalado, e injetar HTML de arquivo de terceiro sem sanitizar
// é XSS na cara — o .docx é upload de usuário, e o mammoth propaga `<a href>`
// do documento (inclusive `javascript:`) junto com imagens em data: URI.
//
// A saída aqui é um IFRAME `sandbox=""` com `srcDoc`. Sandbox vazio derruba
// script, form, plugin, navegação de topo E same-origin, então mesmo um docx
// hostil vira texto morto — é uma trava mais forte que a allowlist do DOMPurify,
// e sem dependência nova. Imagem em data: URI continua renderizando.
//
// O documento é sempre pintado como PAPEL (fundo branco, texto preto) nos dois
// temas, igual à origem: é um documento, não um pedaço da UI.
import { useEffect, useState } from "react";
import { Loader2, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/pedido-ui/button";

interface DocViewerProps {
  url: string;
  title?: string;
  height?: string;
}

/** Envelope HTML do iframe: reset mínimo pro docx sair legível como papel. */
function montarDocumento(corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;background:#fff}
  body{padding:24px;color:#111827;font:14px/1.65 ui-sans-serif,system-ui,'Segoe UI',Roboto,Arial,sans-serif;-webkit-text-size-adjust:100%}
  img{max-width:100%;height:auto}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  td,th{border:1px solid #d1d5db;padding:6px 8px;vertical-align:top;text-align:left}
  h1,h2,h3,h4{margin:1.1em 0 .4em;line-height:1.25}
  h1{font-size:20px}h2{font-size:17px}h3{font-size:15px}
  p{margin:.5em 0}
  ul,ol{margin:.5em 0;padding-left:1.4em}
  a{color:#1d4ed8}
</style></head><body>${corpo}</body></html>`;
}

/**
 * DOCX renderizado no cliente via mammoth (dentro de iframe sandbox), PDF via
 * iframe nativo, e download direto pro que não dá pra exibir.
 */
export default function DocViewer({ url, title = "Documento", height = "60vh" }: DocViewerProps) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const isPdf = /\.pdf(\?|$)/i.test(url);
  const isDocx = /\.docx?(\?|$)/i.test(url);

  useEffect(() => {
    if (!url) return;
    // `cancelado` evita setState em componente desmontado quando o usuário
    // fecha o visualizador (ou troca de documento) no meio do fetch.
    let cancelado = false;

    setLoading(true);
    setError(false);
    setSrcDoc(null);

    if (!isDocx) {
      // PDF (ou formato sem suporte): quem resolve é o iframe/fallback abaixo.
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const arrayBuffer = await resposta.arrayBuffer();
        // import dinâmico: mammoth tem ~600 KB e só é preciso quando alguém
        // realmente abre um .docx (mesmo padrão do PedidoForm).
        const mammoth = (await import("mammoth")).default;
        const { value } = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelado) return;
        setSrcDoc(montarDocumento(value));
        setLoading(false);
      } catch (e) {
        console.error("[DocViewer] falha ao renderizar documento:", e);
        if (cancelado) return;
        setError(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [url, isDocx]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border bg-muted/30"
        style={{ height }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando documento...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted/30 py-12"
        style={{ height }}
      >
        <p className="text-sm text-muted-foreground">Não foi possível renderizar o documento.</p>
        <AcoesArquivo url={url} />
      </div>
    );
  }

  if (srcDoc !== null) {
    return (
      <iframe
        // sandbox="" (vazio) = todas as permissões negadas. Não trocar por
        // allow-scripts: seria devolver ao docx o direito de executar código.
        sandbox=""
        srcDoc={srcDoc}
        className="w-full rounded-lg border bg-white"
        style={{ height }}
        title={title}
      />
    );
  }

  if (isPdf) {
    return (
      <iframe src={url} className="w-full rounded-lg border bg-white" style={{ height }} title={title} />
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted/30 py-12"
      style={{ height }}
    >
      <p className="text-sm text-muted-foreground">Formato não suportado para visualização inline.</p>
      <AcoesArquivo url={url} />
    </div>
  );
}

function AcoesArquivo({ url }: { url: string }) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir em nova aba
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={url} download>
          <Download className="mr-1 h-3.5 w-3.5" /> Baixar
        </a>
      </Button>
    </div>
  );
}