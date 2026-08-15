import { useEffect, useRef, useState } from 'react'
import { useDevice } from '../platform/device'
import { useStore } from '../app/store'
import { useOnline } from '../platform/online'
import { ScreenTitle } from '../ui/kit'
import { ago } from './setup'

/**
 * Notes between the two phones.
 *
 * This is not a chat and does not pretend to be. A note travels over the
 * internet where there is one and over Bluetooth where there is not, and either
 * way it shows its real state: waiting until the other phone actually holds it,
 * then delivered. A tick that means "probably" would be worse than no tick at
 * all — a parent has to be able to tell whether their child has really seen
 * something.
 *
 * The status line is written from what is true rather than from what is hoped.
 * It used to promise that notes "cross straight away" whenever Bluetooth was
 * connected and otherwise that they would wait for the phones to be near each
 * other — which stopped being true the moment notes went over the internet, and
 * was the sort of wrong that makes someone resend a note that already arrived.
 *
 * Runs on both devices; the only difference is which side of the thread is
 * "you".
 */
export function FamilyHub() {
  const { notes: allNotes, sendNote, role, name, link } = useDevice()
  const { state } = useStore()
  const online = useOnline()
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  /**
   * One thread per child, on a parent's phone.
   *
   * This screen used to pour every child's notes into a single list and
   * broadcast anything typed to all of them at once. With one child that is
   * indistinguishable from correct; with two it is neither — a note meant for
   * one is sent to both, and the reply comes back into a thread that does not
   * say who wrote it. A parent testing it reasonably concluded the second
   * child's notes were simply not arriving.
   *
   * A child's phone has exactly one correspondent, so it keeps the plain list.
   */
  const children = role === 'parent' ? state.children : []
  const activeId = selected ?? children[0]?.id ?? null
  const active = children.find((c) => c.id === activeId) ?? null
  const notes = role === 'parent' ? allNotes.filter((n) => n.childId === activeId) : allNotes

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [notes.length, activeId])

  const other = role === 'parent' ? (active?.name ?? 'your child') : 'your parent'
  const pending = notes.filter((n) => n.from === role && !n.delivered).length
  const near = link.state === 'connected'

  /** Unread per child, so a tab can say which one is waiting on you. */
  const unreadFor = (childId: string) =>
    allNotes.filter((n) => n.childId === childId && n.from !== role).length

  const status = (() => {
    if (pending > 0) {
      // Deliberately not "sent". The server may well have it; that is not the
      // question being asked, which is whether the other phone does.
      return online || near
        ? `${pending} waiting to reach ${other}.`
        : `${pending} waiting. They'll go as soon as you're back online, or when your phones are next close.`
    }
    if (online) return `Notes reach ${other} wherever they are.`
    if (near) return `No connection — but ${other} is close by, so notes still cross.`
    return `No connection. Notes will go when you're back online, or when your phones are next close.`
  })()

  const submit = () => {
    const text = draft
    setDraft('')
    // Addressed, not broadcast. On a child's phone there is only one
    // destination and `childId` is ignored.
    void sendNote(text, activeId ?? undefined)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-[22px] pb-3 pt-6">
        <ScreenTitle>Notes</ScreenTitle>

        {/* Only worth the space with more than one child. A single tab that can
            never be switched is furniture. */}
        {children.length > 1 ? (
          <div className="no-scrollbar -mx-[22px] mt-2.5 flex gap-1.5 overflow-x-auto px-[22px]">
            {children.map((c) => {
              const unread = unreadFor(c.id)
              const on = c.id === activeId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition ${
                    on ? 'bg-brand text-white' : 'bg-cream text-body'
                  }`}
                >
                  {c.name}
                  {unread > 0 && !on ? (
                    <span className="rounded-full bg-brand px-1.5 text-[10px] text-white">
                      {unread}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="mt-1.5 text-[11.5px] leading-snug text-body">{status}</div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-[18px]">
        {notes.length === 0 ? (
          <div className="my-auto rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] leading-relaxed text-body">
            No notes yet.
            <br />
            Leave one — it goes over the internet, or over Bluetooth when your
            phones are close.
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
                {/* "waiting", not "waiting to send": it may well have been
                    sent, and be sitting on the server until the other phone
                    picks it up. What the sender wants to know is whether it
                    arrived. */}
                {mine ? (n.delivered ? ' · delivered' : ' · waiting') : ''}
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
