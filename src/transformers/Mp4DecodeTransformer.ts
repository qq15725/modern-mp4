import { DataStream } from 'mp4box'
import type { MP4AudioTrack, MP4VideoTrack, Sample } from 'mp4box'
import type { Mp4DemuxTransformerOutput } from './Mp4DemuxTransformer'

export interface Mp4DecodeTransformerOutputVideoFrame {
  type: 'video'
  keyFrame: boolean
  codedHeight: number
  codedRect: DOMRectReadOnly | null
  codedWidth: number
  colorSpace: VideoColorSpace
  displayHeight: number
  displayWidth: number
  duration: number
  format: string | null
  timestamp: number
  visibleRect: DOMRectReadOnly | null
  timescale: number
  data: ImageBitmap
}

export type Mp4DecodeTransformerInput = Mp4DemuxTransformerOutput
export type Mp4DecodeTransformerOutput = Mp4DecodeTransformerOutputVideoFrame

export interface Mp4DecodeTransformerOptions {
  audio?: boolean
  startTime?: number
  endTime?: number
  framerate?: number
  filter?: (timestamp: number, duration: number) => boolean
  onProgress?: (current: number, total: number) => void
  onFrame?: (frame: Mp4DecodeTransformerOutput) => void
}

export class Mp4DecodeTransformer implements ReadableWritablePair<Mp4DecodeTransformerOutput, Mp4DecodeTransformerInput> {
  protected _videoQueueSize = 0
  protected _samples: Array<Sample> = []
  protected _rsControler?: ReadableStreamDefaultController<Mp4DecodeTransformerOutput>
  protected _rsCancelled = false

  protected _videoTrack?: MP4VideoTrack
  protected _videoCurrentTime = 0
  protected _videoCurrentSampleIndex = 0
  protected _videoDecodingFrames = new Map<number, {
    duration?: number | undefined
    type: string
  }>()

  protected _audioTrack?: MP4AudioTrack

  protected _videoDecoder = new VideoDecoder({
    error: error => console.error('Failed to VideoDecoder', error),
    output: (rawFrame) => {
      const result = this._videoDecodingFrames.get(rawFrame.timestamp)
      if (!result) {
        rawFrame.close()
        return
      }
      const { type, duration } = result
      this._videoDecodingFrames.delete(rawFrame.timestamp)
      const frame = {
        type: 'video',
        keyFrame: type === 'key',
        codedHeight: rawFrame.codedHeight,
        codedRect: rawFrame.codedRect,
        codedWidth: rawFrame.codedWidth,
        colorSpace: rawFrame.colorSpace,
        displayHeight: rawFrame.displayHeight,
        displayWidth: rawFrame.displayWidth,
        duration: duration ?? 0,
        format: rawFrame.format,
        timestamp: rawFrame.timestamp,
        visibleRect: rawFrame.visibleRect,
        timescale: this._videoTrack?.timescale ?? 1,
      } as Mp4DecodeTransformerOutputVideoFrame
      createImageBitmap(rawFrame).then(data => {
        frame.data = data
        this._rsControler?.enqueue(frame)
        this._options.onFrame?.(frame)
        this._updateProgress()
      })
      rawFrame.close()
    },
  })

  protected _audioDecoder = new AudioDecoder({
    error: error => console.error('Failed to AudioDecoder', error),
    output: () => {
      // TODO
    },
  })

  readable = new ReadableStream<Mp4DecodeTransformerOutput>({
    start: controler => this._rsControler = controler,
    cancel: () => {
      this._videoDecoder.close()
      this._videoDecodingFrames.clear()
      this._rsCancelled = true
    },
  })

