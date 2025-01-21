import type { MP4EncoderEncodeSource, MP4EncoderOptions } from './MP4Encoder'
import { MP4Encoder } from './MP4Encoder'
import { createReadableStream, readStream } from './utils'

export type EncodeSource =
  | MP4EncoderEncodeSource
  | Array<MP4EncoderEncodeSource>
  | ReadableStream<MP4EncoderEncodeSource>

export interface MP4EncodeOptions extends MP4EncoderOptions {
  frames: EncodeSource
}

export function encode(options: MP4EncodeOptions): Promise<Blob> {
  return new Promise((resolve) => {
    const { frames, ...restOptions } = options
    const encoder = new MP4Encoder(restOptions)
    readStream(createReadableStream(frames), {
      onRead: frame => encoder.encode(frame),
      onDone: async () => resolve(await encoder.flush()),
    })
  })
}
