import type {
  MP4EncodeTransformerInput,
  MP4EncodeTransformerOptions,
  MP4MuxTransformerOptions,
} from './transformers'
import {
  MP4EncodeTransformer,
  MP4MuxTransformer,
} from './transformers'
import { readStream } from './utils'

export interface MP4EncoderOptions extends MP4EncodeTransformerOptions, MP4MuxTransformerOptions {
  //
}

export type MP4EncoderEncodeSource = MP4EncodeTransformerInput

export class MP4Encoder {
  protected _controler?: ReadableStreamDefaultController<MP4EncoderEncodeSource>
  protected _encoder: MP4EncodeTransformer

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
    this._encoder = new MP4EncodeTransformer(options)
    this.readable = new ReadableStream({
      start: controler => this._controler = controler,
    })
      .pipeThrough(this._encoder)
      .pipeThrough(new MP4MuxTransformer(options))
  }

  static isConfigSupported(options?: MP4EncoderOptions): Promise<boolean> {
    return MP4EncodeTransformer.isConfigSupported(options)
  }

  encode(frame: MP4EncoderEncodeSource): void {
    this._controler?.enqueue(frame)
  }

  flush(): Promise<Blob> {
    return new Promise((resolve) => {
      let result: ArrayBuffer
      readStream(this.readable, {
        onRead: _result => result = _result,
        onDone: () => resolve(new Blob([result], { type: 'video/MP4' })),
      })
      this._controler?.close()
    })
  }
}
