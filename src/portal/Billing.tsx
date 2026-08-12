import { useCallback, useEffect, useState } from 'react'
import {
  createAdultInvite,
  formatPrice,
  loadAdults,
  loadPlans,
  nextPlanFor,
  removeAdult,
  type Adult,
  type HouseholdSummary,
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

  return (
    <div className="mt-4 rounded-2xl bg-amberBg px-4 py-3.5 text-[12.5px] leading-relaxed text-[#8A5A16]">
      {needAdults ? (
        <>Your {currentPlan} plan covers {needAdults - 1} adult{needAdults - 1 === 1 ? '' : 's'}. </>
      ) : (
        <>Your {currentPlan} plan covers {currentChildren} children. </>
      )}
      {next ? (
        <>
          Upgrade to <b>{next.name}</b> ({formatPrice(next.priceMonthly, next.currency)} a month)
          if you want to add more adults and children — it covers up to {next.maxChildren}{' '}
          children and {next.maxParents} adults.
        </>
      ) : plans ? (
        <>This is already the largest plan available.</>
      ) : (
        <>Checking plans…</>
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
  const [adults, setAdults] = useState<Adult[] | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [p, a] = await Promise.all([
      loadPlans().catch(() => [] as PlanRow[]),
      loadAdults(householdId).catch(() => [] as Adult[]),
    ])
    setPlans(p)
    setAdults(a)
  }, [householdId])

  useEffect(() => {
    void reload()
  }, [reload])

  const current = plans?.find((p) => p.id === data.plan) ?? null
  const adultsUsed = adults?.length ?? data.memberCount
  const adultsAllowed = current?.maxParents ?? 1
  const canAddAdult = adultsUsed < adultsAllowed
  const link = invite ? `${window.location.origin}/join/${invite}` : ''

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
      ) : canAddAdult ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void inviteAdult()}
          className="mt-3 rounded-xl border border-line px-4 py-3 text-[13.5px] font-bold text-brand disabled:opacity-50"
        >
          {busy ? 'Working…' : '+ Invite another adult'}
        </button>
      ) : (
        <UpgradeHint
          currentPlan={current?.name ?? data.plan}
          needAdults={adultsUsed + 1}
          needChildren={data.children.length}
        />
      )}

      <h2 className="mt-9 text-[12px] font-bold tracking-[0.06em] text-brand">PLANS</h2>

      {!plans ? (
        <p className="mt-2 text-[13px] text-body">Loading plans…</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {plans
            .filter((p) => p.active || p.id === data.plan)
            .map((p) => {
              const isCurrent = p.id === data.plan
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

                  <div className="mt-4">
                    {isCurrent ? (
                      <span className="block rounded-xl bg-white px-3 py-2.5 text-center text-[12.5px] font-bold text-brand">
                        Your current plan
                      </span>
                    ) : (
                      // No self-service upgrade until money can actually change
                      // hands. A button that silently granted a paid tier would
                      // be a hole, not a feature.
                      <span className="block rounded-xl bg-cream px-3 py-2.5 text-center text-[12.5px] font-bold text-muted">
                        Checkout coming soon
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
