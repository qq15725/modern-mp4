import type {
  MP4EncodeTransformerInput,
  MP4EncodeTransformerOptions,
  MP4MuxTransformerOptions,
} from './transformers'
import {
  MP4EncodeTransformer,
  MP4MuxTransformer,
} from './transformers'

export interface MP4EncoderOptions extends MP4EncodeTransformerOptions, MP4MuxTransformerOptions {
  //
}

export type MP4EncoderEncodeSource = MP4EncodeTransformerInput

export class MP4Encoder {
  protected _writer: WritableStreamDefaultWriter<MP4EncoderEncodeSource>

  readable: ReadableStream

  constructor(options?: MP4EncoderOptions) {
    if (options) {
      if (options.width !== undefined && Math.floor(options.width / 2) !== options.width / 2) {
        console.warn('width not divisible by 2')
        options.width = Math.floor(options.width / 2) * 2
      }
      if (options.height !== undefined && Math.floor(options.height / 2) !== options.height / 2) {
        console.warn('height not divisible by 2')
        options.height = Math.floor(options.height / 2) * 2
      }
    }
    const encoder = new MP4EncodeTransformer(options)
    this._writer = encoder.writable.getWriter()
    this.readable = encoder.readable.pipeThrough(new MP4MuxTransformer(options))
  }

  static isConfigSupported(options?: MP4EncoderOptions): Promise<boolean> {
    return MP4EncodeTransformer.isConfigSupported(options)
  }

  async encode(frame: MP4EncoderEncodeSource): Promise<void> {
    await this._writer.write(frame)
  }

  /** 将混音后的 PCM 分块编码，时间戳使用样本位置计算，避免累积舍入误差。 */
  async encodeAudioBuffer(buffer: AudioBuffer, start = 0, end = buffer.length): Promise<void> {
    for (let offset = start; offset < end; offset += 1024) {
      const count = Math.min(1024, end - offset)
      const data = new Float32Array(count * buffer.numberOfChannels)
      for (let channel = 0; channel < buffer.numberOfChannels; channel++)
        data.set(buffer.getChannelData(channel).subarray(offset, offset + count), channel * count)
      await this.encode(new AudioData({
        format: 'f32-planar',
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
        numberOfFrames: count,
        timestamp: Math.round(offset * 1_000_000 / buffer.sampleRate),
        data,
      }))
    }
  }

  async flush(): Promise<Blob> {
    const reader = this.readable.getReader()
    const chunks: ArrayBuffer[] = []
    const reading = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done)
            break
          chunks.push(value)
        }
      }
      finally {
        reader.releaseLock()
      }
    })()
    await Promise.all([this._writer.close(), reading])
    return new Blob(chunks, { type: 'video/mp4' })
  }

  async abort(reason?: unknown): Promise<void> {
    await Promise.allSettled([this._writer.abort(reason), this.readable.cancel(reason)])
  }
}
