import { BoxParser, DataStream, createFile } from 'mp4box'
import { SUPPORTS_AUDIO_ENCODER, SUPPORTS_VIDEO_ENCODER } from './utils'
import type { SampleOptions } from 'mp4box'

export interface EncoderOptions {
  width: number
  height: number
  codec?: string
  fps?: number
  bitrate?: number
  audio?: false | {
    codec?: 'opus' | 'aac'
    sampleRate?: number
    channelCount?: number
  }
}

export class Encoder {
  static DEFAULT_OPTIONS = {
    video: {
      codec: 'avc1.4D0032',
      fps: 30,
    },
    audio: {
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      channelCount: 2,
      bitrate: 128_000,
    },
  }

  readonly file = createFile()

  protected _audioReady = false
  protected _videoReady = false

  protected _videoEncoder = this._createVideoEncoder()
  protected _videoChunks: Array<EncodedVideoChunk> = []
  protected _videoTrackId?: number

  protected _audioEncoder = this._options.audio !== false ? this._createAudioEncoder() : undefined
  protected _audioChunks: Array<EncodedAudioChunk> = []
  protected _audioTrackId?: number

  get videoConfig() {
    const options = this._options
    const defaultOptions = Encoder.DEFAULT_OPTIONS.video
    return {
      codec: options.codec ?? defaultOptions.codec,
      framerate: options.fps ?? defaultOptions.fps,
      // hardwareAcceleration: 'prefer-hardware',
      bitrate: options.bitrate,
      width: options.width,
      height: options.height,
      alpha: 'discard',
      avc: { format: 'avc' },
    }
  }

  get audioConfig() {
    const options = this._options.audio !== false ? this._options.audio : undefined
    const defaultOptions = Encoder.DEFAULT_OPTIONS.audio
    return {
      codec: options?.codec === 'aac' ? defaultOptions.codec : 'opus',
      sampleRate: options?.sampleRate ?? defaultOptions.sampleRate,
      numberOfChannels: options?.channelCount ?? defaultOptions.channelCount,
      bitrate: defaultOptions.bitrate,
    }
  }

  async isConfigSupported() {
    try {
      return Boolean((await VideoEncoder.isConfigSupported(this.videoConfig)).supported)
        && (
          this._options.audio === false
          || Boolean((await AudioEncoder.isConfigSupported(this.audioConfig)).supported)
        )
    } catch (error) {
      return false
    }
  }

  constructor(
    protected _options: EncoderOptions,
  ) {
    if (!SUPPORTS_VIDEO_ENCODER) {
      throw new Error('The current environment does not support VideoEncoder')
    }

    if (_options.audio !== false && !SUPPORTS_AUDIO_ENCODER) {
      throw new Error('The current environment does not support AudioEncoder')
    }
  }

  protected _addSample(chunk: EncodedAudioChunk | EncodedVideoChunk) {
    if (chunk instanceof EncodedAudioChunk) {
      this._audioReady = true

      if (this._videoReady) {
        this.file.addSample(this._audioTrackId!, ...this._chunkToSample(chunk))
      } else {
        this._audioChunks.push(chunk)
      }

      if (this._videoChunks.length) {
        this._videoChunks.forEach(chunk => {
          this.file.addSample(this._videoTrackId!, ...this._chunkToSample(chunk))
        })
        this._videoChunks = []
      }
    } else if (chunk instanceof EncodedVideoChunk) {
      this._videoReady = true

      if (this._audioReady || !this._audioEncoder) {
        this.file.addSample(this._videoTrackId!, ...this._chunkToSample(chunk))
      } else {
        this._videoChunks.push(chunk)
      }

      if (this._audioChunks.length) {
        this._audioChunks.forEach(chunk => {
          this.file.addSample(this._audioTrackId!, ...this._chunkToSample(chunk))
        })
        this._audioChunks = []
      }
    }
  }

