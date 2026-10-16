import type { AudioSampleSource, EncodedAudioPacketSource, Output, VideoSampleSource } from 'mediabunny'
import { getMP4SupportError } from './getMP4SupportError'

export interface CanvasMP4EncoderOptions {
  width: number
  height: number
  /** 秒；音轨尾部严格裁到画布结束时间。 */
  duration: number
  framerate?: number
  videoBitrate?: number
  audio?: boolean
  signal?: AbortSignal
  /** 编码输出预算，默认 256 MiB。 */
  maxBytes?: number
}

/** 画布导出专用编码器：固定 H.264 + AAC，带准确的 priming/padding 与取消处理。 */
export class CanvasMP4Encoder {
  private output?: Output
  private audioOutput?: Output
  private video?: VideoSampleSource
  private audio?: AudioSampleSource
  private audioPackets?: EncodedAudioPacketSource
  private pendingPackets: Promise<void> = Promise.resolve()
  private packetError?: unknown
  private chunks: BlobPart[] = []
  private offset = 0
  private cancelled = false
  private removeAbort?: () => void

  private constructor(private options: CanvasMP4EncoderOptions) {}

  static async create(options: CanvasMP4EncoderOptions): Promise<CanvasMP4Encoder> {
    const encoder = new CanvasMP4Encoder(options)
    try {
      await encoder.init()
      return encoder
    }
    catch (error) {
      await encoder.abort()
      throw error
    }
  }

  private check(): void {
    this.options.signal?.throwIfAborted()
    if (this.cancelled)
      throw new DOMException('导出已取消', 'AbortError')
    if (this.packetError)
      throw this.packetError
  }

  private async init(): Promise<void> {
    this.check()
    const { duration, audio, videoBitrate = 6_000_000, maxBytes = 256 * 1024 * 1024, signal } = this.options
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(maxBytes) || maxBytes <= 0)
      throw new Error('Invalid MP4 duration or memory budget')
    const unsupported = await getMP4SupportError(this.options)
    if (unsupported)
      throw new Error(unsupported)
    if (audio && typeof globalThis.WebAssembly === 'undefined')
      throw new Error('当前浏览器不支持音频编码所需的 WebAssembly，无法导出有声 MP4，请更新浏览器或换用 Chrome / Edge')
    const { Output, Mp4OutputFormat, StreamTarget, VideoSampleSource, AudioSampleSource, EncodedAudioPacketSource, NullTarget } = await import('mediabunny')
    this.check()
    this.output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(new WritableStream({
        write: ({ data, position }) => {
          this.check()
          if (position + data.byteLength > maxBytes)
            throw new Error('导出文件超出内存上限，请缩短视频或降低分辨率')
          // fastStart:false 的 mdat 头会回填；Blob 分片避免反复扩容整个输出文件。
          const before = new Blob(this.chunks)
          this.chunks = [before.slice(0, position), data, before.slice(position + data.byteLength)]
        },
      })),
    })
    this.video = new VideoSampleSource({ codec: 'avc', bitrate: videoBitrate, keyFrameInterval: 2 })
    // 不声明固定帧时基：否则最后不足一帧的时长会被量化成 0。
    this.output.addVideoTrack(this.video)
    if (audio) {
      // 使用固定版本的 FFmpeg AAC 编码器，避免平台原生 AAC 没有提供 priming 信息。
      try {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
        registerAacEncoder()
      }
      catch (cause) {
        this.check()
        throw new Error('音频编码器加载失败，无法导出有声 MP4，请检查网络并刷新页面重试', { cause })
      }
      this.check()
      this.audioPackets = new EncodedAudioPacketSource('aac')
      this.output.addAudioTrack(this.audioPackets)
      this.audio = new AudioSampleSource({
        codec: 'aac',
        bitrate: 128_000,
        onEncodedPacket: (packet, meta) => {
          // FFmpeg AAC-LC initial_padding = 1024；固定编码器，不按操作系统猜测延迟。
          // @mediabunny/aac-encoder 1.61.5 未转发 FFmpeg 的负 PTS，此处恢复它。
          const timestamp = packet.timestamp - 1024 / 48000
          if (timestamp >= duration)
            return
          const adjusted = packet.clone({ timestamp, duration: Math.min(packet.duration, duration - timestamp) })
          this.pendingPackets = this.pendingPackets.then(async () => {
            this.check()
            await this.audioPackets!.add(adjusted, meta)
          }).catch((error) => { this.packetError = error })
        },
      })
      // NullTarget 只驱动编码器；最终文件由主 Output 统一封装校正后的音视频包。
      this.audioOutput = new Output({ format: new Mp4OutputFormat(), target: new NullTarget() })
      this.audioOutput.addAudioTrack(this.audio)
      await this.audioOutput.start()
    }
    await this.output.start()
    this.check()
    const onAbort = (): void => {
      void this.abort()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    this.removeAbort = () => signal?.removeEventListener('abort', onAbort)
  }

  async encode(frame: { data: ImageBitmap, timestamp: number, duration: number }): Promise<void> {
    this.check()
    const { VideoSample } = await import('mediabunny')
    const sample = new VideoSample(frame.data, { timestamp: frame.timestamp / 1000, duration: frame.duration / 1000 })
    try {
      await this.video!.add(sample)
      this.check()
    }
    catch (cause) {
      this.check()
      if (cause instanceof DOMException && ['NotSupportedError', 'EncodingError', 'OperationError'].includes(cause.name))
        throw new Error('视频编码失败，可能超出当前浏览器的编码能力，请降低导出尺寸或更新浏览器后重试', { cause })
      throw cause
    }
    finally {
      sample.close()
    }
  }

  async encodeAudioBuffer(buffer: AudioBuffer, start = 0, end = buffer.length): Promise<void> {
    this.check()
    if (!this.audio || buffer.sampleRate !== 48000 || buffer.numberOfChannels !== 2)
      throw new Error('Canvas MP4 audio must be stereo 48 kHz')
    if (start !== this.offset || end < start || end > buffer.length)
      throw new Error('Audio samples must be contiguous')
    const { AudioSample } = await import('mediabunny')
    for (let offset = start; offset < end; offset += 4096) {
      this.check()
      const count = Math.min(4096, end - offset)
      const data = new Float32Array(count * 2)
      for (let c = 0; c < 2; c++)
        data.set(buffer.getChannelData(c).subarray(offset, offset + count), c * count)
      const sample = new AudioSample({ format: 'f32-planar', sampleRate: 48000, numberOfChannels: 2, timestamp: offset / 48000, data })
      try {
        try {
          await this.audio.add(sample)
        }
        catch (cause) {
          this.check()
          throw new Error('音频编码失败，无法导出有声 MP4，请检查网络并更新浏览器后重试', { cause })
        }
        await this.pendingPackets
        this.check()
      }
      finally {
        sample.close()
      }
    }
    this.offset = end
  }

  async flush(): Promise<Blob> {
    this.check()
    try {
      try {
        await this.audioOutput?.finalize()
      }
      catch (cause) {
        this.check()
        throw new Error('音频编码失败，无法导出有声 MP4，请更新浏览器后重试', { cause })
      }
      await this.pendingPackets
      this.check()
      await this.output!.finalize()
      this.check()
      return new Blob(this.chunks, { type: 'video/mp4' })
    }
    catch (error) {
      await this.abort()
      throw error
    }
    finally {
      this.removeAbort?.()
      this.chunks = []
    }
  }

  async abort(): Promise<void> {
    this.cancelled = true
    this.removeAbort?.()
    await Promise.allSettled([this.output?.cancel(), this.audioOutput?.cancel()])
    this.chunks = []
  }
}
