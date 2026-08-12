import { useCallback, useEffect, useState } from 'react'
import {
  adminDeletePlan,
  adminUpsertPlan,
  formatPrice,
  loadPlans,
  type PlanRow,
} from '../cloud/sync'
import { Display } from '../ui/kit'

/**
 * Plan administration.
 *
 * Plans were compiled into the app, so a price change meant a release on every
 * phone. They are rows now, and this is where they are created, priced and
 * retired.
 *
 * Writes go through `admin_upsert_plan` / `admin_delete_plan`, which check
 * owner membership themselves. Nothing here is trusted — hiding a button is a
 * courtesy, not a control, and the same call from a console is refused.
 */

type Draft = PlanRow & { sort: number }

const BLANK: Draft = {
  id: '',
  name: '',
  maxParents: 1,
  maxChildren: 1,
  priceMonthly: 0,
  priceAnnual: 0,
  currency: 'GBP',
  blurb: '',
  active: true,
  sort: 0,
}

export function PlanEditor() {
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setPlans(await loadPlans())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load plans.')
      setPlans([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await adminUpsertPlan(draft)
      setDraft(null)
      setCreating(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that plan.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await adminDeletePlan(id)
      setConfirming(null)
      await load()
    } catch (e) {
      // The common refusal is "households are on this plan", which is the
      // useful message — show it rather than a generic failure.
      setError(e instanceof Error ? e.message : 'Could not delete that plan.')
    } finally {
      setBusy(false)
    }
  }

  if (!plans) return <p className="text-[13px] text-body">Loading plans…</p>

  return (
    <>
      <Display className="text-[26px]">Plans &amp; billing</Display>
      <p className="mt-1 text-[13px] text-body">
        Create, price and retire subscription tiers. Limits take effect
        immediately for every family on that plan.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {plans.map((p) => (
          <div key={p.id} className="rounded-2xl border border-line px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold">{p.name}</span>
                  <span className="rounded-full bg-cream px-2 py-0.5 text-[10.5px] font-bold text-body">
                    {p.id}
                  </span>
                  {!p.active ? (
                    <span className="rounded-full bg-amberBg px-2 py-0.5 text-[10.5px] font-bold text-[#8A5A16]">
                      retired
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[12px] text-body">
                  {formatPrice(p.priceMonthly, p.currency)}/mo ·{' '}
                  {formatPrice(p.priceAnnual, p.currency)}/yr · {p.maxChildren} children ·{' '}
                  {p.maxParents} {p.maxParents === 1 ? 'adult' : 'adults'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDraft({ ...p, sort: 0 })
                  setCreating(false)
                }}
                className="rounded-xl bg-cream px-3 py-2 text-[12px] font-bold text-body"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirming(p.id)}
                className="rounded-xl px-3 py-2 text-[12px] font-bold text-coralInk"
              >
                Delete
              </button>
            </div>

            {confirming === p.id ? (
              <div className="mt-3 rounded-xl bg-coralBg px-3.5 py-3">
                <div className="text-[12.5px] text-coralInk">
                  Delete <b>{p.name}</b>? If any family is on it the server will refuse —
                  retire it instead by unticking Active, which keeps existing families
                  working.
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(p.id)}
                    className="rounded-xl bg-coralInk px-3.5 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                  >
                    {busy ? 'Working…' : 'Delete plan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-xl px-3 py-2 text-[12px] font-bold text-body"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {draft ? (
        <Form
          draft={draft}
          creating={creating}
          busy={busy}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null)
            setCreating(false)
          }}
          onSave={() => void save()}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft({ ...BLANK })
            setCreating(true)
          }}
          className="mt-4 rounded-xl border border-line px-4 py-3 text-[13.5px] font-bold text-brand"
        >
          + New plan
        </button>
      )}
    </>
  )
}

function Form({
  draft,
  creating,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft
  creating: boolean
  busy: boolean
  onChange: (d: Draft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })

  return (
    <div className="mt-4 rounded-2xl border border-line p-5">
      <h3 className="text-[14px] font-bold">{creating ? 'New plan' : `Edit ${draft.name}`}</h3>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="ID (used in the database)">
          <input
            value={draft.id}
            // The id keys every household row, so it cannot be edited after
            // creation without orphaning them.
            disabled={!creating}
            onChange={(e) => set('id', e.target.value)}
            placeholder="e.g. plus"
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand disabled:bg-cream disabled:text-muted"
          />
        </Field>
        <Field label="Display name">
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
        <Field label="Max children">
          <input
            type="number"
            min={0}
            value={draft.maxChildren}
            onChange={(e) => set('maxChildren', Number(e.target.value))}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
        <Field label="Max adults">
          <input
            type="number"
            min={1}
            value={draft.maxParents}
            onChange={(e) => set('maxParents', Number(e.target.value))}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
        <Field label="Price / month">
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.priceMonthly}
            onChange={(e) => set('priceMonthly', Number(e.target.value))}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
        <Field label="Price / year">
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.priceAnnual}
            onChange={(e) => set('priceAnnual', Number(e.target.value))}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
        <Field label="Currency">
          <input
            value={draft.currency}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
            maxLength={3}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] uppercase outline-none focus:border-brand"
          />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            value={draft.sort}
            onChange={(e) => set('sort', Number(e.target.value))}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Description">
          <textarea
            value={draft.blurb}
            onChange={(e) => set('blurb', e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-bold text-body">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => set('active', e.target.checked)}
        />
        Active — offered to new customers
      </label>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy || !draft.id}
          onClick={onSave}
          className="rounded-xl bg-brand px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save plan'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold text-body"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold tracking-[0.04em] text-body">
        {label}
      </span>
      {children}
    </label>
  )
}
