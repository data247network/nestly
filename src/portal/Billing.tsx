import { useCallback, useEffect, useState } from 'react'
import {
  createAdultInvite,
  formatPrice,
  loadAdults,
  loadPlanPrices,
  loadPlans,
  loadAddonPrices,
  type AddonPrice,
  loadSubscription,
  nextPlanFor,
  openBillingPortal,
  removeAdult,
  startCheckout,
  type CurrencyPrice,
  type Adult,
  type HouseholdSubscription,
  type HouseholdSummary,
  type PayProvider,
  type PlanRow,
} from '../cloud/sync'
import { Display } from '../ui/kit'

/**
 * Plan, price and the people on the account.
 *
 * Two gaps this closes. A parent at their child limit was told to "upgrade"
 * without being told to what — the moment they are most likely to give up. And
 * a household could only ever contain the adult who created it, so the second
 * adult a paid tier advertises was unreachable: there was no way to invite one.
 *
 * Plans are read from the database rather than compiled in, so what a parent
 * sees is what is actually being charged, and an admin can change a price
 * without a release on every phone.
 */

/** Names the plan that would actually solve the problem, with its price. */
export function UpgradeHint({
  currentPlan,
  currentChildren,
  needChildren,
  needAdults,
}: {
  currentPlan: string
  currentChildren?: number
  needChildren?: number
  needAdults?: number
}) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null)

  useEffect(() => {
    void loadPlans()
      .then(setPlans)
      .catch(() => setPlans([]))
  }, [])

  const next = plans ? nextPlanFor(plans, { children: needChildren, adults: needAdults }) : null

  const [addon, setAddon] = useState<AddonPrice | null>(null)

  useEffect(() => {
    void loadAddonPrices()
      .then((rows) => {
        // The currency the plan itself is quoted in, so the two figures on
        // screen are comparable. Mixing £ and ₦ in one sentence is how someone
        // reads the add-on as the cheaper option by a factor of a thousand.
        const want = next?.currency ?? 'GBP'
        setAddon(rows.find((r) => r.currency === want) ?? rows[0] ?? null)
      })
      .catch(() => setAddon(null))
  }, [next?.currency])

  const unit = needAdults ? 'adult' : 'child'

  return (
    <div className="mt-4 rounded-2xl bg-amberBg px-4 py-4 text-[12.5px] leading-relaxed text-[#8A5A16]">
      <div className="text-[13px] font-bold">
        That is more than your {currentPlan} plan covers
      </div>
      <p className="mt-1">
        {needAdults ? (
          <>
            {currentPlan} includes {needAdults - 1} adult
            {needAdults - 1 === 1 ? '' : 's'}, and you are adding another.
          </>
        ) : (
          <>
            {currentPlan} includes {currentChildren} children, and you are adding
            another.
          </>
        )}{' '}
        You can carry on — the extra {unit} is charged on top of your plan.
      </p>

      {addon ? (
        <div className="mt-3 rounded-xl bg-white/70 px-3.5 py-2.5">
          <div className="font-bold">
            One extra {unit}: {formatPrice(addon.monthly, addon.currency)} a month, or{' '}
            {formatPrice(addon.annual, addon.currency)} a year
          </div>
          <div className="mt-0.5 opacity-80">
            Added to what you already pay, for as long as you keep it.
          </div>
        </div>
      ) : null}

      {/* The upgrade is offered second and framed as the alternative, because a
          family who needs one more slot is usually better off with the unit —
          and a family who needs several is not. Both numbers are on screen so
          they can see which they are. */}
      {next ? (
        <p className="mt-3">
          Adding several? <b>{next.name}</b> is{' '}
          {formatPrice(next.priceMonthly, next.currency)} a month and covers{' '}
          {next.maxChildren} children and {next.maxParents} adults — likely
          cheaper than buying them one at a time.
        </p>
      ) : plans ? (
        <p className="mt-3">
          You are already on the largest plan, so extras are the only way to add
          more.
        </p>
      ) : (
        <p className="mt-3">Checking plans…</p>
      )}
    </div>
  )
}

