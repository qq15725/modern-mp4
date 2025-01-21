import type { MP4EncoderOptions } from './MP4Encoder'
import { MP4Encoder } from './MP4Encoder'

export function createEncoder(options?: MP4EncoderOptions): MP4Encoder {
  return new MP4Encoder(options)
}
