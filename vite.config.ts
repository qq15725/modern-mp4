import { basename, resolve } from 'node:path'
import { defineConfig } from 'vite'
import { browser, name } from './package.json'

const resolvePath = (str: string) => resolve(__dirname, str)

export default defineConfig({
  build: {
    lib: {
      formats: ['umd'],
      fileName: (format) => {
        if (format === 'umd')
          return basename(browser)
        return `${name}.${format}`
      },
      entry: resolvePath('./src/index.ts'),
      name: name.replace(/-(\w)/g, (_, v) => v.toUpperCase()),
    },
  },
})
