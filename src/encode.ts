import { Mp4Encoder } from './Mp4Encoder'
import { createReadableStream, readStream } from './utils'
import type { Mp4EncoderEncodeSource, Mp4EncoderOptions } from './Mp4Encoder'

export type EncodeSource =
  | Mp4EncoderEncodeSource
  | Array<Mp4EncoderEncodeSource>
  | ReadableStream<Mp4EncoderEncodeSource>

export interface Mp4EncodeOptions extends Mp4EncoderOptions {
  frames: EncodeSource
}

export function encode(options: Mp4EncodeOptions): Promise<Blob> {
  return new Promise(resolve => {
    const { frames, ...restOptions } = options
    const encoder = new Mp4Encoder(restOptions)
    readStream(createReadableStream(frames), {
      onRead: frame => encoder.encode(frame),
      onDone: async () => resolve(await encoder.flush()),
    })
  })
}
