// O card e o estado de repetição só mudam depois da confirmação do banco.
export async function persistirAcaoLembrete(persistir: () => PromiseLike<{ error: unknown | null }>, aoPersistir: () => void): Promise<void> {
  const { error } = await persistir()
  if (error) throw error
  aoPersistir()
}
