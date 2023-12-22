import {
  Mp4EncodeTransformer,
  Mp4MuxTransformer,
} from './transformers'
import { readStream } from './utils'
import type {
  Mp4EncodeTransformerInput,
  Mp4EncodeTransformerOptions,
  Mp4MuxTransformerOptions,
} from './transformers'

export interface Mp4EncoderOptions extends Mp4EncodeTransformerOptions, Mp4MuxTransformerOptions {
  //
}

export type Mp4EncoderEncodeSource = Mp4EncodeTransformerInput

export class Mp4Encoder {
  protected _controler?: ReadableStreamDefaultController<Mp4EncoderEncodeSource>
  protected _encoder: Mp4EncodeTransformer

  readable: ReadableStream

  constructor(options?: Mp4EncoderOptions) {
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
    this._encoder = new Mp4EncodeTransformer(options)
    this.readable = new ReadableStream({
      start: controler => this._controler = controler,
    })
      .pipeThrough(this._encoder)
      .pipeThrough(new Mp4MuxTransformer(options))
  }

  isConfigSupported(): Promise<boolean> {
    return this._encoder.isConfigSupported()
  }

  encode(frame: Mp4EncoderEncodeSource): void {
    this._controler?.enqueue(frame)
  }

  flush(): Promise<Blob> {
    return new Promise(resolve => {
      let result: ArrayBuffer
      readStream(this.readable, {
        onRead: _result => result = _result,
        onDone: () => resolve(new Blob([result], { type: 'video/mp4' })),
      })
      this._controler?.close()
    })
  }
}
