import type { MP4DecoderOptions } from './MP4Decoder'
import { MP4Decoder } from './MP4Decoder'

export function createDecoder(options?: MP4DecoderOptions): MP4Decoder {
  return new MP4Decoder(options)
}
