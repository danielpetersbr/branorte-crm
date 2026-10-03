export function QueryNotice({ error, loading, onRetry, message = 'Não foi possível carregar os dados.' }: {
  error: unknown
  loading?: boolean
  onRetry: () => void
  message?: string
}) {
  if (!error) return null
  return <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
    <p>{message}</p>
    <button type="button" disabled={loading} onClick={onRetry} className="mt-2 rounded px-2 py-1 font-medium underline disabled:opacity-50">
      {loading ? 'Tentando novamente…' : 'Tentar novamente'}
    </button>
  </div>
}
