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
  protected _error?: unknown
  protected _wsLastCanvasImageSource?: CanvasImageSource
  protected _wsFrameTimestamp = 1

  protected _videoEncoder = new VideoEncoder({
    error: error => this._rsControler?.error(error),
    output: (chunk, meta) => {
      this._rsControler?.enqueue({ type: 'video', chunk, meta: meta! })
      this._updateProgress()
    },
  })

  protected _audioEncoder?: AudioEncoder

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
        codec: !audioCodec || audioCodec === 'aac' ? 'mp4a.40.2' : audioCodec,
        sampleRate: audioSampleRate || audioTrack.audio.sample_rate,
        numberOfChannels: audioChannelCount || audioTrack.audio.channel_count,
        bitrate: audioBitrate || audioTrack.bitrate,
      }
    }
    return {
      codec: !audioCodec || audioCodec === 'aac' ? 'mp4a.40.2' : audioCodec,
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
    cancel: (reason) => {
      this._error = reason
      if (this._videoEncoder.state !== 'closed')
        this._videoEncoder.close()
      if (this._audioEncoder && this._audioEncoder.state !== 'closed')
        this._audioEncoder.close()
      this._rsControler = undefined
      this._rsCancelled = true
    },
  })

  writable = new WritableStream<MP4EncodeTransformerInput>({
    write: async (input) => {
      if (this._rsCancelled) {
        throw this._error ?? new Error('Encoding cancelled')
      }
      await this._encode(input)
      if (typeof AudioData !== 'undefined' && input instanceof AudioData) {
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
      this._audioQueueSize = (this._audioEncoder?.encodeQueueSize ?? 0)
      await Promise.all([
        this._videoEncoder.state === 'configured' ? this._videoEncoder.flush() : null,
        this._audioEncoder?.state === 'configured' ? this._audioEncoder.flush() : null,
      ])
      if (this._videoEncoder.state !== 'closed')
        this._videoEncoder.close()
      if (this._audioEncoder && this._audioEncoder.state !== 'closed')
        this._audioEncoder.close()
      this._rsControler?.close()
    },
    abort: (reason) => {
      if (this._videoEncoder.state !== 'closed')
        this._videoEncoder.close()
      if (this._audioEncoder && this._audioEncoder.state !== 'closed')
        this._audioEncoder.close()
      this._rsControler?.error(reason)
    },
  })

  constructor(
    protected _options: MP4EncodeTransformerOptions = {},
  ) {
    this._videoEncoder.configure(MP4EncodeTransformer.getVideoEncoderConfig(_options))
    if (_options.audio !== false) {
      this._audioEncoder = new AudioEncoder({
        error: error => this._rsControler?.error(error),
        output: (chunk, meta) => {
          this._rsControler?.enqueue({ type: 'audio', chunk, meta: meta ?? {} })
          this._updateProgress()
        },
      })
      this._audioEncoder.configure(MP4EncodeTransformer.getAudioEncoderConfig(_options))
    }
  }

  protected async _encode(input: MP4EncodeTransformerInput): Promise<void> {
    if (typeof AudioData !== 'undefined' && input instanceof AudioData) {
      try {
        if (!this._audioEncoder)
          throw new Error('Audio encoding is disabled')
        this._audioEncoder.encode(input)
        await this._waitForQueue(this._audioEncoder, 32)
      }
      finally {
        input.close()
      }
    }
    else {
      const { data, ...options } = input as Exclude<MP4EncodeTransformerInput, AudioData>
      if (data instanceof VideoFrame) {
        this._videoEncoder.encode(data, options)
        this._wsFrameTimestamp = (data.timestamp + (data.duration ?? 0)) / 1000
        data.close()
        await this._waitForQueue(this._videoEncoder, 8)
      }
      else if (typeof data === 'string') {
        return this._encode({ data: await loadImage(data), ...options })
      }
      else {
        const {
          keyFrame = this._videoQueueSize === 0,
          ...frameInit
        } = options as Record<string, any>
        if (typeof frameInit.duration === 'undefined')
          frameInit.duration = 1
        if (typeof frameInit.timestamp === 'undefined')
          frameInit.timestamp = this._wsFrameTimestamp
        // Canvas 输入沿用公开 API 的毫秒；WebCodecs 的 VideoFrame/AudioData 使用微秒。
        frameInit.timestamp = Math.round(frameInit.timestamp * 1000)
        frameInit.duration = Math.round(frameInit.duration * 1000)
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

  protected async _waitForQueue(encoder: VideoEncoder | AudioEncoder, limit: number): Promise<void> {
    if (encoder.encodeQueueSize <= limit)
      return
    await new Promise<void>((resolve, reject) => {
      const onDequeue = (): void => {
        if (encoder.state === 'closed' || encoder.encodeQueueSize <= limit) {
          encoder.removeEventListener('dequeue', onDequeue)
          if (encoder.state === 'closed')
            reject(this._error ?? new Error('Encoder closed'))
          else
            resolve()
        }
      }
      encoder.addEventListener('dequeue', onDequeue)
      onDequeue()
    })
  }

  protected _updateProgress(): void {
    const total = this._videoQueueSize + this._audioQueueSize
    const current = this._videoEncoder.encodeQueueSize + (this._audioEncoder?.encodeQueueSize ?? 0)
    this._options.onProgress?.(total - current, total)
  }
}
