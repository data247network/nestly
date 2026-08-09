import { useEffect, useRef, useState } from 'react'
import { useDevice } from '../platform/device'
import { ScreenTitle } from '../ui/kit'
import { ago } from './setup'

/**
 * Notes between the two phones.
 *
 * This is not a chat and does not pretend to be. Over Bluetooth a note can only
 * cross when the phones are near each other, so each one shows its real state:
 * queued until the other phone has it, then delivered. A tick that means
 * "probably" would be worse than no tick at all — a parent has to be able to
 * tell whether their child has actually seen something.
 *
 * Runs on both devices; the only difference is which side of the thread is
 * "you".
 */
export function FamilyHub() {
  const { notes, sendNote, role, name, child, link } = useDevice()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [notes.length])

  const other =
    role === 'parent' ? (child?.name ?? 'your child') : 'your parent'
  const pending = notes.filter((n) => n.from === role && !n.delivered).length

  const submit = () => {
    const text = draft
    setDraft('')
    void sendNote(text)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-[22px] pb-3 pt-6">
        <ScreenTitle>Notes</ScreenTitle>
        <div className="mt-1 text-[11.5px] leading-snug text-body">
          {link.state === 'connected'
            ? `Connected to ${other} — notes cross straight away.`
            : pending > 0
              ? `${pending} waiting. They'll cross next time the phones are near each other.`
              : `Left for ${other}. Delivered when your phones are next close.`}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-[18px]">
        {notes.length === 0 ? (
          <div className="my-auto rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] leading-relaxed text-body">
            No notes yet.
            <br />
            Leave one — it arrives when your phones are next together.
          </div>
        ) : null}

        {notes.map((n) => {
          const mine = n.from === role
          return (
            <div key={n.id} className={`max-w-[78%] ${mine ? 'self-end' : 'self-start'}`}>
              <div
                className={`px-3.5 py-2.5 text-[13px] ${
                  mine
                    ? 'rounded-[16px] rounded-br-[4px] bg-brand text-white'
                    : 'rounded-[16px] rounded-bl-[4px] bg-cream'
                }`}
              >
                {n.text}
              </div>
              <div
                className={`mt-1 text-[10.5px] text-muted ${mine ? 'text-right' : 'text-left'}`}
              >
                {ago(n.ts)}
                {mine ? (n.delivered ? ' · delivered' : ' · waiting to send') : ''}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="safe-bottom flex items-center gap-2.5 border-t border-line px-5 pb-[22px] pt-3.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={role === 'parent' ? `Note for ${other}…` : 'Note for your parent…'}
          className="flex-1 rounded-[20px] border-[1.5px] border-line px-4 py-2.5 text-[13px] outline-none placeholder:text-muted focus:border-brand"
        />
        <button
          type="button"
          onClick={submit}
          aria-label="Send"
          disabled={!draft.trim()}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand text-white transition active:scale-95 disabled:opacity-35"
        >
          →
        </button>
      </div>
      <div className="px-5 pb-2 text-center text-[10px] text-muted">
        Signed in as {name}
      </div>
    </div>
  )
}
