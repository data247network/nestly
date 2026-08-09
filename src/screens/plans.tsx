import { useDevice } from '../platform/device'
import { useStore } from '../app/store'
import { PLANS, PLAN_ORDER, childCapacity } from '../app/plans'
import { BackButton, Display, ScreenTitle } from '../ui/kit'

/**
 * Plans.
 *
 * Every tier has the full feature set; what a plan buys is capacity. That is a
 * deliberate product line — withholding a safety feature behind a paywall in an
 * app whose whole promise is a child's safety would be indefensible — so this
 * screen compares people, not features.
 *
 * Billing is not wired up. Selecting a plan changes the limit locally so the
 * behaviour can be exercised end to end; real purchase flow needs the store
 * account and Google Play Billing, which arrive with the online service.
 */
export function Plans() {
  const { state, dispatch, go } = useStore()
  const { pairings } = useDevice()
  const capacity = childCapacity(state.plan, pairings.length)
  const monthly = state.billing === 'monthly'

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <BackButton onClick={() => go('pair')} />
      <ScreenTitle>Plans</ScreenTitle>

      <p className="text-[13px] leading-relaxed text-body">
        Every plan includes everything — location, zones, routines, web
        filtering and safety alerts. What changes is how many people are covered.
      </p>

      <div className="flex rounded-[14px] bg-cream p-1">
        {(['monthly', 'annual'] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => dispatch({ type: 'billing', value: b })}
            className={`flex-1 rounded-[11px] px-3 py-2 text-[12.5px] font-bold transition ${
              state.billing === b ? 'bg-brand text-white' : 'text-body'
            }`}
          >
            {b === 'monthly' ? 'Monthly' : 'Annual · save 25%'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id]
          const current = state.plan === id
          const tooSmall = plan.children < pairings.length
          return (
            <button
              key={id}
              type="button"
              disabled={tooSmall}
              onClick={() => dispatch({ type: 'setPlan', plan: id })}
              className={`rounded-2xl border-[1.5px] p-4 text-left transition ${
                current
                  ? 'border-brand bg-tint'
                  : tooSmall
                    ? 'border-line bg-cream/60 opacity-60'
                    : 'border-line bg-white'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <div className="text-[15px] font-bold">{plan.name}</div>
                <Display className="text-[19px]">
                  {monthly ? plan.priceMonthly : plan.priceAnnual}
                  <span className="text-[11px] font-semibold text-body">
                    {plan.priceMonthly === '£0' ? '' : monthly ? '/mo' : '/yr'}
                  </span>
                </Display>
              </div>

              <div className="mt-1 text-[12px] text-body">{plan.blurb}</div>

              <div className="mt-2.5 flex gap-2">
                <span className="rounded-lg bg-cream px-2 py-1 text-[11px] font-bold">
                  {plan.parents} {plan.parents === 1 ? 'adult' : 'adults'}
                </span>
                <span className="rounded-lg bg-cream px-2 py-1 text-[11px] font-bold">
                  {plan.children} children
                </span>
                {current ? (
                  <span className="rounded-lg bg-brand px-2 py-1 text-[11px] font-bold text-white">
                    Current
                  </span>
                ) : null}
              </div>

              {tooSmall ? (
                <div className="mt-2 text-[11px] text-coralInk">
                  You have {pairings.length} devices paired — remove one to move
                  down to this plan.
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="rounded-2xl bg-cream px-4 py-3 text-[11.5px] leading-relaxed text-body">
        You are using <b>{capacity.used}</b> of {capacity.limit} child devices on{' '}
        {capacity.plan.name}.
        {capacity.plan.parents > 1
          ? ` Up to ${capacity.plan.parents} adults can hold a parent phone.`
          : ''}
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted">
        Payment is not connected yet — choosing a plan here changes the device
        limit so you can try it. Real billing arrives with the online service,
        along with a second parent phone sharing the same household.
      </p>
    </div>
  )
}
