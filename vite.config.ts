import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, rmSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

/**
 * Keeps the published APK out of the APK.
 *
 * `public/downloads` holds the binary the web portal serves, and Vite copies
 * everything in `public/` into `dist/`, which Capacitor then packages into the
 * app's assets. The result is a build that contains a copy of itself and is
 * twice the size — and every release would embed the previous one, so it
 * compounds.
 */
const excludeDownloadsFromNative = (): PluginOption => ({
  name: 'nestly-exclude-downloads',
  apply: 'build',
  closeBundle() {
    const dir = fileURLToPath(new URL('./dist/downloads', import.meta.url))
    rmSync(dir, { recursive: true, force: true })
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'native' ? [excludeDownloadsFromNative()] : [])],
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
