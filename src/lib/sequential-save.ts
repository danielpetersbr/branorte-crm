/** Mantém a ordem das gravações e libera a próxima mesmo se uma falhar. */
export function createSequentialSave() {
  let previous: Promise<unknown> = Promise.resolve()
  return <T>(save: () => Promise<T>): Promise<T> => {
    const current = previous.then(save, save)
    previous = current.then(() => undefined, () => undefined)
    return current
  }
}
