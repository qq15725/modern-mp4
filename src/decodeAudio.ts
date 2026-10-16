import type { Input } from 'mediabunny'

export interface DecodeAudioOptions {
  signal?: AbortSignal
  /** 解码后的 PCM 最大字节数，默认 128 MiB。 */
  maxBytes?: number
}

class AudioExportError extends Error {}

async function readAudio(input: Input, context: BaseAudioContext, { signal, maxBytes = 128 * 1024 * 1024 }: DecodeAudioOptions): Promise<{ buffer: AudioBuffer, duration: number } | undefined> {
  const onAbort = (): void => input.dispose()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    signal?.throwIfAborted()
    const track = await input.getPrimaryAudioTrack()
    if (!track)
      return
    if (!(await track.canDecode()))
      throw new AudioExportError('当前浏览器无法解码此视频原声，请转换为 MP4/AAC 后重试')
    const duration = await input.computeDuration()
    const sampleRate = await track.getSampleRate()
    const channels = await track.getNumberOfChannels()
    const length = Math.ceil(duration * sampleRate)
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(maxBytes) || length * channels * 4 > maxBytes)
      throw new AudioExportError('视频原声音轨超出导出内存上限，请缩短视频后重试')
    signal?.throwIfAborted()
    const buffer = context.createBuffer(channels, length, sampleRate)
    const { AudioBufferSink } = await import('mediabunny')
    const sink = new AudioBufferSink(track)
    // 逐块解码后直接写目标 PCM，保留容器内的起始偏移，不缓存整份视频或一组 PCM 副本。
    for await (const part of sink.buffers()) {
      signal?.throwIfAborted()
      const offset = Math.round(part.timestamp * sampleRate)
      const start = Math.max(0, -offset)
      const end = Math.min(part.buffer.length, length - offset)
      if (end <= start)
        continue
      if (part.buffer.sampleRate !== sampleRate || part.buffer.numberOfChannels !== channels)
        throw new AudioExportError('视频音轨参数在播放中发生变化，请先转换视频格式')
      for (let c = 0; c < channels; c++)
        buffer.copyToChannel(part.buffer.getChannelData(c).subarray(start, end), c, Math.max(0, offset))
    }
    signal?.throwIfAborted()
    return { buffer, duration: duration * 1000 }
  }
  catch (error) {
    signal?.throwIfAborted()
    if (error instanceof AudioExportError)
      throw error
    throw new Error('视频原声读取或解码失败，请检查素材链接、网络及跨域权限，或将素材转换为 MP4（H.264 / AAC）后重试', { cause: error })
  }
  finally {
    signal?.removeEventListener('abort', onAbort)
    input.dispose()
  }
}

/** 区分无音轨与解码失败；支持 MP4、MOV、WebM，按容器时间戳还原 PCM。 */
export async function decodeAudio(data: ArrayBuffer, context: BaseAudioContext, options: DecodeAudioOptions = {}): Promise<{ buffer: AudioBuffer, duration: number } | undefined> {
  const { Input, BufferSource, MP4, QTFF, WEBM } = await import('mediabunny')
  return readAudio(new Input({ source: new BufferSource(data), formats: [MP4, QTFF, WEBM] }), context, options)
}

/** 支持 Range 的源按需读取；取消会停止网络读取和解码器。 */
export async function loadVideoAudio(src: string, context: BaseAudioContext, options: DecodeAudioOptions = {}): Promise<{ buffer: AudioBuffer, duration: number } | undefined> {
  options.signal?.throwIfAborted()
  const { Input, UrlSource, MP4, QTFF, WEBM } = await import('mediabunny')
  return readAudio(new Input({
    source: new UrlSource(src, {
      maxCacheSize: 8 * 1024 * 1024,
      getRetryDelay: attempts => attempts < 2 ? 0.5 : null,
    }),
    formats: [MP4, QTFF, WEBM],
  }), context, options)
}
