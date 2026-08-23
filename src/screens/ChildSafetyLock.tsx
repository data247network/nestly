import React from 'react'
import { enterSafetyLock, getSafetyLockStatus } from '../platform/safety-lock'

export default function ChildSafetyLock() {
  const [status, setStatus] = React.useState<Awaited<ReturnType<typeof getSafetyLockStatus>> | null>(null)
  const [locking, setLocking] = React.useState(false)

  React.useEffect(() => {
    void getSafetyLockStatus().then(setStatus)
  }, [])

  const lock = async () => {
    setLocking(true)
    try {
      const result = await enterSafetyLock()
      setStatus(result)
    } finally {
      setLocking(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#10251f] text-white flex items-center justify-center p-8">
      <section className="w-full max-w-md rounded-3xl bg-white/10 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl">🔒</div>
        <h1 className="text-3xl font-bold">Nestly is protected</h1>
        <p className="mt-4 text-lg leading-7 text-white/85">
          Please call your parent to continue.
        </p>
        <p className="mt-5 text-sm text-white/60">
          This phone is protected by the family safety settings. Do not try to remove or disable Nestly.
        </p>

        {status && !status.deviceOwner && (
          <p className="mt-5 rounded-xl bg-amber-300/15 p-3 text-sm text-amber-100">
            Full device protection is not provisioned on this phone yet.
          </p>
        )}

        <button
          type="button"
          onClick={lock}
          disabled={locking || !status?.canLock}
          className="mt-7 w-full rounded-2xl bg-white px-5 py-4 font-bold text-[#10251f] disabled:opacity-40"
        >
          {locking ? 'Locking phone…' : 'Keep phone locked'}
        </button>
      </section>
    </main>
  )
}
