import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Two entry points: the app itself, and a headless harness that runs real
    // goals through the real agent and prints the trace, so the loop can be
    // exercised without a window in the way.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          harness: resolve('src/main/harness.ts')
        }
      }
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'typebox']
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
