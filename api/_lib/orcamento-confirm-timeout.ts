export type SettledWithin<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'timeout' }

export function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<SettledWithin<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve({ status: 'fulfilled', value })
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
