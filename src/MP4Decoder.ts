import type { MP4Info } from 'mp4box'
import type {
  MP4DecodeTransformerOptions,
  MP4DecodeTransformerOutput,
  MP4DecodeTransformerOutputVideoFrame,
  MP4DemuxTransformerOptions,
} from './transformers'
import {
  MP4DecodeTransformer,
  MP4DemuxTransformer,
} from './transformers'
import { readStream } from './utils'

export interface MP4DecoderOptions extends MP4DemuxTransformerOptions, MP4DecodeTransformerOptions {
  videoFrames?: boolean
}

export interface MP4DecoderFlushResult {
  duration: number
  width: number
  height: number
  info: MP4Info
  frames: Array<MP4DecodeTransformerOutput>
  videoFrames: Array<MP4DecodeTransformerOutputVideoFrame>
  audioFrames: Array<AudioData>
}

export class MP4Decoder {
  protected _controler?: ReadableStreamDefaultController<BufferSource>
  protected _demuxer: MP4DemuxTransformer
  protected _videoFrames?: boolean

  readable: ReadableStream

  constructor(options?: MP4DecoderOptions) {
    let rs: any = new ReadableStream({
      start: controler => this._controler = controler,
    })
      .pipeThrough(
        this._demuxer = new MP4DemuxTransformer(options),
      )

    this._videoFrames = options?.videoFrames

    if (this._videoFrames !== false) {
      rs = rs.pipeThrough(new MP4DecodeTransformer(options))
    }

    this.readable = rs
  }

  decode(buffer: BufferSource): void {
    this._controler?.enqueue(buffer)
  }

  flush(): Promise<MP4DecoderFlushResult> {
    return new Promise((resolve) => {
      const frames: Array<MP4DecodeTransformerOutput> = []
      const videoFrames: Array<MP4DecodeTransformerOutputVideoFrame> = []
      readStream(this.readable, {
        onRead: (frame) => {
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
