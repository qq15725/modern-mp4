import type { MP4DecoderFlushResult, MP4DecoderOptions } from './MP4Decoder'
import { MP4Decoder } from './MP4Decoder'
import { createReadableStream, readStream } from './utils'

export type DecodeSource =
  | string
  | BufferSource
  | Blob
  | Array<BufferSource>
  | ReadableStream<BufferSource>

export interface MP4DecodeOptions extends MP4DecoderOptions {
  data: DecodeSource
}

export type MP4DecodeResult = MP4DecoderFlushResult

export async function decode(options: MP4DecodeOptions): Promise<MP4DecodeResult> {
  let { data, ...restOptions } = options
  const decoder = new MP4Decoder(restOptions)
  if (typeof data === 'string') {
    data = (await fetch(data).then(res => res.body)) as ReadableStream<Uint8Array>
  }
  else if (data instanceof Blob) {
    data = await data.arrayBuffer()
  }
  const rs = createReadableStream(data) as ReadableStream<Uint8Array>
  return new Promise((resolve) => {
    readStream(rs, {
      onRead: buffer => decoder.decode(buffer),
      onDone: async () => resolve(await decoder.flush()),
    })
  })
}
