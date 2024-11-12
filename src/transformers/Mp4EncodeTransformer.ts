import type { MP4Info } from 'mp4box'

export type Mp4EncodeTransformerInputNetworkImage = { data: string } & VideoEncoderEncodeOptions & VideoFrameInit
export type Mp4EncodeTransformerInputCanvasImage = { data: CanvasImageSource } & VideoEncoderEncodeOptions & VideoFrameInit
export type Mp4EncodeTransformerInputVideoFrame = { data: VideoFrame } & VideoEncoderEncodeOptions
export type Mp4EncodeTransformerInputAudioData = AudioData
export type Mp4EncodeTransformerInput =
  | Mp4EncodeTransformerInputNetworkImage
  | Mp4EncodeTransformerInputCanvasImage
  | Mp4EncodeTransformerInputVideoFrame
  | Mp4EncodeTransformerInputAudioData

export interface Mp4EncodeTransformerOutputVideo {
  type: 'video'
  chunk: EncodedVideoChunk
  meta: EncodedVideoChunkMetadata
}
export interface Mp4EncodeTransformerOutputAudio {
  type: 'audio'
  chunk: EncodedAudioChunk
  meta: EncodedAudioChunkMetadata
}
export type Mp4EncodeTransformerOutput =
  | Mp4EncodeTransformerOutputVideo
  | Mp4EncodeTransformerOutputAudio

export interface Mp4EncodeTransformerOptions {
  width?: number
  height?: number
  framerate?: number
  videoCodec?: string
  videoBitrate?: number
  audio?: boolean
  audioCodec?: string
  audioBitrate?: number
  audioSampleRate?: number
  audioChannelCount?: number
  info?: MP4Info
  onProgress?: (current: number, total: number) => void
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(img)
    img.src = src
  })
}

export class Mp4EncodeTransformer implements ReadableWritablePair<Mp4EncodeTransformerOutput, Mp4EncodeTransformerInput> {
  protected _videoQueueSize = 0
  protected _audioQueueSize = 0
  protected _rsControler?: ReadableStreamDefaultController<Mp4EncodeTransformerOutput>
  protected _rsCancelled = false
  protected _wsLastCanvasImageSource?: CanvasImageSource
  protected _wsFrameTimestamp = 1

  protected _videoEncoder = new VideoEncoder({
    error: error => console.error('Failed to VideoEncoder', error),
    output: (chunk, meta) => {
      this._rsControler?.enqueue({ type: 'video', chunk, meta: meta! })
      this._updateProgress()
    },
  })

  protected _audioEncoder = new AudioEncoder({
    error: error => console.error('Failed to AudioEncoder', error),
    output: (chunk, meta) => {
      this._rsControler?.enqueue({ type: 'audio', chunk, meta })
      this._updateProgress()
    },
  })

  protected static _getVideoEncoderConfig(options: Mp4EncodeTransformerOptions): VideoEncoderConfig {
    const { width, height, framerate, videoCodec, videoBitrate, info } = options
    const videoTrack = info?.videoTracks[0]
    if (info && videoTrack) {
      const duration = (info.duration / info.timescale) * 1_000
      return {
        codec: videoCodec || 'avc1.4D0032',
        framerate: framerate || Math.ceil(1_000 / (duration / videoTrack.nb_samples)),
        bitrate: videoBitrate || videoTrack.bitrate!,
        width: width || videoTrack.track_width,
        height: height || videoTrack.track_height,
        avc: { format: 'avc' },
      }
    }
    return {
      codec: videoCodec || 'avc1.4D0032',
      framerate: framerate || 30,
      bitrate: videoBitrate || 2_000_000,
      width: width || 0,
      height: height || 0,
      avc: { format: 'avc' },
    }
  }

  protected static _getAudioEncoderConfig(options: Mp4EncodeTransformerOptions): AudioEncoderConfig {
    const { audioCodec, audioBitrate, audioSampleRate, audioChannelCount, info } = options
    const audioTrack = info?.audioTracks[0]
    if (audioTrack) {
      return {
        codec: (audioCodec || audioTrack.codec) === 'aac' ? 'mp4a.40.2' : 'opus',
        sampleRate: audioSampleRate || audioTrack.audio.sample_rate,
        numberOfChannels: audioChannelCount || audioTrack.audio.channel_count,
        bitrate: audioBitrate || audioTrack.bitrate,
      }
    }
    return {
      codec: (audioCodec || 'aac') === 'aac' ? 'mp4a.40.2' : 'opus',
      sampleRate: audioSampleRate || 48_000,
      numberOfChannels: audioChannelCount || 2,
      bitrate: audioBitrate || 128_000,
    }
  }

