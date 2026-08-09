/**
 * Subscription tiers and the device limits they unlock.
 *
 * The limits are the product: a plan is not a feature gate here, it is a
 * capacity gate. Every tier gets the full feature set — location, scenarios,
 * filtering, safety alerts — because a family-safety app that withholds a
 * safety feature behind a paywall is indefensible. What you pay for is more
 * people on the plan.
 */

export type PlanId = 'free' | 'pro' | 'premium'

export type Plan = {
  id: PlanId
  name: string
  /** Adults who can hold a parent device on this plan. */
  parents: number
  children: number
  priceMonthly: string
  priceAnnual: string
  blurb: string
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Family',
    parents: 1,
    children: 2,
    priceMonthly: '£0',
    priceAnnual: '£0',
    blurb: 'One parent and up to two children, with every feature included.',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    parents: 2,
    children: 4,
    priceMonthly: '£4.99',
    priceAnnual: '£45',
    blurb: 'Two parents and up to four children — both adults see the same picture.',
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    parents: 3,
    children: 6,
    priceMonthly: '£7.99',
    priceAnnual: '£72',
    blurb: 'Three adults and up to six children, for larger or blended households.',
  },
}

export const PLAN_ORDER: PlanId[] = ['free', 'pro', 'premium']

export function planOf(id: PlanId | undefined): Plan {
  return PLANS[id ?? 'free'] ?? PLANS.free
}

/** The cheapest plan that would fit this many children. */
export function smallestPlanFor(childCount: number): Plan | null {
  return PLAN_ORDER.map((id) => PLANS[id]).find((p) => p.children >= childCount) ?? null
}

export type Capacity = {
  plan: Plan
  used: number
  limit: number
  remaining: number
  atLimit: boolean
  /** The plan to suggest when they have run out, or null at the top tier. */
  upgrade: Plan | null
}

export function childCapacity(planId: PlanId | undefined, used: number): Capacity {
  const plan = planOf(planId)
  const remaining = Math.max(0, plan.children - used)
  const next = PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan.id) + 1)
    .map((id) => PLANS[id])
    .find((p) => p.children > plan.children)
  return {
    plan,
    used,
    limit: plan.children,
    remaining,
    atLimit: remaining === 0,
    upgrade: next ?? null,
  }
}

/**
 * Why a pairing attempt was refused, phrased for the parent rather than the
 * developer. Returns null when it is allowed.
 */
export function pairingBlockedReason(planId: PlanId | undefined, used: number): string | null {
  const cap = childCapacity(planId, used)
  if (!cap.atLimit) return null
  return cap.upgrade
    ? `Your ${cap.plan.name} plan covers ${cap.limit} ${cap.limit === 1 ? 'child' : 'children'}. Upgrade to ${cap.upgrade.name} for up to ${cap.upgrade.children}.`
    : `You have reached the maximum of ${cap.limit} children on ${cap.plan.name}.`
}