  writable = new WritableStream<Mp4DecodeTransformerInput>({
    write: async chunk => {
      if (this._rsCancelled) {
        this.writable.abort()
        return
      }
      switch (chunk.type) {
        case 'ready': {
          const { info, file } = chunk.data
          const videoTrack = info.videoTracks[0]
          this._videoTrack = videoTrack
          if (videoTrack) {
            this._videoDecoder.configure({
              codec: videoTrack.codec,
              codedWidth: videoTrack.track_width,
              codedHeight: videoTrack.track_height,
              description: this._toVideoDecoderDescription(file.moov?.traks[0]),
            })
          }
          if (this._options.audio === false) {
            const audioTrack = info.audioTracks[0]
            this._audioTrack = audioTrack
            if (audioTrack) {
              this._audioDecoder.configure({
                codec: audioTrack.codec,
                sampleRate: audioTrack.audio.sample_rate,
                numberOfChannels: audioTrack.audio.channel_count,
              })
            }
          }
          break
        }
        case 'samples': {
          const { type, samples } = chunk.data
          switch (type) {
            case 'video': {
              const offset = this._samples.length
              this._videoQueueSize += samples.length
              for (let len = samples.length, i = 0; i < len; i++) {
                const sample = samples[i]
                this._samples.push(sample)
                if (sample.is_sync) this._videoCurrentSampleIndex = offset + i
                if (this._skippedVideoSample(
                  sample.cts / sample.timescale * 1_000,
                  sample.duration / sample.timescale * 1_000,
                )) {
                  continue
                }
                if (i === 0) sample.cts = 0
                const init = this._toEncodedVideoChunkInit(sample)
                let duration = init.duration!
                for (let j = this._videoCurrentSampleIndex; j < (offset + i); j++) {
                  const _init = this._toEncodedVideoChunkInit(this._samples[j])
                  this._videoDecoder.decode(new EncodedVideoChunk(_init))
                  duration += _init.duration!
                }
                this._videoDecoder.decode(new EncodedVideoChunk(init))
                if (!this._videoDecodingFrames.has(init.timestamp)) {
                  this._videoDecodingFrames.set(init.timestamp, {
                    type: init.type,
                    duration,
                  })
                }
                this._videoCurrentSampleIndex = offset + i + 1
                if (this._options.framerate) {
                  this._videoCurrentTime += 1000 / this._options.framerate
                }
              }
              break
            }
            case 'audio': {
              // TODO
              break
            }
          }
          break
        }
      }
    },
    close: async () => {
      this._samples.length = 0
      this._videoQueueSize = this._videoDecoder.decodeQueueSize
      await Promise.all([
        this._videoDecoder.state === 'configured' ? this._videoDecoder.flush() : null,
        this._audioDecoder.state === 'configured' ? this._audioDecoder.flush() : null,
      ])
      this._rsControler?.close()
    },
  })

  constructor(
    protected _options: Mp4DecodeTransformerOptions = {},
  ) {
    //
  }

  protected _updateProgress(): void {
    this._options.onProgress?.(
      this._videoQueueSize - this._videoDecoder.decodeQueueSize,
      this._videoQueueSize,
    )
  }

  protected _skippedVideoSample(timestamp: number, duration: number): boolean {
    const {
      startTime,
      endTime,
      filter,
    } = this._options

    return (startTime !== undefined && startTime > timestamp)
      || (endTime !== undefined && endTime < timestamp)
      || filter?.(timestamp, duration) === false
      || timestamp < this._videoCurrentTime
  }

  protected _toEncodedVideoChunkInit(sample: Sample): EncodedVideoChunkInit {
    return {
      type: sample.is_sync ? 'key' : 'delta',
      timestamp: sample.cts,
      duration: sample.duration,
      data: sample.data,
    }
  }

  protected _toVideoDecoderDescription(track: any | undefined): Uint8Array | undefined {
    if (!track) return undefined
    for (const entry of track.mdia.minf.stbl.stsd.entries) {
      if (entry.avcC || entry.hvcC) {
        const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN)
        if (entry.avcC) {
          entry.avcC.write(stream)
        } else {
          entry.hvcC.write(stream)
        }
        return new Uint8Array(stream.buffer, 8) // Remove the box header.
      }
    }
    return undefined
  }
}
