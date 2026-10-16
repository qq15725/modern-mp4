/** 返回当前环境不能导出 MP4 的原因；不按浏览器名称或版本猜测能力。 */
export async function getMP4SupportError({ width, height, videoBitrate = 6_000_000 }: { width: number, height: number, videoBitrate?: number }): Promise<string | undefined> {
  if (globalThis.isSecureContext === false)
    return 'MP4 导出需要安全连接，请使用 HTTPS 地址打开页面'
  if (typeof globalThis.VideoEncoder === 'undefined' || typeof globalThis.VideoFrame === 'undefined')
    return '当前浏览器不支持 MP4 视频编码，请更新浏览器，或使用新版 Chrome / Edge 打开'
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2)
    return '导出尺寸无效，请选择有效画板后重试'
  try {
    const { canEncodeVideo } = await import('mediabunny')
    if (!(await canEncodeVideo('avc', { width, height, bitrate: videoBitrate })))
      return '当前浏览器无法以此尺寸编码 H.264 视频，请降低导出尺寸；仍失败时请更新浏览器或换用 Chrome / Edge'
  }
  catch {
    return '无法检测 MP4 编码能力，请刷新页面重试；仍失败时请更新浏览器或换用 Chrome / Edge'
  }
}
