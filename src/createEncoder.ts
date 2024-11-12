import type { Mp4EncoderOptions } from './Mp4Encoder'
import { Mp4Encoder } from './Mp4Encoder'

export function createEncoder(options?: Mp4EncoderOptions): Mp4Encoder {
  return new Mp4Encoder(options)
}
