#!/usr/bin/env node
/**
 * Publishes a built APK to the web portal, and writes the update manifest.
 *
 * The manifest is what already-installed phones poll, so it has to describe the
 * exact bytes being served — a manifest that disagrees with the APK either
 * offers an update that never arrives, or hands a phone a file it then refuses
 * as tampered. Both numbers are therefore read from the file itself rather than
 * typed: the size and the SHA-256 are measured, and the versionCode is taken
 * from build.gradle, which is the value Android actually compiled in.
 *
 *   node scripts/publish-apk.mjs
 *
 * Then commit and push; Vercel serves public/downloads.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const APK_SRC = join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')
const OUT_DIR = join(root, 'public/downloads')
const APK_OUT = join(OUT_DIR, 'nestly.apk')
const MANIFEST_OUT = join(OUT_DIR, 'latest.json')

const PORTAL =
  process.env.VITE_PORTAL_ORIGIN?.replace(/\/+$/, '') ??
  'https://nestly-gamma-seven.vercel.app'

if (!existsSync(APK_SRC)) {
  console.error(`No APK at ${APK_SRC}\nBuild one first: npm run android:apk`)
  process.exit(1)
}

// Read the version out of build.gradle rather than accepting an argument. A
// manifest whose versionCode does not match the compiled one is worse than no
// manifest: phones either never update, or loop offering an update that
// installs and still reports the old number.
const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf-8')
const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1])
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1]

if (!Number.isInteger(versionCode) || !versionName) {
  console.error('Could not read versionCode/versionName from android/app/build.gradle')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
copyFileSync(APK_SRC, APK_OUT)

const bytes = readFileSync(APK_OUT)
const sha256 = createHash('sha256').update(bytes).digest('hex')

const manifest = {
  versionCode,
  versionName,
  url: `${PORTAL}/downloads/nestly.apk`,
  sha256,
  size: bytes.length,
  publishedAt: new Date().toISOString(),
}

writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Published versionCode ${versionCode} (${versionName})`)
console.log(`  ${(bytes.length / 1024 / 1024).toFixed(2)} MB`)
console.log(`  sha256 ${sha256}`)
console.log(`\nCommit public/downloads and push to publish.`)

if (versionCode === 1) {
  console.warn(
    '\nversionCode is still 1. Phones already on 1 will not see this as an update —\n' +
      'bump it in android/app/build.gradle before publishing a real one.',
  )
}
