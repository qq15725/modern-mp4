import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasMP4Encoder } from '../src/CanvasMP4Encoder'
import { decodeAudio } from '../src/decodeAudio'
import { getMP4SupportError } from '../src/getMP4SupportError'

const mocks = vi.hoisted(() => ({ canEncode: vi.fn(), getTrack: vi.fn(), dispose: vi.fn() }))
vi.mock('mediabunny', () => ({
  canEncodeVideo: mocks.canEncode,
  Input: class {
    getPrimaryAudioTrack = mocks.getTrack
    dispose = mocks.dispose
  },
  BufferSource: class {},
  MP4: {},
  QTFF: {},
  WEBM: {},
}))

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('VideoEncoder', class {})
  vi.stubGlobal('VideoFrame', class {})
  mocks.canEncode.mockReset().mockResolvedValue(true)
  mocks.getTrack.mockReset()
  mocks.dispose.mockClear()
})
afterEach(() => vi.unstubAllGlobals())
const size = { width: 1242, height: 2208 }

describe('有声 MP4 兼容提示', () => {
  it('不按浏览器名称限制支持，缺少 API 或非安全环境才明确拒绝', async () => {
    await expect(getMP4SupportError(size)).resolves.toBeUndefined()
    vi.stubGlobal('VideoEncoder', undefined)
    await expect(getMP4SupportError(size)).resolves.toContain('更新浏览器')
    vi.stubGlobal('isSecureContext', false)
    await expect(getMP4SupportError(size)).resolves.toContain('HTTPS')
  })

  it('画幅或编码器不支持时提示调整尺寸，检测异常也可读', async () => {
    await expect(getMP4SupportError({ width: 0, height: 0 })).resolves.toContain('尺寸无效')
    mocks.canEncode.mockResolvedValue(false)
    await expect(getMP4SupportError(size)).resolves.toContain('降低导出尺寸')
    mocks.canEncode.mockRejectedValue(new Error('driver failure'))
    await expect(getMP4SupportError(size)).resolves.toContain('无法检测')
  })

  it('缺少 WASM 时阻止有声导出，不依赖原生 AudioEncoder', async () => {
    vi.stubGlobal('WebAssembly', undefined)
    await expect(CanvasMP4Encoder.create({ ...size, duration: 4, audio: true })).rejects.toThrow('WebAssembly')
  })

  it('区分无音轨与无法解码，读取失败不返回静音成功', async () => {
    const context = {} as BaseAudioContext
    mocks.getTrack.mockResolvedValue(undefined)
    await expect(decodeAudio(new ArrayBuffer(1), context)).resolves.toBeUndefined()
    mocks.getTrack.mockResolvedValue({ canDecode: async () => false })
    await expect(decodeAudio(new ArrayBuffer(1), context)).rejects.toThrow('无法解码此视频原声')
    mocks.getTrack.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(decodeAudio(new ArrayBuffer(1), context)).rejects.toThrow('跨域权限')
    expect(mocks.dispose).toHaveBeenCalledTimes(3)
  })
})
