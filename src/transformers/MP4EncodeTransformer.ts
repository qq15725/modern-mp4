import type { MP4Info } from 'mp4box'

export type MP4EncodeTransformerInputNetworkImage = { data: string } & VideoEncoderEncodeOptions & VideoFrameInit
export type MP4EncodeTransformerInputCanvasImage = { data: CanvasImageSource } & VideoEncoderEncodeOptions & VideoFrameInit
export type MP4EncodeTransformerInputVideoFrame = { data: VideoFrame } & VideoEncoderEncodeOptions
export type MP4EncodeTransformerInputAudioData = AudioData
export type MP4EncodeTransformerInput =
  | MP4EncodeTransformerInputNetworkImage
  | MP4EncodeTransformerInputCanvasImage
  | MP4EncodeTransformerInputVideoFrame
  | MP4EncodeTransformerInputAudioData

export interface MP4EncodeTransformerOutputVideo {
  type: 'video'
  chunk: EncodedVideoChunk
  meta: EncodedVideoChunkMetadata
}
export interface MP4EncodeTransformerOutputAudio {
  type: 'audio'
  chunk: EncodedAudioChunk
  meta: EncodedAudioChunkMetadata
}
export type MP4EncodeTransformerOutput =
  | MP4EncodeTransformerOutputVideo
  | MP4EncodeTransformerOutputAudio

export interface MP4EncodeTransformerOptions {
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

export class MP4EncodeTransformer implements ReadableWritablePair<MP4EncodeTransformerOutput, MP4EncodeTransformerInput> {
  protected _videoQueueSize = 0
  protected _audioQueueSize = 0
  protected _rsControler?: ReadableStreamDefaultController<MP4EncodeTransformerOutput>
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
      if (meta) {
        this._rsControler?.enqueue({ type: 'audio', chunk, meta })
      }
      this._updateProgress()
    },
  })

  static getDefaultVideoBitrate(width: number, height: number, framerate: number): number {
    const baseBitrateMap = {
      '720p': 3_000_000, // 3 Mbps
      '1080p': 6_000_000, // 6 Mbps
      '1440p': 12_000_000, // 12 Mbps
      '2160p': 20_000_000, // 20 Mbps
    }
    const resolutionLabel
      = width <= 1280 && height <= 720
        ? '720p'
        : width <= 1920 && height <= 1080
          ? '1080p'
          : width <= 2560 && height <= 1440
            ? '1440p'
            : '2160p'
    const baseBitrate = baseBitrateMap[resolutionLabel]
    return Math.round(baseBitrate * (framerate / 30))
  }

  static getVideoEncoderConfig(options: MP4EncodeTransformerOptions): VideoEncoderConfig {
    let { width, height, framerate, videoCodec, videoBitrate, info } = options
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
    width = width || 0
    height = height || 0
    framerate = framerate || 30
    const bitrate = videoBitrate || this.getDefaultVideoBitrate(width, height, framerate)
    return {
      codec: videoCodec || 'avc1.4D0032',
      framerate,
      bitrate,
      width,
      height,
      avc: { format: 'avc' },
    }
  }

  static getAudioEncoderConfig(options: MP4EncodeTransformerOptions): AudioEncoderConfig {
    const { audioCodec, audioBitrate, audioSampleRate, audioChannelCount, info } = options
    const audioTrack = info?.audioTracks[0]
    if (audioTrack) {
      return {
        codec: (audioCodec || audioTrack.codec) === 'aac' ? 'MP4a.40.2' : 'opus',
        sampleRate: audioSampleRate || audioTrack.audio.sample_rate,
        numberOfChannels: audioChannelCount || audioTrack.audio.channel_count,
        bitrate: audioBitrate || audioTrack.bitrate,
      }
    }
    return {
      codec: (audioCodec || 'aac') === 'aac' ? 'MP4a.40.2' : 'opus',
      sampleRate: audioSampleRate || 48_000,
      numberOfChannels: audioChannelCount || 2,
      bitrate: audioBitrate || 128_000,
    }
  }

  static async isConfigSupported(options: MP4EncodeTransformerOptions = {}): Promise<boolean> {
    try {
      return Boolean((await VideoEncoder.isConfigSupported(this.getVideoEncoderConfig(options))).supported)
        && (
          options.audio === false
          || Boolean((await AudioEncoder.isConfigSupported(this.getAudioEncoderConfig(options))).supported)
        )
    }
    catch (error) {
      console.warn(error)
      return false
    }
  }

  readable = new ReadableStream<MP4EncodeTransformerOutput>({
    start: controler => this._rsControler = controler,
    cancel: () => {
      this._videoEncoder.close()
      this._audioEncoder.close()
      this._rsControler = undefined
      this._rsCancelled = true
    },
  })

  writable = new WritableStream<MP4EncodeTransformerInput>({
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
    protected _options: MP4EncodeTransformerOptions = {},
  ) {
    this._videoEncoder.configure(MP4EncodeTransformer.getVideoEncoderConfig(_options))
    this._audioEncoder.configure(MP4EncodeTransformer.getAudioEncoderConfig(_options))
  }

  protected async _encode(input: MP4EncodeTransformerInput): Promise<void> {
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
}
