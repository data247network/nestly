import { useStore } from '../app/store'
import { useDevice } from '../platform/device'
import { MAX_EMERGENCY_CONTACTS } from '../link/protocol'
import { BackButton, Field, FieldLabel, GhostButton, PrimaryButton, ScreenTitle } from '../ui/kit'

/**
 * Emergency contacts — the numbers the child can dial even while their phone is
 * locked.
 *
 * Only the parent can set them, and they ride down with the policy, so they
 * work with no network and no parent nearby. That constraint is the reason this
 * screen exists at all: without it, locking a phone would mean cutting a child
 * off from help.
 */
export function EmergencyContacts() {
  const { state, go, dispatch } = useStore()
  const { link } = useDevice()
  const contacts = state.emergencyContacts
  const usable = contacts.filter((c) => c.phone.trim().length > 0).length
  const full = contacts.length >= MAX_EMERGENCY_CONTACTS

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <BackButton onClick={() => go('screentime')} />
      <ScreenTitle>Emergency contacts</ScreenTitle>

      <p className="text-[13px] leading-relaxed text-body">
        These appear on your child's lock screen and can be called even while a
        routine is running. Up to {MAX_EMERGENCY_CONTACTS}.
      </p>

      <div className="flex flex-col gap-3">
        {contacts.map((c, i) => (
          <div key={c.id} className="rounded-2xl bg-cream p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                Contact {i + 1}
              </span>
              <button
                type="button"
                onClick={() => dispatch({ type: 'removeContact', id: c.id })}
                className="text-[11.5px] font-bold text-coralInk"
              >
                Remove
              </button>
            </div>

            <FieldLabel>NAME</FieldLabel>
            <div className="mb-3">
              <Field
                value={c.name}
                placeholder="e.g. Mum, Dad, Grandma"
                onChange={(name) => dispatch({ type: 'patchContact', id: c.id, patch: { name } })}
              />
            </div>

            <FieldLabel>PHONE NUMBER</FieldLabel>
            <input
              type="tel"
              inputMode="tel"
              value={c.phone}
              placeholder="+44 7700 900000"
              onChange={(e) =>
                dispatch({ type: 'patchContact', id: c.id, patch: { phone: e.target.value } })
              }
              className="w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
            {c.phone.trim().length === 0 ? (
              <div className="mt-1.5 text-[11.5px] text-body">
                Needs a number before it shows on the lock screen.
              </div>
            ) : null}
          </div>
        ))}

        {contacts.length === 0 ? (
          <div className="rounded-2xl bg-coralBg px-4 py-4 text-[12.5px] leading-relaxed text-coralInk">
            No emergency numbers set. If you lock your child's phone right now,
            they will have no way to call you from it.
          </div>
        ) : null}
      </div>

      <GhostButton
        onClick={() => dispatch({ type: 'addContact' })}
        className={full ? 'pointer-events-none opacity-40' : ''}
      >
        {full ? `Maximum of ${MAX_EMERGENCY_CONTACTS} reached` : '+ Add a contact'}
      </GhostButton>

      <div className="rounded-2xl bg-tint px-4 py-3 text-[11.5px] leading-relaxed text-tealInk">
        Saved on your child's phone, so these still work with no signal and no
        internet.{' '}
        {link.state === 'connected'
          ? 'Their phone has the current list.'
          : "Changes reach their phone next time you're near each other."}
      </div>

      <div className="flex-1" />
      <PrimaryButton onClick={() => go('screentime')}>
        {usable > 0 ? `Done — ${usable} on the lock screen` : 'Done'}
      </PrimaryButton>
    </div>
  )
}
