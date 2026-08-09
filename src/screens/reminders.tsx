import { useState } from 'react'
import { useStore } from '../app/store'
import { MAX_REMINDERS, formatClock, parseClock } from '../link/protocol'
import { Field, FieldLabel, GhostButton, SectionTitle, Toggle } from '../ui/kit'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * Reminders the parent sets and the child's phone shows.
 *
 * These ride in the policy rather than going out as messages, so they fire on
 * time whether or not the phones are near each other — which is the whole
 * point. A reminder that only arrives when you are already in the same room is
 * something you could have said out loud.
 *
 * Lives inside the Limits tab: it is the same question as scenarios ("what
 * should happen on their phone, and when"), just a nudge instead of a block.
 */
export function Reminders() {
  const { state, dispatch } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const full = state.reminders.length >= MAX_REMINDERS

  return (
    <div>
      <SectionTitle
        action={
          <span className="text-[11px] font-semibold text-muted">
            Shown on their phone
          </span>
        }
      >
        Reminders
      </SectionTitle>

      <div className="flex flex-col gap-2.5">
        {state.reminders.map((r) => {
          const open = openId === r.id
          const untitled = !r.title.trim()
          return (
            <div key={r.id} className="rounded-[14px] bg-cream p-3.5">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setOpenId(open ? null : r.id)}
                >
                  <div className={`text-[13.5px] font-bold ${untitled ? 'text-muted' : ''}`}>
                    {r.title.trim() || 'Untitled reminder'}
                  </div>
                  <div className="text-[11.5px] text-body">
                    {formatClock(r.atMin)} · {describeDays(r.days)}
                    {untitled ? ' · needs a title to send' : ''}
                  </div>
                </button>
                <Toggle
                  on={r.enabled}
                  label={r.title || 'Reminder'}
                  onChange={(v) =>
                    dispatch({ type: 'patchReminder', id: r.id, patch: { enabled: v } })
                  }
                />
              </div>

              {open ? (
                <div className="mt-3.5 flex flex-col gap-3 border-t border-line pt-3.5">
                  <div>
                    <FieldLabel>REMINDER</FieldLabel>
                    <Field
                      value={r.title}
                      placeholder="e.g. Take your inhaler"
                      onChange={(v) =>
                        dispatch({ type: 'patchReminder', id: r.id, patch: { title: v } })
                      }
                    />
                  </div>

                  <div>
                    <FieldLabel>NOTE (OPTIONAL)</FieldLabel>
                    <Field
                      value={r.note ?? ''}
                      placeholder="Anything they should know"
                      onChange={(v) =>
                        dispatch({ type: 'patchReminder', id: r.id, patch: { note: v } })
                      }
                    />
                  </div>

                  <div>
                    <FieldLabel>TIME</FieldLabel>
                    <input
                      type="time"
                      value={toInputTime(r.atMin)}
                      onChange={(e) =>
                        dispatch({
                          type: 'patchReminder',
                          id: r.id,
                          patch: { atMin: fromInputTime(e.target.value) },
                        })
                      }
                      className="w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-sm outline-none focus:border-brand"
                    />
                  </div>

                  <div>
                    <FieldLabel>DAYS</FieldLabel>
                    <div className="flex gap-1.5">
                      {DAY_LETTERS.map((d, i) => {
                        // Empty means every day, so show them all lit rather
                        // than all dark — otherwise a new reminder reads as
                        // "never" when it actually fires daily.
                        const on = r.days.length === 0 || r.days.includes(i)
                        return (
                          <button
                            key={i}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              dispatch({ type: 'toggleReminderDay', id: r.id, day: i })
                            }
                            className={`flex h-8 w-8 items-center justify-center rounded-[9px] text-[11px] font-bold transition ${
                              on ? 'bg-brand text-white' : 'bg-white text-muted'
                            }`}
                          >
                            {d}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'removeReminder', id: r.id })
                      setOpenId(null)
                    }}
                    className="self-start text-[12.5px] font-bold text-coralInk"
                  >
                    Delete reminder
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}

        {state.reminders.length === 0 ? (
          <div className="rounded-[14px] bg-cream px-4 py-5 text-center text-[12.5px] leading-relaxed text-body">
            No reminders yet. They show on your child's phone at the time you
            set, even when you're apart.
          </div>
        ) : null}

        <GhostButton
          onClick={() => !full && dispatch({ type: 'addReminder' })}
          className={full ? 'opacity-45' : ''}
        >
          {full ? `Maximum of ${MAX_REMINDERS} reached` : '+ Add a reminder'}
        </GhostButton>
      </div>
    </div>
  )
}

function describeDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Every day'
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 5 && sorted.every((d, i) => d === i)) return 'Weekdays'
  if (sorted.length === 2 && sorted[0] === 5 && sorted[1] === 6) return 'Weekends'
  return sorted.map((d) => names[d]).join(', ')
}

/** Minutes -> "HH:MM" for <input type="time">. */
function toInputTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function fromInputTime(value: string): number {
  return parseClock(value)
}