export function Billing({
  data,
  householdId,
  onChanged,
}: {
  data: HouseholdSummary
  householdId: string
  onChanged: () => void
}) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [prices, setPrices] = useState<Record<string, CurrencyPrice[]>>({})
  const [adults, setAdults] = useState<Adult[] | null>(null)
  const [subscription, setSubscription] = useState<HouseholdSubscription | null>(null)
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [payingPlan, setPayingPlan] = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [p, a, pr, sub] = await Promise.all([
      loadPlans().catch(() => [] as PlanRow[]),
      loadAdults(householdId).catch(() => [] as Adult[]),
      loadPlanPrices().catch(() => ({}) as Record<string, CurrencyPrice[]>),
      loadSubscription(householdId).catch(() => null),
    ])
    setPlans(p)
    setAdults(a)
    setPrices(pr)
    setSubscription(sub)
  }, [householdId])

  useEffect(() => {
    void reload()
  }, [reload])

  const current = plans?.find((p) => p.id === data.plan) ?? null
  const adultsUsed = adults?.length ?? data.memberCount
  const adultsAllowed = current?.maxParents ?? 1
  const canAddAdult = adultsUsed < adultsAllowed
  const link = invite ? `${window.location.origin}/join/${invite}` : ''

  /**
   * Sends the customer to the provider.
   *
   * A full navigation rather than a popup: payment pages are routinely blocked
   * as popups, and a blocked window looks to a parent like the button is broken.
   */
  const pay = async (provider: PayProvider, planId: string) => {
    setPayingPlan(`${planId}:${provider}`)
    setError(null)
    try {
      window.location.assign(await startCheckout(provider, householdId, planId, period))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout.')
      setPayingPlan(null)
    }
  }

  /** Cancelling, and changing the card, both live on Stripe's hosted page. */
  const manageBilling = async () => {
    setBusy(true)
    setError(null)
    try {
      window.location.assign(await openBillingPortal(householdId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open billing.')
      setBusy(false)
    }
  }

  const inviteAdult = async () => {
    setBusy(true)
    setError(null)
    try {
      setInvite(await createAdultInvite(householdId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create an invitation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Display className="text-[26px]">Plan &amp; billing</Display>
      <p className="mt-1 text-[13.5px] text-body">
        {current
          ? `You are on ${current.name} — up to ${current.maxChildren} children and ${current.maxParents} ${
              current.maxParents === 1 ? 'adult' : 'adults'
            }.`
          : `You are on the ${data.plan} plan.`}
      </p>

      {error ? (
        <div className="mt-4 rounded-xl bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      {/* A subscription a parent cannot cancel from inside the product is not
          one to sell. Only shown for Stripe: an OPay household bought a fixed
          period and has nothing running to stop. */}
      {subscription?.manageable ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[13px] font-bold">
              {subscription.status === 'past_due'
                ? 'Your last payment did not go through'
                : 'Subscription active'}
            </div>
            <div className="mt-0.5 text-[11.5px] text-body">
              {subscription.status === 'past_due'
                ? 'Update your card to keep the plan. Nothing changes until Stripe stops retrying.'
                : subscription.currentPeriodEnd
                  ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}.`
                  : 'Renews automatically.'}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void manageBilling()}
            className="shrink-0 rounded-xl border border-line px-4 py-2.5 text-[12.5px] font-bold text-brand disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Manage or cancel'}
          </button>
        </div>
      ) : null}

      <h2 className="mt-8 text-[12px] font-bold tracking-[0.06em] text-brand">
        ADULTS ON THIS ACCOUNT
      </h2>
      <p className="mt-1 text-[12.5px] text-body">
        {adultsUsed} of {adultsAllowed} used. Every adult sees the same children and the same
        alerts.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {(adults ?? []).map((a) => (
          <div key={a.userId} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">
                {a.isSelf ? 'You' : 'Co-parent'}{' '}
                <span className="text-[11.5px] font-normal text-muted">({a.role})</span>
              </div>
              <div className="text-[11.5px] text-body">
                Joined {new Date(a.joinedAt).toLocaleDateString()}
              </div>
            </div>
            {!a.isSelf ? (
              <button
                type="button"
                onClick={() =>
                  void removeAdult(householdId, a.userId).then(() => {
                    void reload()
                    onChanged()
                  })
                }
                className="text-[11.5px] font-bold text-coralInk"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {invite ? (
        <div className="mt-3 rounded-2xl bg-tint p-4">
          <div className="text-[12px] font-bold text-tealInk">Send this link to the other adult</div>
          <div className="mt-1.5 break-all rounded-xl bg-white px-3 py-2 text-[12px] text-slate2">
            {link}
          </div>
          <div className="mt-2 text-[11.5px] leading-relaxed text-tealInk">
            They create their own account, then join this family. Expires in 7 days, and works
            once.
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(
                () => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                },
                () => {},
              )
            }}
            className="mt-2.5 rounded-xl bg-brand px-3.5 py-2 text-[12.5px] font-bold text-white"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : (
        <>
          {/* Priced, not refused — the same rule as children. Within the limit
              this says nothing at all. */}
          {!canAddAdult ? (
            <UpgradeHint
              currentPlan={current?.name ?? data.plan}
              needAdults={adultsUsed + 1}
              needChildren={data.children.length}
            />
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void inviteAdult()}
            className="mt-3 rounded-xl border border-line px-4 py-3 text-[13.5px] font-bold text-brand disabled:opacity-50"
          >
            {busy ? 'Working…' : '+ Invite another adult'}
          </button>
        </>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[12px] font-bold tracking-[0.06em] text-brand">PLANS</h2>
        <div className="flex gap-1 rounded-xl bg-cream p-1">
          {(['monthly', 'annual'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPeriod(v)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-bold ${
                period === v ? 'bg-white text-ink' : 'text-body'
              }`}
            >
              {v === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>

      {!plans ? (
        <p className="mt-2 text-[13px] text-body">Loading plans…</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {plans
            .filter((p) => p.active || p.id === data.plan)
            .map((p) => {
              const isCurrent = p.id === data.plan
              // Priced at nothing in every currency it is offered in — which is
              // what "free" means here, rather than a plan somebody forgot to
              // price.
              const isFree = p.priceMonthly === 0 && p.priceAnnual === 0
              // Two providers, two currencies, and they are not alternatives to
              // each other in a way the customer can ignore: Stripe subscribes,
              // OPay sells one fixed period. Pounds lead because pounds are what
              // the card above quotes — the button used to offer naira under a
              // sterling headline, which is not a price anyone agreed to.
              const amountFor = (c: CurrencyPrice | undefined) =>
                c ? (period === 'annual' ? c.annual : c.monthly) : 0
              const gbp = (prices[p.id] ?? []).find((x) => x.currency === 'GBP')
              const ngn = (prices[p.id] ?? []).find((x) => x.currency === 'NGN')
              const gbpAmount = amountFor(gbp)
              const ngnAmount = amountFor(ngn)
              const busyWith = (provider: PayProvider) => payingPlan === `${p.id}:${provider}`
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl border p-5 ${isCurrent ? 'border-brand bg-tint' : 'border-line'}`}
                >
                  <div className="text-[15px] font-bold">{p.name}</div>
                  <div className="mt-1 text-[22px] font-extrabold text-ink">
                    {formatPrice(p.priceMonthly, p.currency)}
                    {p.priceMonthly > 0 ? (
                      <span className="text-[12px] font-bold text-body"> /month</span>
                    ) : null}
                  </div>
                  {p.priceAnnual > 0 ? (
                    <div className="text-[11.5px] text-body">
                      or {formatPrice(p.priceAnnual, p.currency)} a year
                    </div>
                  ) : null}
                  <ul className="mt-3 flex flex-col gap-1 text-[12.5px] text-body">
                    <li>Up to {p.maxChildren} children</li>
                    <li>
                      {p.maxParents} {p.maxParents === 1 ? 'adult' : 'adults'}
                    </li>
                    <li>Every feature included</li>
                  </ul>
                  {p.blurb ? (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{p.blurb}</p>
                  ) : null}

                  <div className="mt-4 flex flex-col gap-2">
                    {isCurrent ? (
                      <span className="block rounded-xl bg-white px-3 py-2.5 text-center text-[12.5px] font-bold text-brand">
                        Your current plan
                      </span>
                    ) : gbpAmount > 0 || ngnAmount > 0 ? (
                      <>
                        {gbpAmount > 0 ? (
                          <button
                            type="button"
                            disabled={payingPlan !== null}
                            onClick={() => void pay('stripe', p.id)}
                            className="block w-full rounded-xl bg-brand px-3 py-2.5 text-center text-[12.5px] font-bold text-white disabled:opacity-50"
                          >
                            {busyWith('stripe')
                              ? 'Opening checkout…'
                              : `Pay ${formatPrice(gbpAmount, 'GBP')} ${
                                  period === 'annual' ? 'a year' : 'a month'
                                }`}
                          </button>
                        ) : null}

                        {ngnAmount > 0 ? (
                          <button
                            type="button"
                            disabled={payingPlan !== null}
                            onClick={() => void pay('paystack', p.id)}
                            className={`block w-full rounded-xl px-3 py-2.5 text-center text-[12.5px] font-bold disabled:opacity-50 ${
                              gbpAmount > 0
                                ? 'border border-line text-brand'
                                : 'bg-brand text-white'
                            }`}
                          >
                            {busyWith('paystack')
                              ? 'Opening checkout…'
                              : `Pay ${formatPrice(ngnAmount, 'NGN')} in naira`}
                          </button>
                        ) : null}

                        {/* The two are not the same product, and a customer
                            choosing between them deserves to be told which
                            renews before they pay rather than after. */}
                        <p className="text-[10.5px] leading-snug text-muted">
                          {gbpAmount > 0 && ngnAmount > 0
                            ? 'Card renews automatically until you cancel. Naira buys one ' +
                              (period === 'annual' ? 'year' : 'month') +
                              ', with nothing to cancel.'
                            : gbpAmount > 0
                              ? 'Renews automatically until you cancel.'
                              : 'Buys one ' +
                                (period === 'annual' ? 'year' : 'month') +
                                ', with nothing to cancel.'}
                        </p>
                      </>
                    ) : isFree ? (
                      // The free tier has no price *by design*, so saying its
                      // price is missing reads as a broken plan rather than a
                      // free one — and it was showing on the card headed
                      // "Free".
                      <span className="block rounded-xl bg-cream px-3 py-2.5 text-center text-[12.5px] font-bold text-body">
                        Free — no card needed
                      </span>
                    ) : (
                      // A paid tier with no price behind it is genuinely
                      // misconfigured. Refused rather than priced at zero: a
                      // checkout button with nothing behind it takes the
                      // customer to a broken page, which is worse than saying
                      // so here.
                      <span className="block rounded-xl bg-cream px-3 py-2.5 text-center text-[12.5px] font-bold text-muted">
                        No price set yet
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      <div className="mt-5 rounded-2xl bg-cream px-4 py-3.5 text-[12px] leading-relaxed text-body">
        Payments are not connected yet. When they are, subscriptions will be bought here on the
        web rather than inside the app — which is what keeps the price the same on every phone.
      </div>
    </>
  )
}
