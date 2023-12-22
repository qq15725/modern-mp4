import {
  Mp4DecodeTransformer,
  Mp4DemuxTransformer,
} from './transformers'
import { readStream } from './utils'
import type { MP4Info } from 'mp4box'
import type {
  Mp4DecodeTransformerOptions,
  Mp4DecodeTransformerOutput,
  Mp4DecodeTransformerOutputVideoFrame,
  Mp4DemuxTransformerOptions,
} from './transformers'

export interface Mp4DecoderOptions extends Mp4DemuxTransformerOptions, Mp4DecodeTransformerOptions {
  videoFrames?: boolean
}

export interface Mp4DecoderFlushResult {
  duration: number
  width: number
  height: number
  info: MP4Info
  frames: Array<Mp4DecodeTransformerOutput>
  videoFrames: Array<Mp4DecodeTransformerOutputVideoFrame>
  audioFrames: Array<AudioData>
}

export class Mp4Decoder {
  protected _controler?: ReadableStreamDefaultController<BufferSource>
  protected _demuxer: Mp4DemuxTransformer
  protected _videoFrames?: boolean

  readable: ReadableStream

  constructor(options?: Mp4DecoderOptions) {
    let rs: any = new ReadableStream({
      start: controler => this._controler = controler,
    })
      .pipeThrough(
        this._demuxer = new Mp4DemuxTransformer(options),
      )

    this._videoFrames = options?.videoFrames

    if (this._videoFrames !== false) {
      rs = rs.pipeThrough(new Mp4DecodeTransformer(options))
    }

    this.readable = rs
  }

  decode(buffer: BufferSource): void {
    this._controler?.enqueue(buffer)
  }

  flush(): Promise<Mp4DecoderFlushResult> {
    return new Promise(resolve => {
      const frames: Array<Mp4DecodeTransformerOutput> = []
      const videoFrames: Array<Mp4DecodeTransformerOutputVideoFrame> = []
      readStream(this.readable, {
        onRead: frame => {
          switch (frame.type) {
            case 'video':
              if (this._videoFrames !== false) {
                videoFrames.push(frame)
              }
              break
          }
          frames.push(frame)
        },
        onDone: () => {
          const info = this._demuxer.info!
          resolve({
            duration: info.duration / info.timescale * 1_000,
            width: info.videoTracks[0]?.track_width ?? 0,
            height: info.videoTracks[0]?.track_height ?? 0,
            info,
            audioFrames: [],
            videoFrames,
            frames,
          })
        },
      })
      this._controler?.close()
    })
  }
}
