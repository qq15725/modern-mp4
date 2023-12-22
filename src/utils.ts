export function createReadableStream<T>(source: T | Array<T> | ReadableStream<T>): ReadableStream<T> {
  if (source instanceof ReadableStream) {
    return source
  }
  return new ReadableStream({
    start: (controler) => {
      if (Array.isArray(source)) {
        for (let len = source.length, i = 0; i < len; i++) {
          controler.enqueue(source[i])
        }
      } else {
        controler.enqueue(source)
      }
      controler.close()
    },
  })
}

export function readStream<T extends ReadableStream>(
  stream: T,
  cbs: {
    onRead: T extends ReadableStream<infer D>
      ? (chunk: D) => Promise<void> | void
      : never
    onDone: () => void
  },
) {
  let stoped = false
  async function run() {
    const reader = stream.getReader()
    // eslint-disable-next-line no-unmodified-loop-condition
    while (!stoped) {
      const { value, done } = await reader.read()
      if (done) {
        cbs.onDone()
        return
      }
      await cbs.onRead(value)
    }
    reader.releaseLock()
    await stream.cancel()
  }
  run()
  return () => {
    stoped = true
  }
}
