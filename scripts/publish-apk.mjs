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
/**
 * Release, not debug — and this is not a preference.
 *
 * Every machine has its own debug keystore, so a debug APK cannot update a
 * release-signed install: Android refuses it outright with
 * INSTALL_FAILED_UPDATE_INCOMPATIBLE. Publishing debug builds would therefore
 * hand every existing phone an update it is guaranteed to reject, and Play
 * Protect blocks debug-signed sideloads on top of that.
 */
/**
 * What `npm run android:apk:release` actually produces.
 *
 * This used to point at `android/app/build/outputs/...`, which that script
 * never writes: it builds in a temp copy of the project and copies only the
 * finished APK to `release/`. The path under the repo holds whatever Gradle
 * last produced in place — in practice a build from days earlier, at the
 * previous versionCode.
 *
 * The result was the one failure this whole file exists to prevent. The
 * manifest took its version from build.gradle, the APK came from the stale
 * path, and the two disagreed: a phone downloaded "9", installed bytes that
 * reported 8, and was offered the same update for ever after.
 */
const APK_RELEASE = join(root, 'release/Nestly-release.apk')
const APK_META = join(root, 'release/Nestly-release.metadata.json')
const APK_DEBUG = join(root, 'release/Nestly.apk')
const OUT_DIR = join(root, 'public/downloads')
const APK_OUT = join(OUT_DIR, 'nestly.apk')
const MANIFEST_OUT = join(OUT_DIR, 'latest.json')

const PORTAL =
  process.env.VITE_PORTAL_ORIGIN?.replace(/\/+$/, '') ??
  'https://nestly-gamma-seven.vercel.app'

if (!existsSync(APK_RELEASE)) {
  if (existsSync(APK_DEBUG)) {
    console.error(
      'Refusing to publish a debug build.\n' +
        'A debug APK cannot update a release-signed phone — Android rejects it with\n' +
        'INSTALL_FAILED_UPDATE_INCOMPATIBLE — and Play Protect blocks debug sideloads.\n' +
        'Build a signed one: npm run android:apk:release',
    )
  } else {
    console.error(`No release APK at ${APK_RELEASE}\nBuild one: npm run android:apk:release`)
  }
  process.exit(1)
}


const APK_SRC = APK_RELEASE

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

// Cross-check against what Gradle recorded for these exact bytes.
//
// build.gradle says what the *next* build will be; the metadata beside the APK
// says what this one actually is. They diverge the moment somebody bumps the
// version and publishes without rebuilding, which is precisely the mistake
// that is invisible until a hundred phones are stuck in an update loop.
if (existsSync(APK_META)) {
  const meta = JSON.parse(readFileSync(APK_META, 'utf-8'))
  const built = meta?.elements?.[0]
  if (built && Number(built.versionCode) !== versionCode) {
    console.error(
      `The APK in release/ is versionCode ${built.versionCode} (${built.versionName}), ` +
        `but android/app/build.gradle says ${versionCode} (${versionName}).\n` +
        'Publishing this pair would hand every phone an update that installs and\n' +
        'still reports the old number, then offers itself again for ever.\n' +
        'Rebuild: npm run android:apk:release',
    )
    process.exit(1)
  }
} else {
  console.warn(
    'No build metadata beside the APK, so its versionCode could not be verified\n' +
      'against build.gradle. Rebuild with npm run android:apk:release to get it.',
  )
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
