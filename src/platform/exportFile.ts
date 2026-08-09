import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * Writes a generated file somewhere the user can actually get at it.
 *
 * On Android the file goes to the app's Cache directory and is then handed to
 * the system share sheet — Cache rather than Documents because it needs no
 * storage permission on any API level, and a report is something you send, not
 * something you archive on the phone.
 *
 * In a browser it falls back to a download, so the same Export button works in
 * the loopback development setup.
 *
 * Returns a short sentence describing where it went, for the UI to show.
 */
export async function shareGenerated(blob: Blob, filename: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoke on the next tick: revoking synchronously cancels the download in
    // some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return `Downloaded ${filename}`
  }

  const isText = blob.type.startsWith('text/')
  const data = isText ? await blob.text() : await toBase64(blob)

  const written = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
    // Text is written as UTF-8; binary must go without an encoding, which is
    // how the plugin knows to treat the string as base64.
    ...(isText ? { encoding: Encoding.UTF8 } : {}),
  })

  try {
    await Share.share({
      title: 'Nestly activity report',
      files: [written.uri],
      dialogTitle: 'Share report',
    })
    return `Shared ${filename}`
  } catch {
    // The share sheet being dismissed is not a failure — the file is written
    // either way, so tell them where it is rather than showing an error.
    return `Saved ${filename} to the app's files`
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the generated file'))
    reader.onload = () => {
      const result = String(reader.result)
      // readAsDataURL yields "data:<mime>;base64,<payload>"; the plugin wants
      // only the payload.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}
