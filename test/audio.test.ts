import { describe, expect, it } from 'vitest'
import { MP4EncodeTransformer, MP4MuxTransformer } from '../src/transformers'

describe('mP4 音画时间和编码配置', () => {
  it('默认使用标准 AAC codec 标识，并保留显式编码配置', () => {
    expect(MP4EncodeTransformer.getAudioEncoderConfig({}).codec).toBe('mp4a.40.2')
    expect(MP4EncodeTransformer.getAudioEncoderConfig({ audioCodec: 'mp4a.40.2' }).codec).toBe('mp4a.40.2')
    expect(MP4EncodeTransformer.getAudioEncoderConfig({ audioCodec: 'opus' }).codec).toBe('opus')
  })

  it('webCodecs 微秒转换为各音视频轨道的 timescale', () => {
    const muxer = new MP4MuxTransformer()
    const chunk = { timestamp: 1_000_000, duration: 21_333, byteLength: 1, type: 'key', copyTo: () => {} }
    const audio = (muxer as any)._chunkToSampleInit(chunk, 48000)[1]
    const video = (muxer as any)._chunkToSampleInit(chunk, 1000)[1]
    expect(audio).toMatchObject({ dts: 48000, cts: 48000, duration: 1024 })
    expect(video).toMatchObject({ dts: 1000, cts: 1000, duration: 21 })
  })
})
