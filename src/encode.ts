import { Encoder } from './Encoder'
import type { EncoderOptions } from './Encoder'

export interface EncodeOptions extends EncoderOptions {
  frames: Array<
    (VideoEncoderEncodeOptions & VideoFrameInit & { data: string })
    | (VideoEncoderEncodeOptions & VideoFrameInit & { data: CanvasImageSource })
    | (VideoEncoderEncodeOptions & { data: VideoFrame })
    | { data: AudioData }
  >
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(img)
    img.src = src
  })
}

function resolveInitOptions(options: VideoEncoderEncodeOptions & VideoFrameInit, timestamp: number): number {
  if (typeof options.keyFrame === 'undefined') options.keyFrame = true
  if (typeof options.duration === 'undefined') options.duration = 3000
  if ('timestamp' in options) options.timestamp! *= 1000
  if ('duration' in options) options.duration! *= 1000
  if (typeof options.timestamp === 'undefined') options.timestamp = timestamp
  timestamp += options.duration
  return timestamp
}

export async function encode(options: EncodeOptions): Promise<ArrayBuffer> {
  const { frames, ...encoderOptions } = options

  const encoder = new Encoder(encoderOptions)

  let timestamp = 1
  for (let len = frames.length, i = 0; i < len; i++) {
    // eslint-disable-next-line prefer-const
    let { data, ...restOptions } = frames[i]
    if (data instanceof AudioData) {
      encoder.encode(data)
    } else {
      if (typeof data === 'string') {
        data = await loadImage(data)
        timestamp = resolveInitOptions(restOptions as any, timestamp)
      }
      encoder.encode(data as any, restOptions)
    }
  }

  if (timestamp > 1) {
    let { data } = frames[frames.length - 1]
    if (typeof data === 'string') {
      data = await loadImage(data)
      encoder.encode(data, { timestamp, keyFrame: true, duration: 1 })
    }
  }

  return encoder.flush()
}
