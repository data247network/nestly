import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The two targets genuinely disagree about this, so they get different bases.
  //
  // Native keeps relative references: Capacitor serves the bundle from a
  // file:// style origin, and there is only ever one path inside the APK.
  //
  // The web build must be absolute. The portal has nested routes, and a
  // relative base makes a browser at /setup/CODE resolve assets against that
  // path — /setup/assets/index.js — which matches the SPA rewrite and returns
  // index.html. The result is a blank page and a MIME type error, with the URL
  // still answering 200, which is exactly what shipped and exactly why a status
  // code was not evidence the page worked.
  base: mode === 'native' ? './' : '/',
  build: { outDir: 'dist' },
  server: { port: 5174, host: true },
}))
