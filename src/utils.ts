// Constants
export const IN_BROWSER = typeof window !== 'undefined'
export const SUPPORTS_VIDEO_ENCODER = IN_BROWSER && 'VideoEncoder' in window
export const SUPPORTS_AUDIO_ENCODER = IN_BROWSER && 'AudioEncoder' in window