  protected _chunkToSample(
    chunk: EncodedAudioChunk | EncodedVideoChunk,
  ): [ArrayBuffer, SampleOptions] {
    const buf = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buf)
    const dts = chunk.timestamp
    return [
      buf, {
        duration: chunk.duration ?? 0,
        dts,
        cts: dts,
        is_sync: chunk.type === 'key',
      },
    ]
  }

  protected _createVideoEncoder(): VideoEncoder {
    const options = this._options

    const encoder = new VideoEncoder({
      error: (error: DOMException) => console.warn(error),
      output: (chunk, meta) => {
        if (!this._videoTrackId && meta) {
          this._videoTrackId = this.file.addTrack({
            timescale: 1e6,
            width: options.width,
            height: options.height,
            // @ts-expect-error brands
            brands: ['isom', 'iso2', 'avc1', 'mp42', 'mp41'],
            avcDecoderConfigRecord: meta.decoderConfig?.description,
          })
        }

        this._addSample(chunk)
      },
    })

    encoder.configure(this.videoConfig)

    return encoder
  }

  protected _createAudioEncoder(): AudioEncoder {
    const options = this._options.audio as Record<string, any>

    const encoder = new AudioEncoder({
      error: (error: DOMException) => console.warn(error),
      output: (chunk, meta) => {
        if (!this._audioTrackId && meta.decoderConfig?.description) {
          this._audioTrackId = this.file.addTrack({
            timescale: 1e6,
            samplerate: options.sampleRate,
            channel_count: options.channelCount,
            hdlr: 'soun',
            type: options.codec === 'aac' ? 'mp4a' : 'Opus',
            description: this._createESDSBox(meta.decoderConfig?.description),
          })
        }

        this._addSample(chunk)
      },
    })

    encoder.configure(this.audioConfig)

    return encoder
  }

  protected _createESDSBox(config: ArrayBuffer | ArrayBufferView) {
    const configlen = config.byteLength
    const buf = new Uint8Array([
      0x00, // version 0
      0x00,
      0x00,
      0x00, // flags

      0x03, // descriptor_type
      0x17 + configlen, // length
      0x00,
      // 0x01, // es_id
      0x02, // es_id
      0x00, // stream_priority

      0x04, // descriptor_type
      0x12 + configlen, // length
      0x40, // codec : mpeg4_audio
      0x15, // stream_type
      0x00,
      0x00,
      0x00, // buffer_size
      0x00,
      0x00,
      0x00,
      0x00, // maxBitrate
      0x00,
      0x00,
      0x00,
      0x00, // avgBitrate

      0x05, // descriptor_type

      configlen,
      ...new Uint8Array(config instanceof ArrayBuffer ? config : config.buffer),

      0x06,
      0x01,
      0x02,
    ])

    // eslint-disable-next-line new-cap
    const esdsBox = new BoxParser.esdsBox(buf.byteLength)
    ;(esdsBox as any).hdr_size = 0
    esdsBox.parse(new DataStream(buf, 0, DataStream.BIG_ENDIAN))
    return esdsBox
  }

  encode(data: CanvasImageSource, options?: VideoEncoderEncodeOptions & VideoFrameInit): void
  encode(data: VideoFrame, options?: VideoEncoderEncodeOptions): void
  encode(data: AudioData): void
  encode(data: any, options?: any) {
    if (data instanceof AudioData) {
      this._audioEncoder?.encode(data)
      data.close()
    } else if (data instanceof VideoFrame) {
      this._videoEncoder.encode(data, options)
      data.close()
    } else {
      const { keyFrame = false, ...restOptions } = options ?? {}
      this.encode(new VideoFrame(data, restOptions), { keyFrame })
    }
  }

  async flush(): Promise<ArrayBuffer> {
    await Promise.all([
      this._videoEncoder.state === 'configured' ? this._videoEncoder.flush() : null,
      this._audioEncoder?.state === 'configured' ? this._audioEncoder.flush() : null,
    ])
    this.file.flush()

    const stream = new DataStream()
    ;(stream as any).endianness = DataStream.BIG_ENDIAN
    for (let len = this.file.boxes.length, i = 0; i < len; i++) {
      this.file.boxes[i].write(stream)
    }

    let i = 0
    while (true) {
      const track = this.file.getTrackById(i)
      if (!track) break
      this.file.releaseUsedSamples(i, (track as any).samples.length)
      ;(track as any).samples = []
      i++
    }
    this.file.mdats = []
    this.file.moofs = []

    return stream.buffer
  }

  close() {
    if (this._videoEncoder.state === 'configured') this._videoEncoder.close()
    if (this._audioEncoder?.state === 'configured') this._audioEncoder.close()
  }
}
