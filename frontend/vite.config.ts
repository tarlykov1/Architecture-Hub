import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

const revision = (process.env.BUILD_REVISION || (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { return 'unknown' }
})()).trim()
const builtAt = new Date().toISOString()

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'architecture-build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify({ revision, builtAt, application: 'Architecture Hub frontend' }),
        })
      },
    },
  ],
  define: {
    __BUILD_REVISION__: JSON.stringify(revision),
    __BUILD_TIME__: JSON.stringify(builtAt),
  },
  server: {
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8001', changeOrigin: true },
    },
  },
})