  static async isConfigSupported(options: Mp4EncodeTransformerOptions = {}): Promise<boolean> {
    try {
      return Boolean((await VideoEncoder.isConfigSupported(this._getVideoEncoderConfig(options))).supported)
        && (
          options.audio === false
          || Boolean((await AudioEncoder.isConfigSupported(this._getAudioEncoderConfig(options))).supported)
        )
    }
    catch (error) {
      console.warn(error)
      return false
    }
  }

  readable = new ReadableStream<Mp4EncodeTransformerOutput>({
    start: controler => this._rsControler = controler,
    cancel: () => {
      this._videoEncoder.close()
      this._audioEncoder.close()
      this._rsControler = undefined
      this._rsCancelled = true
    },
  })

  writable = new WritableStream<Mp4EncodeTransformerInput>({
    write: async (input) => {
      if (this._rsCancelled) {
        this.writable.abort()
      }
      await this._encode(input)
      if (input instanceof AudioData) {
        this._audioQueueSize++
      }
      else {
        this._videoQueueSize++
      }
    },
    close: async () => {
      if (this._wsLastCanvasImageSource) {
        await this._encode({
          data: this._wsLastCanvasImageSource,
          timestamp: this._wsFrameTimestamp,
          keyFrame: false,
          duration: 1,
        })
      }
      this._videoQueueSize = this._videoEncoder.encodeQueueSize
      this._audioQueueSize = this._audioEncoder.encodeQueueSize
      await Promise.all([
        this._videoEncoder.state === 'configured' ? this._videoEncoder.flush() : null,
        this._audioEncoder.state === 'configured' ? this._audioEncoder.flush() : null,
      ])
      this._rsControler?.close()
    },
  })

  constructor(
    protected _options: Mp4EncodeTransformerOptions = {},
  ) {
    this._videoEncoder.configure(Mp4EncodeTransformer._getVideoEncoderConfig(_options))
    this._audioEncoder.configure(Mp4EncodeTransformer._getAudioEncoderConfig(_options))
  }

  protected async _encode(input: Mp4EncodeTransformerInput): Promise<void> {
    if (input instanceof AudioData) {
      this._audioEncoder.encode(input)
      input.close()
    }
    else {
      const { data, ...options } = input
      if (data instanceof VideoFrame) {
        this._videoEncoder.encode(data, options)
        this._wsFrameTimestamp += data.duration ?? 0
        data.close()
      }
      else if (typeof data === 'string') {
        return this._encode({ data: await loadImage(data), ...options })
      }
      else {
        const {
          keyFrame = this._wsFrameTimestamp === 1,
          ...frameInit
        } = options as Record<string, any>
        if (typeof frameInit.duration === 'undefined')
          frameInit.duration = 1
        if (typeof frameInit.timestamp === 'undefined')
          frameInit.timestamp = this._wsFrameTimestamp
        const frame = new VideoFrame(data, frameInit)
        if (data instanceof ImageBitmap) {
          data.close()
        }
        else {
          this._wsLastCanvasImageSource = data as any
        }
        return this._encode({
          data: frame,
          keyFrame,
        })
      }
    }
  }

  protected _updateProgress(): void {
    const total = this._videoQueueSize + this._audioQueueSize
    const current = this._videoEncoder.encodeQueueSize + this._audioEncoder.encodeQueueSize
    this._options.onProgress?.(total - current, total)
  }

  protected _getVideoEncoderConfig(): VideoEncoderConfig {
    const { width, height, framerate, videoCodec, videoBitrate, info } = this._options
    const videoTrack = info?.videoTracks[0]
    if (info && videoTrack) {
      const duration = (info.duration / info.timescale) * 1_000
      return {
        codec: videoCodec || 'avc1.4D0032',
        framerate: framerate || Math.ceil(1_000 / (duration / videoTrack.nb_samples)),
        bitrate: videoBitrate || videoTrack.bitrate!,
        width: width || videoTrack.track_width,
        height: height || videoTrack.track_height,
        avc: { format: 'avc' },
      }
    }
    return {
      codec: videoCodec || 'avc1.4D0032',
      framerate: framerate || 30,
      bitrate: videoBitrate || 2_000_000,
      width: width || 0,
      height: height || 0,
      avc: { format: 'avc' },
    }
  }
}
