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
```

## Usage

```ts
import { encode } from 'modern-mp4'

const output = await encode({
  width: 1280,
  height: 720,
  audio: false,
  frames: [
    // data: string | CanvasImageSource | VideoFrame | AudioData
    { data: '/example1.png', duration: 3000 },
    { data: '/example2.png', duration: 3000 },
  ],
})

const blob = new Blob([output], { type: 'image/mp4' })
window.open(URL.createObjectURL(blob))
```
