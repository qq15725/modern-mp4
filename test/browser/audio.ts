import { CanvasMP4Encoder, decodeAudio } from '../../src'

function assert(value: unknown, message: string): asserts value {
  if (!value)
    throw new Error(message)
}

async function expectFailure(task: () => Promise<unknown>, match: string): Promise<void> {
  try {
    await task()
  }
  catch (error) {
    assert(String(error).includes(match), `预期 ${match}，实际 ${String(error)}`)
    return
  }
  throw new Error(`预期失败：${match}`)
}

async function fixture(options: { duration?: number, audio?: boolean, signal?: AbortSignal, maxBytes?: number, onFrame?: (frame: number) => void } = {}): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 90
  const context = canvas.getContext('2d')!
  const duration = options.duration ?? 2
  const samples = Math.round(duration * 48000)
  const pcm = new AudioBuffer({ length: samples, sampleRate: 48000, numberOfChannels: 2 })
  for (let c = 0; c < 2; c++) {
    const channel = pcm.getChannelData(c)
    for (let i = 12000; i < Math.min(samples, 84000); i++)
      channel[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (i - 12000) / 48000)
  }
  const encoder = await CanvasMP4Encoder.create({ width: 160, height: 90, duration, audio: options.audio ?? true, signal: options.signal, maxBytes: options.maxBytes })
  try {
    for (let i = 0; i < Math.ceil(duration * 30); i++) {
      context.fillStyle = i < 30 ? 'red' : 'blue'
      context.fillRect(0, 0, 160, 90)
      const bitmap = await createImageBitmap(canvas)
      try {
        await encoder.encode({ data: bitmap, timestamp: i * 1000 / 30, duration: Math.min(1 / 30, duration - i / 30) * 1000 })
      }
      finally {
        bitmap.close()
      }
      if (options.audio !== false)
        await encoder.encodeAudioBuffer(pcm, i * 1600, Math.min(samples, (i + 1) * 1600))
      options.onFrame?.(i)
    }
    return await encoder.flush()
  }
  catch (error) {
    await encoder.abort()
    throw error
  }
}

export async function runAudioRegression(): Promise<unknown[]> {
  const results: unknown[] = []
  const context = new OfflineAudioContext(2, 96000, 48000)
  const { Input, BufferSource, MP4 } = await import('mediabunny')
  const blob = await fixture()
  const bytes = await blob.arrayBuffer()
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] })
  try {
    const tracks = await input.getTracks()
    const durations = await Promise.all(tracks.map(track => track.computeDuration()))
    assert(durations.every(duration => Math.abs(duration - 2) < 0.0001), `音画时长不一致：${durations}`)
    const decoded = await decodeAudio(bytes, context)
    assert(decoded, '缺少音轨')
    const samples = decoded.buffer.getChannelData(0)
    const onset = samples.findIndex(x => Math.abs(x) > 0.03)
    assert(Math.abs(onset - 12000) < 144, `音画起点偏移超过 3ms：${onset}`)
    results.push({ test: '声音起点与尾部时长', durations, onsetSamples: onset, bytes: blob.size })
  }
  finally {
    input.dispose()
  }
  const fractional = new Input({ source: new BufferSource(await (await fixture({ duration: 2.013 })).arrayBuffer()), formats: [MP4] })
  try {
    const durations = await Promise.all((await fractional.getTracks()).map(track => track.computeDuration()))
    assert(durations.every(duration => Math.abs(duration - 2.013) < 0.0001), `不足一帧的结尾丢失：${durations}`)
    results.push({ test: '不足一帧的结尾', durations })
  }
  finally {
    fractional.dispose()
  }
  const original = globalThis.AudioEncoder
  try {
    Object.defineProperty(globalThis, 'AudioEncoder', { value: undefined, configurable: true, writable: true })
    assert((await fixture()).size > 0, '无原生 AAC 编码时失败')
    const silent = await fixture({ audio: false })
    assert(!(await decodeAudio(await silent.arrayBuffer(), context)), '静音视频不应含音轨')
    results.push({ test: '无原生 AAC：有声和静音均正常' })
  }
  finally {
    Object.defineProperty(globalThis, 'AudioEncoder', { value: original, configurable: true, writable: true })
  }
  const videoEncoder = globalThis.VideoEncoder
  try {
    Object.defineProperty(globalThis, 'VideoEncoder', { value: undefined, configurable: true, writable: true })
    await expectFailure(() => fixture(), '当前浏览器不支持 MP4 视频编码')
    results.push({ test: '缺少视频编码 API：明确提示升级浏览器' })
  }
  finally {
    Object.defineProperty(globalThis, 'VideoEncoder', { value: videoEncoder, configurable: true, writable: true })
  }
  const before = new AbortController()
  before.abort()
  await expectFailure(() => fixture({ signal: before.signal }), 'AbortError')
  const during = new AbortController()
  await expectFailure(() => fixture({ signal: during.signal, onFrame: frame => frame === 4 && during.abort() }), 'AbortError')
  await expectFailure(() => fixture({ maxBytes: 100 }), '内存上限')
  assert((await fixture()).size > 0, '取消/内存拦截后无法再次导出')
  results.push({ test: '取消、输出预算拦截、再次导出' })
  await expectFailure(() => decodeAudio(new ArrayBuffer(100), context), '读取或解码失败')
  results.push({ test: '损坏源文件明确失败' })
  return results
}

Object.assign(window, { runAudioRegression })
document.querySelector('#run')?.addEventListener('click', async () => {
  const result = document.querySelector('#result')!
  try {
    result.textContent = JSON.stringify(await runAudioRegression(), null, 2)
  }
  catch (error) {
    result.textContent = String(error)
  }
})
