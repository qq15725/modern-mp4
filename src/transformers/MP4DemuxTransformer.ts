import type { MP4ArrayBuffer, MP4File, MP4Info, Sample } from 'mp4box'
import { createFile } from 'mp4box'
import { requestIdleCallback } from '../utils'

export interface MP4DemuxTransformerOutputReady {
  type: 'ready'
  data: {
    info: MP4Info
    file: MP4File
  }
}

export interface MP4DemuxTransformerOutputSamples {
  type: 'samples'
  data: {
    id: number
    type: 'video' | 'audio'
    samples: Sample[]
  }
}

export type MP4DemuxTransformerOutput =
  | MP4DemuxTransformerOutputReady
  | MP4DemuxTransformerOutputSamples

export interface MP4DemuxTransformerOptions {
  onInfo?: (info: MP4Info) => void
}

export class MP4DemuxTransformer implements ReadableWritablePair<MP4DemuxTransformerOutput, BufferSource> {
  protected _file: MP4File
  protected _rsControler?: ReadableStreamDefaultController<MP4DemuxTransformerOutput>
  protected _rsCancelled = false
  protected _wsOffset = 0

  get info(): MP4Info { return this._file.getInfo() as MP4Info }

  readable = new ReadableStream<MP4DemuxTransformerOutput>({
    start: controler => this._rsControler = controler,
    cancel: () => {
      this._file.stop()
      this._rsControler = undefined
      this._rsCancelled = true
    },
  })

  writable = new WritableStream<BufferSource>({
    write: (input) => {
      if (this._rsCancelled) {
        this.writable.abort()
        return
      }
      let buffer: MP4ArrayBuffer
      if (ArrayBuffer.isView(input)) {
        buffer = input.buffer as any
      }
      else {
        buffer = input as any
      }
      buffer.fileStart = this._wsOffset
      this._wsOffset += buffer.byteLength
      this._file.appendBuffer(buffer)
    },
    close: () => {
      this._file.flush()
      this._rsControler?.close()
      requestIdleCallback(() => {
        this.info.tracks.forEach((track) => {
          this._file.releaseUsedSamples(track.id, track.nb_samples)
        })
      })
    },
    abort: () => this._rsControler?.close(),
  })

  constructor(
    public _options: MP4DemuxTransformerOptions = {},
  ) {
    const file = createFile()

    file.onReady = (info) => {
      info.videoTracks.forEach((track) => {
        file.setExtractionOptions(track.id, 'video', { nbSamples: 100 })
      })
      info.videoTracks.forEach((track) => {
        file.setExtractionOptions(track.id, 'audio', { nbSamples: 100 })
      })
      this._options.onInfo?.(info)
      this._rsControler?.enqueue({ type: 'ready', data: { info, file } })
      file.start()
    }

    file.onSamples = (id, type, samples) => {
      this._rsControler?.enqueue({ type: 'samples', data: { id, type, samples } })
    }

    this._file = file
  }
}
