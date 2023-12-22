import { Mp4Decoder } from './Mp4Decoder'
import { createReadableStream, readStream } from './utils'
import type { Mp4DecoderFlushResult, Mp4DecoderOptions } from './Mp4Decoder'

export type DecodeSource =
  | string
  | BufferSource
  | Blob
  | Array<BufferSource>
  | ReadableStream<BufferSource>

export interface Mp4DecodeOptions extends Mp4DecoderOptions {
  data: DecodeSource
}

export type Mp4DecodeResult = Mp4DecoderFlushResult

export async function decode(options: Mp4DecodeOptions): Promise<Mp4DecodeResult> {
  // eslint-disable-next-line prefer-const
  let { data, ...restOptions } = options
  const decoder = new Mp4Decoder(restOptions)
  if (typeof data === 'string') {
    data = (await fetch(data).then((res) => res.body)) as ReadableStream<Uint8Array>
  } else if (data instanceof Blob) {
    data = await data.arrayBuffer()
  }
  const rs = createReadableStream(data) as ReadableStream<Uint8Array>
  return new Promise(resolve => {
    readStream(rs, {
      onRead: buffer => decoder.decode(buffer),
      onDone: async () => resolve(await decoder.flush()),
    })
  })
}
