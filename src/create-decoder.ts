import { Mp4Decoder } from './Mp4Decoder'
import type { Mp4DecoderOptions } from './Mp4Decoder'

export function createDecoder(options?: Mp4DecoderOptions): Mp4Decoder {
  return new Mp4Decoder(options)
}
