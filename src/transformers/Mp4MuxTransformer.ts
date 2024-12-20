import type { MP4Info, SampleOptions } from 'mp4box'
import type { Mp4EncodeTransformerOutput } from './Mp4EncodeTransformer'
import { BoxParser, createFile, DataStream } from 'mp4box'
import { requestIdleCallback } from '../utils'

export interface Mp4MuxTransformerOptions {
  width?: number
  height?: number
  videoTimescale?: number
  videoLanguage?: string
  audioCodec?: string
  audioTimescale?: number
  audioSampleRate?: number
  audioChannelCount?: number
  audioLanguage?: string
  info?: MP4Info
}

export type Mp4MuxTransformerInput = Mp4EncodeTransformerOutput

export class Mp4MuxTransformer implements ReadableWritablePair<ArrayBuffer, Mp4MuxTransformerInput> {
  protected _file = createFile()
  protected _rsControler?: ReadableStreamDefaultController<ArrayBuffer>
  protected _rsCancelled = false
  protected _videoTrackId?: number
  protected _audioTrackId?: number

  get info(): MP4Info { return this._file.getInfo() as MP4Info }

  readable = new ReadableStream<ArrayBuffer>({
    start: controler => this._rsControler = controler,
    cancel: () => {
      this._rsControler = undefined
      this._rsCancelled = true
    },
  })

  writable = new WritableStream<Mp4MuxTransformerInput>({
    write: (input) => {
      if (this._rsCancelled) {
        this.writable.abort()
        return
      }
      const { type, chunk, meta } = input
      switch (type) {
        case 'video':
          this._file.addSample(
            this._videoTrackId ??= this._addVideoTrack(meta),
            ...this._chunkToSampleInit(chunk),
          )
          break
        case 'audio':
          this._file.addSample(
            this._audioTrackId ??= this._addAudioTrack(meta),
            ...this._chunkToSampleInit(chunk),
          )
          break
      }
    },
    close: () => {
      this._file.flush()
      this._file.stop()
      const stream = new DataStream()
      ;(stream as any).endianness = DataStream.BIG_ENDIAN
      for (let len = this._file.boxes.length, i = 0; i < len; i++) {
        this._file.boxes[i].write(stream)
      }
      this._rsControler?.enqueue(stream.buffer)
      this._rsControler?.close()
      requestIdleCallback(() => {
        this.info.tracks.forEach((track) => {
          this._file.releaseUsedSamples(track.id, track.nb_samples)
        })
        this._file.mdats = []
        this._file.moofs = []
      })
    },
  })

  constructor(
    public _options: Mp4MuxTransformerOptions = {},
  ) {
    //
  }

  protected _addVideoTrack(meta: EncodedVideoChunkMetadata): number {
    const { width, height, videoTimescale, videoLanguage, info } = this._options
    const videoTrack = info?.videoTracks[0]
    return this._file.addTrack({
      timescale: videoTimescale || videoTrack?.timescale || 1_000,
      width: width || videoTrack?.track_width || 0,
      height: height || videoTrack?.track_height || 0,
      language: videoLanguage || videoTrack?.language,
      // @ts-expect-error brands
      brands: ['isom', 'iso2', 'avc1', 'mp42', 'mp41'],
      avcDecoderConfigRecord: meta.decoderConfig?.description,
    })
  }

  protected _addAudioTrack(meta: EncodedAudioChunkMetadata): number {
    const { audioCodec, audioTimescale, audioSampleRate, audioChannelCount, audioLanguage, info } = this._options
    const audioTrack = info?.audioTracks[0]
    return this._file.addTrack({
      timescale: audioTimescale || audioTrack?.timescale || 1_000,
      samplerate: audioSampleRate || audioTrack?.audio.sample_rate || 48000,
      channel_count: audioChannelCount || audioTrack?.audio.channel_count || 2,
      language: audioLanguage || audioTrack?.language,
      hdlr: 'soun',
      type: (audioCodec || audioTrack?.codec) === 'aac' ? 'mp4a' : 'Opus',
      description: this._toESDSBox(meta.decoderConfig!.description!),
    })
  }

  protected _toESDSBox(config: ArrayBuffer | ArrayBufferView): BoxParser.esdsBox {
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

  protected _chunkToSampleInit(chunk: EncodedVideoChunk): [ArrayBuffer, SampleOptions] {
    const buf = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buf)
    const dts = chunk.timestamp
    return [
      buf,
      {
        duration: chunk.duration ?? 0,
        dts,
        cts: dts,
        is_sync: chunk.type === 'key',
      },
    ]
  }
}
