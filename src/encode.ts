import { Encoder } from './Encoder'
import type { EncoderOptions } from './Encoder'

export interface EncodeOptions extends EncoderOptions {
  frame: Array<{
    data: CanvasImageSource
    duration: number
  } | VideoFrame>
}

function loadImage(src: string) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(img)
    img.src = src
  })
}

export async function encode(
  options: EncoderOptions & {
    frames: Array<
      (VideoEncoderEncodeOptions & VideoFrameInit & { data: string })
      | (VideoEncoderEncodeOptions & VideoFrameInit & { data: CanvasImageSource })
      | (VideoEncoderEncodeOptions & { data: VideoFrame })
      | AudioData
    >
  },
): Promise<ArrayBuffer> {
  const encoder = new Encoder(options)
  for (let len = options.frames.length, i = 0; i < len; i++) {
    // @ts-expect-error let
    // eslint-disable-next-line prefer-const
    let { data, ...rest } = options.frames[i]
    if (typeof data === 'string') {
      data = await loadImage(data)
    }
    encoder.encode(data, rest)
  }
  return encoder.flush()
}
