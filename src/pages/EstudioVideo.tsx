import { ExternalLink, FolderOpen, Lock, Monitor, Video } from 'lucide-react'

const ESTUDIO_URL = 'https://usuario.tail211309.ts.net:8443/'

export function EstudioVideo() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Video className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">Estúdio de vídeo</h1>
          <p className="mt-1 text-sm text-ink-muted">Criação com IA usando a GPU do seu PC</p>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">Seu estúdio, conectado ao CRM</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Gere vídeos a partir de texto, foto ou vídeo. As tarefas são processadas no PC,
          enquanto você acompanha o estúdio pelo navegador.
        </p>
        <a
          href={ESTUDIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Abrir estúdio no meu PC
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
        <p className="mt-3 text-xs text-ink-faint">O estúdio abre em uma nova aba.</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-xl border border-border bg-surface p-5">
          <Monitor className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-ink">PC ligado e conectado</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Mantenha o PC ligado e conectado à internet durante o uso e até a geração terminar.
          </p>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <FolderOpen className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-ink">Fila e arquivos compartilhados</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            A fila e os arquivos são os mesmos do estúdio no PC. Confira as tarefas em andamento antes de iniciar outra geração.
          </p>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <Lock className="h-5 w-5 text-accent" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-ink">Senha de acesso</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            No primeiro acesso, informe a senha do estúdio na nova aba.
          </p>
        </section>
      </div>

      <p className="text-sm leading-relaxed text-ink-muted">
        A captura de cenas 3D continua sendo feita no navegador do PC.
      </p>
    </div>
  )
}
