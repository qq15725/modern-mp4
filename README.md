<h1 align="center">modern-mp4</h1>

<p align="center">
  <a href="https://unpkg.com/modern-mp4">
    <img src="https://img.shields.io/bundlephobia/minzip/modern-mp4" alt="Minzip">
  </a>
  <a href="https://www.npmjs.com/package/modern-mp4">
    <img src="https://img.shields.io/npm/v/modern-mp4.svg" alt="Version">
  </a>
  <a href="https://www.npmjs.com/package/modern-mp4">
    <img src="https://img.shields.io/npm/dm/modern-mp4" alt="Downloads">
  </a>
  <a href="https://github.com/qq15725/modern-mp4/issues">
    <img src="https://img.shields.io/github/issues/qq15725/modern-mp4" alt="Issues">
  </a>
  <a href="https://github.com/qq15725/modern-mp4/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/modern-mp4.svg" alt="License">
  </a>
</p>

## Install

```shell
npm i modern-mp4

# peerDependencies
npm i mp4box
```

## Usage

### Encode

```ts
import { encode } from 'modern-mp4'

const blob = await encode({
  width: 1280,
  height: 720,
  audio: false,
  frames: [
    // data: string | CanvasImageSource | VideoFrame | AudioData
    { data: '/example1.png', duration: 3000 },
    { data: '/example2.png', duration: 3000 },
  ],
})

window.open(URL.createObjectURL(blob))
```

### Decode

```ts
import { decode } from 'modern-mp4'

const infoWithFrames = await decode({
  // string | Blob | BufferSource | Array<BufferSource> | readableStream<BufferSource>
  data: './example.mp4',
  audio: false,
  // framerate: 10,
  // onInfo: info => console.log(info),
  // onFrame: frame => { console.log(frame) },
  // onProgress: (current, total) => console.log(`decode frame ${current}/${total}`),
})

console.log(infoWithFrames)
```
