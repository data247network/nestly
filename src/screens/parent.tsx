import { useEffect, useState } from 'react'
import { Geolocation } from '@capacitor/geolocation'
import { describeSchedule, fmtDuration, useStore } from '../app/store'
import { useDevice } from '../platform/device'
import { useCloudChildren } from '../app/CloudWatch'
import type { CloudChild } from '../cloud/sync'
import { Scene } from '../art/Scene'
import { LinkBadge, ago } from './setup'
import { RecentActivity, Segments } from './activity'
import { Reminders } from './reminders'
import type { Tone } from '../app/types'
import type { Fix } from '../link/protocol'
import { describePlace, type Place } from '../platform/places'
import {
  Avatar,
  BackButton,
  Chip,
  Display,
  Field,
  FieldLabel,
  GhostButton,
  MapCanvas,
  Meter,
  Pill,
  PrimaryButton,
  Row,
  ScreenTitle,
  SectionTitle,
  TONE,
  Toggle,
  ToggleRow,
} from '../ui/kit'

/* -------------------------------------------------------------------- home */

export function Home() {
  const { state, go, dispatch } = useStore()
  const { pairing, child: live } = useDevice()
  // Remote view. Bluetooth stays authoritative when the phones are together —
  // it is fresher and needs no signal — so this only fills the gap when they
  // are apart, which is exactly when a parent most wants to look.
  const { household: remote, updatedAt: remoteAt } = useCloudChildren()
  const recent = state.alerts.slice(0, 2)
  const noContacts = state.emergencyContacts.every((c) => !c.phone.trim())

  // Nothing to show until a child device exists. Sending the parent straight
  // to pairing beats a dashboard of zeroes — unless a child has already been
  // enrolled from the web, in which case they are set up and simply not in
  // Bluetooth range, and telling them to go and pair would be wrong.
  const enrolledRemotely = (remote?.children ?? []).some((c) => c.enrolledAt)

  if (!pairing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-[26px] text-center">
        <Scene name="safe" className="w-[168px]" />
        {enrolledRemotely ? (
          <>
            <Display className="text-[21px] leading-tight">
              {remote?.children.find((c) => c.enrolledAt)?.name ?? 'Your child'} is set up
            </Display>
            <p className="text-[13px] leading-relaxed text-body">
              Their phone is linked to your account and reporting over the
              internet{remoteAt ? `, last seen ${ago(remoteAt)}` : ''}. Pair over
              Bluetooth as well and it keeps working with no signal at all.
            </p>
            <PrimaryButton onClick={() => go('pair')}>Also pair over Bluetooth</PrimaryButton>
          </>
        ) : (
          <>
            <Display className="text-[21px] leading-tight">Connect your child's phone</Display>
            <p className="text-[13px] leading-relaxed text-body">
              Install Nestly on their phone, choose "This is my child's phone", then
              pair the two over Bluetooth. It takes about a minute.
            </p>
            <PrimaryButton onClick={() => go('pair')}>Pair a device</PrimaryButton>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-5 px-[22px] pb-5 pt-[26px]">
      <div>
        <div className="mb-0.5 text-[13px] text-body">{greeting()}</div>
        <Display className="text-[22px]">Your family</Display>
        <div className="mt-2">
          <LinkBadge />
        </div>
      </div>

      <div className="no-scrollbar -mx-[22px] flex gap-3 overflow-x-auto px-[22px]">
        {state.children.length === 0 ? (
          <div className="w-full rounded-[18px] bg-cream px-4 py-5 text-center text-[12.5px] text-body">
            Paired with <b>{pairing.peerName}</b>. Waiting for it to check in —
            this happens when both phones are close together.
          </div>
        ) : null}
        {state.children.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              dispatch({ type: 'activeChild', id: c.id })
              go('screentime')
            }}
            className={`w-[148px] shrink-0 rounded-[18px] bg-cream p-3.5 text-left transition ${
              state.activeChildId === c.id ? 'ring-[1.5px] ring-brand' : ''
            }`}
          >
            <div className="mb-2.5">
              <Avatar name={c.name} color={c.avatar} />
            </div>
            <div className="mb-1 text-sm font-bold">{c.name}</div>
            <div className="mb-2.5">
              <Chip tone={c.statusTone}>{c.status}</Chip>
            </div>
            <div className="text-[11.5px] text-body">
              Battery {c.battery}%
              {live?.telemetry?.charging ? ' · charging' : ''}
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-2.5">
        <QuickAction
          label={state.lockNow ? 'Unlock' : 'Lock now'}
          tone="ink"
          onClick={() => dispatch({ type: 'setLockNow', value: !state.lockNow })}
        />
        <QuickAction label="Locate" onClick={() => go('map')} />
        <QuickAction label="Device" onClick={() => go('pair')} />
      </div>

      {state.lockNow ? (
        <div className="-mt-2 rounded-xl bg-violetBg px-3 py-2 text-[11.5px] text-[#5B4EA8]">
          You've paused their phone. It stays locked until you unlock it here.
        </div>
      ) : null}

      {noContacts ? (
        <button
          type="button"
          onClick={() => go('contacts')}
          className="-mt-2 w-full rounded-xl bg-coralBg px-3 py-2.5 text-left text-[11.5px] leading-snug text-coralInk"
        >
          <b>No emergency numbers set.</b> While their phone is locked they have
          no way to call you. Tap to add one.
        </button>
      ) : null}

      <div>
        <SectionTitle
          action={
            <button
              type="button"
              onClick={() => go('alerts')}
              className="text-xs font-bold text-brand"
            >
              See all
            </button>
          }
        >
          Recent alerts
        </SectionTitle>
        <div className="flex flex-col gap-2">
          {recent.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => go(a.urgent ? 'acoustic' : 'alerts')}
              className={`flex items-center gap-2.5 rounded-xl ${TONE[a.tone].bg} px-3 py-2.5 text-left`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[a.tone].dot}`} />
              <span className="text-[12.5px]">
                {a.who} · {a.title} · {a.time}
              </span>
            </button>
          ))}
          {recent.length === 0 ? (
            <div className="rounded-xl bg-cream px-3 py-4 text-center text-[12.5px] text-body">
              All quiet. Nothing needs you right now.
            </div>
          ) : null}
        </div>
      </div>

      <RecentActivity onSeeAll={() => go('trail')} />
    </div>
  )
}

function QuickAction({
  label,
  tone,
  onClick,
}: {
  label: string
  tone?: 'ink'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-[14px] px-1 py-3 text-xs font-bold transition active:scale-95 ${
        tone === 'ink' ? 'bg-ink text-white' : 'bg-cream text-ink'
      }`}
    >
      {label}
    </button>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/* --------------------------------------------------------------- map/zones */

/**
 * The newer of two positions, either of which may be absent.
 *
 * Transport-agnostic on purpose: a fix is a fix, and the only thing that makes
 * one better than another is being more recent.
 */
function fresher(a: Fix | null, b: Fix | null): Fix | null {
  if (!a) return b
  if (!b) return a
  return b.ts > a.ts ? b : a
}

/**
 * The cloud record for the phone currently being viewed.
 *
 * Falls back to the only enrolled child when the Bluetooth pairing has not been
 * bound to a cloud id yet — a household with one child is the common case, and
 * showing their position beats showing none over a bookkeeping gap. With
 * several children it returns nothing rather than guess, because the wrong
 * child's location on a map is worse than an empty one.
 */
function matchingCloudChild(
  children: CloudChild[] | undefined,
  cloudChildId: string | null | undefined,
): CloudChild | null {
  const list = children ?? []
  if (cloudChildId) return list.find((c) => c.id === cloudChildId) ?? null
  const enrolled = list.filter((c) => c.enrolledAt)
  return enrolled.length === 1 ? enrolled[0] : null
}

export function MapZones() {
  const { state, go, dispatch, activeChild } = useStore()
  const { child } = useDevice()
  const { household: remote } = useCloudChildren()
  const fences = state.geofences
  const who = activeChild?.name ?? 'your child'

  // Whichever position is actually newer, not whichever arrived by the
  // preferred road.
  //
  // This screen used to read the Bluetooth link and nothing else, which meant
  // the one time a parent most needs the map — child out of range — was the one
  // time it said "No position yet", while the server had a fix from a minute
  // ago. The child device uploads on its own; nothing was reading it back.
  //
  // A fixed order of preference would be wrong in one direction or the other.
  // Bluetooth reports every 15s and the cloud every 60s, so preferring the
  // internet outright would show a staler position whenever the phones are
  // together. Comparing timestamps gets both cases right and needs no rule
  // about which transport is "primary".
  const cloudFix = matchingCloudChild(remote?.children, child?.cloudChildId)?.fix ?? null
  const fix = fresher(child?.telemetry?.fix ?? null, cloudFix)

  return (
    <div className="flex h-full flex-col">
      <MapCanvas
        height={260}
        zones={fences.slice(0, 3).map((_f, i) => ({
          top: 30 + i * 70,
          left: 40 + i * 60,
          size: 120,
          color: i === 0 ? '#147D77' : i === 1 ? '#8B7FD1' : '#FFB84D',
        }))}
        pins={fix ? [{ top: 95, left: 95 }] : []}
      />

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-[18px]">
        <div className="rounded-xl bg-cream px-3.5 py-2.5 text-[12px] leading-snug text-body">
          {fix ? (
            <PositionLine fix={fix} />
          ) : (
            <>
              No position yet. {who}'s phone sends its location when the two
              phones are next near each other.
            </>
          )}
        </div>

        <div className="mb-0.5 text-[15px] font-bold">Zones</div>
        {fences.map((f) => (
          <div key={f.id} className="rounded-2xl bg-cream p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold">{f.name}</div>
                <div className="text-[11.5px] text-body">
                  {Math.round(f.radiusM)}m · {describeFence(f.notifyArrive, f.notifyLeave)}
                </div>
                <div className="mt-0.5 text-[11.5px] text-brand">{whoFor(f, state.children)}</div>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'removeFence', id: f.id })}
                className="shrink-0 text-[11.5px] font-bold text-coralInk"
              >
                Remove
              </button>
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <ChildPicker
                selected={f.childIds}
                onToggle={(childId) =>
                  dispatch({ type: 'toggleFenceChild', id: f.id, childId })
                }
              />
            </div>
          </div>
        ))}
        {fences.length === 0 ? (
          <div className="rounded-2xl bg-cream px-4 py-5 text-center text-[12.5px] text-body">
            No zones yet. Add one at a place that matters — home, school, a
            grandparent's — and you'll be told when they arrive or leave.
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => go('geofence')}
          className="mt-1 rounded-[14px] border-[1.5px] border-dashed border-brand py-3 text-center text-[13px] font-bold text-brand"
        >
          + Add geofence
        </button>
      </div>
    </div>
  )
}

function describeFence(arrive: boolean, leave: boolean) {
  if (arrive && leave) return 'Notify on arrival & leave'
  if (arrive) return 'Notify on arrival'
  if (leave) return 'Notify on leave'
  return 'Notifications off'
}

/** "Everyone" / "Eliora" / "Eliora and Sam" — who a zone actually covers. */
function whoFor(f: { childIds: string[] }, children: { id: string; name: string }[]): string {
  if (f.childIds.length === 0) return 'Everyone'
  const names = f.childIds
    .map((id) => children.find((c) => c.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  if (names.length === 0) return 'Everyone'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Picks which children a zone covers.
 *
 * "Everyone" is a real option and the default, because most household zones —
 * home, school, grandma's — apply to every child. Selecting nobody would be a
 * zone that does nothing, so an empty selection *means* everyone rather than
 * being an error state to nag about.
 */
function ChildPicker({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (childId: string) => void
}) {
  const { state } = useStore()

  if (state.children.length === 0) {
    return (
      <div className="rounded-xl bg-cream px-3.5 py-3 text-[12px] text-body">
        No child devices paired yet. This zone will apply to any you add.
      </div>
    )
  }

  const everyone = selected.length === 0
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => selected.forEach(onToggle)}
        className={`rounded-2xl px-3.5 py-2 text-[12.5px] font-bold transition ${
          everyone ? 'bg-brand text-white' : 'bg-cream text-body'
        }`}
      >
        Everyone
      </button>
      {state.children.map((c) => {
        const on = selected.includes(c.id)
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-[12.5px] font-bold transition ${
              on ? 'bg-brand text-white' : 'bg-cream text-body'
            }`}
          >
            <span
              className="h-4 w-4 shrink-0 rounded-full"
              style={{ background: on ? '#FFFFFF55' : c.avatar }}
            />
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

export function NewGeofence() {
  const { state, go, dispatch } = useStore()
  const { child } = useDevice()
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const d = state.draftFence
  // 50 m … 500 m mapped onto the slider track.
  const pct = ((d.radiusM - 50) / 450) * 100

  /** A zone needs a real centre, so it is anchored to a coordinate you choose. */
  const useMyLocation = async () => {
    setLocating(true)
    setLocError(null)
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true })
      dispatch({
        type: 'draftFence',
        patch: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      })
    } catch (e) {
      setLocError(
        e instanceof Error && /denied|permission/i.test(e.message)
          ? 'Location permission is needed to place a zone here.'
          : 'Could not get a location fix. Try again outdoors.',
      )
    } finally {
      setLocating(false)
    }
  }

  const useChildLocation = () => {
    const fix = child?.telemetry?.fix
    if (!fix) return
    dispatch({ type: 'draftFence', patch: { lat: fix.lat, lng: fix.lng } })
  }

  const placed = d.lat != null && d.lng != null

  return (
    <div className="flex h-full flex-col">
      <MapCanvas
        height={180}
        zones={[
          {
            top: 90 - (60 + pct * 0.5) / 2,
            left: 175 - (60 + pct * 0.5) / 2,
            size: 60 + pct * 0.5,
            color: placed ? '#147D77' : '#9AA2A9',
          },
        ]}
      />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] py-5">
        <BackButton onClick={() => go('map')} />

        <div>
          <FieldLabel>ZONE NAME</FieldLabel>
          <Field
            value={d.name}
            placeholder="e.g. Grandma's house"
            onChange={(name) => dispatch({ type: 'draftFence', patch: { name } })}
          />
        </div>

        <div>
          <FieldLabel>WHERE IS IT?</FieldLabel>
          <div className="flex gap-2">
            <GhostButton onClick={() => void useMyLocation()}>
              {locating ? 'Locating…' : 'Use my location'}
            </GhostButton>
            {child?.telemetry?.fix ? (
              <GhostButton onClick={useChildLocation}>Use their last spot</GhostButton>
            ) : null}
          </div>
          <div className="mt-2 text-[11.5px] text-body">
            {placed
              ? `Centred on ${d.lat!.toFixed(5)}, ${d.lng!.toFixed(5)}`
              : 'Stand at the place, or use their last known position.'}
          </div>
          {locError ? (
            <div className="mt-2 rounded-xl bg-coralBg px-3 py-2 text-[12px] text-coralInk">
              {locError}
            </div>
          ) : null}
        </div>

        <div>
          <FieldLabel>RADIUS · {d.radiusM}m</FieldLabel>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={d.radiusM}
            onChange={(e) =>
              dispatch({ type: 'draftFence', patch: { radiusM: Number(e.target.value) } })
            }
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand"
            style={{
              background: `linear-gradient(to right, #147D77 ${pct}%, #E7E1D6 ${pct}%)`,
            }}
          />
        </div>

        <div>
          <FieldLabel>WHO IS THIS ZONE FOR?</FieldLabel>
          <ChildPicker
            selected={d.childIds}
            onToggle={(childId) => dispatch({ type: 'toggleDraftFenceChild', childId })}
          />
        </div>

        <ToggleRow
          label="Notify on arrival"
          on={d.notifyArrive}
          onChange={(v) => dispatch({ type: 'draftFence', patch: { notifyArrive: v } })}
        />
        <ToggleRow
          label="Notify on leave"
          on={d.notifyLeave}
          onChange={(v) => dispatch({ type: 'draftFence', patch: { notifyLeave: v } })}
        />

        <div className="flex-1" />
        <PrimaryButton
          className={placed ? '' : 'pointer-events-none opacity-40'}
          onClick={() => {
            dispatch({ type: 'saveFence' })
            go('map')
          }}
        >
          {placed ? 'Save geofence' : 'Set a location first'}
        </PrimaryButton>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- screentime */

export function ScreenTime() {
  const { state, go, dispatch, activeChild } = useStore()
  const { child } = useDevice()
  const activeId = child?.telemetry?.activeScenarioId ?? null
  const contactCount = state.emergencyContacts.filter((c) => c.phone.trim()).length

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>{activeChild ? `${activeChild.name}'s routines` : 'Routines'}</ScreenTitle>

      <div className="rounded-[18px] bg-cream p-4">
        <div className="text-[12px] font-bold text-body">RIGHT NOW</div>
        <div className="mt-1 text-[15px] font-bold">
          {activeId
            ? (state.scenarios.find((s) => s.id === activeId)?.name ?? 'A routine is running')
            : child?.telemetry?.locked
              ? 'Paused by you'
              : 'Nothing running'}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-body">
          Routines are enforced on their phone, so they keep working with no
          signal and no internet.
        </div>
      </div>

      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'addScenario' })
              go('scenario')
            }}
            className="text-xs font-bold text-brand"
          >
            + New routine
          </button>
        }
      >
        Routines
      </SectionTitle>

      <div className="-mt-2 flex flex-col gap-2.5">
        {state.scenarios.map((s) => (
          <div
            key={s.id}
            className={`flex items-center justify-between gap-3 rounded-[14px] p-3.5 ${
              s.id === activeId ? 'bg-tint ring-[1.5px] ring-brand' : 'bg-cream'
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                dispatch({ type: 'editScenario', id: s.id })
                go('scenario')
              }}
            >
              <div className="text-[13.5px] font-bold">{s.name}</div>
              <div className="text-[11.5px] text-body">{describeSchedule(s)}</div>
            </button>
            <Toggle
              on={s.enabled}
              label={s.name}
              onChange={() => dispatch({ type: 'toggleScenario', id: s.id })}
            />
          </div>
        ))}

        {state.scenarios.length === 0 ? (
          <div className="rounded-2xl bg-cream px-4 py-5 text-center text-[12.5px] text-body">
            No routines yet. Add one for school hours, homework or bedtime.
          </div>
        ) : null}
      </div>

      <Reminders />

      <div className="mt-1 text-[14.5px] font-bold">Safety</div>
      <Row
        title="Web &amp; app filtering"
        hint="Block sites, and see what they used"
        onClick={() => go('activity')}
      />
      <Row
        title="Emergency contacts"
        hint={
          contactCount > 0
            ? `${contactCount} number${contactCount === 1 ? '' : 's'} they can always call`
            : 'None set — they cannot call anyone while locked'
        }
        onClick={() => go('contacts')}
      />
      {contactCount === 0 ? (
        <div className="-mt-1 rounded-xl bg-coralBg px-3.5 py-2.5 text-[11.5px] leading-snug text-coralInk">
          Add at least one number before you lock their phone.
        </div>
      ) : null}
    </div>
  )
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** minutes-from-midnight <-> the "HH:MM" an <input type="time"> speaks. */
const toTimeValue = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

const fromTimeValue = (v: string) => {
  const [h, m] = v.split(':').map((n) => parseInt(n, 10))
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return (h % 24) * 60 + (m % 60)
}

export function ScenarioEditor() {
  const { go, dispatch, editingScenario: s } = useStore()
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!s) {
    return (
      <div className="flex h-full flex-col gap-4 px-[22px] py-[26px]">
        <BackButton onClick={() => go('screentime')} />
        <div className="text-[13px] text-body">This routine no longer exists.</div>
      </div>
    )
  }

  const overnight = s.toMin <= s.fromMin

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <BackButton onClick={() => go('screentime')} />

      <div>
        <FieldLabel>NAME</FieldLabel>
        <Field
          value={s.name}
          placeholder="e.g. Homework"
          onChange={(name) => dispatch({ type: 'patchScenario', id: s.id, patch: { name } })}
        />
      </div>

      <div>
        <FieldLabel>DAYS</FieldLabel>
        <div className="flex gap-1.5">
          {DAY_LETTERS.map((d, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={s.days.includes(i)}
              onClick={() => dispatch({ type: 'toggleScenarioDay', id: s.id, day: i })}
              className={`flex h-9 flex-1 items-center justify-center rounded-[9px] text-[11px] font-bold transition ${
                s.days.includes(i) ? 'bg-brand text-white' : 'bg-cream text-muted'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>WHEN</FieldLabel>
        <div className="flex items-center gap-2">
          <TimeInput
            value={s.fromMin}
            onChange={(fromMin) => dispatch({ type: 'patchScenario', id: s.id, patch: { fromMin } })}
          />
          <span className="text-[13px] text-body">to</span>
          <TimeInput
            value={s.toMin}
            onChange={(toMin) => dispatch({ type: 'patchScenario', id: s.id, patch: { toMin } })}
          />
        </div>
        {overnight ? (
          <div className="mt-2 rounded-xl bg-violetBg px-3 py-2 text-[11.5px] text-[#5B4EA8]">
            Ends the next morning — this routine runs overnight.
          </div>
        ) : null}
      </div>

      <div className="mt-1 text-[13.5px] font-bold">Blocked during this routine</div>
      <ToggleRow
        label="Games"
        on={s.blocks.games}
        onChange={(v) => dispatch({ type: 'setScenarioBlock', id: s.id, key: 'games', value: v })}
      />
      <ToggleRow
        label="Social media"
        on={s.blocks.social}
        onChange={(v) => dispatch({ type: 'setScenarioBlock', id: s.id, key: 'social', value: v })}
      />
      <ToggleRow
        label={
          <>
            Messaging <span className="font-normal text-muted">(emergency contacts allowed)</span>
          </>
        }
        on={s.blocks.messaging}
        onChange={(v) =>
          dispatch({ type: 'setScenarioBlock', id: s.id, key: 'messaging', value: v })
        }
      />

      <div className="mt-1 flex items-center gap-2 rounded-xl bg-tint px-3 py-2.5 text-[11.5px] font-semibold text-brand">
        Runs on their phone — works with no signal
      </div>

      <div className="flex-1" />

      {confirmDelete ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-body">
            Delete "{s.name}"? Their phone stops enforcing it as soon as the two
            phones are next near each other.
          </p>
          <PrimaryButton
            tone="coral"
            onClick={() => {
              dispatch({ type: 'deleteScenario', id: s.id })
              go('screentime')
            }}
          >
            Delete routine
          </PrimaryButton>
          <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <PrimaryButton onClick={() => go('screentime')}>Done</PrimaryButton>
          <GhostButton onClick={() => setConfirmDelete(true)}>Delete routine</GhostButton>
        </div>
      )}
    </div>
  )
}

function TimeInput({ value, onChange }: { value: number; onChange: (min: number) => void }) {
  return (
    <input
      type="time"
      value={toTimeValue(value)}
      onChange={(e) => {
        const min = fromTimeValue(e.target.value)
        if (min !== null) onChange(min)
      }}
      className="flex-1 rounded-[14px] border-[1.5px] border-line bg-white px-3 py-3 text-center text-[15px] font-bold outline-none focus:border-brand"
    />
  )
}

/* ---------------------------------------------------------------- activity */

export function Activity() {
  const { state, dispatch } = useStore()
  const max = Math.max(...state.usage.map((u) => u.minutes), 1)
  const toneColor: Record<Tone, string> = {
    teal: '#5FD3C4',
    amber: '#FFB84D',
    coral: '#FF6B5B',
    violet: '#8B7FD1',
  }

  return (
    <div className="flex h-full flex-col gap-[18px] overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>Activity &amp; filtering</ScreenTitle>

      <div>
        <div className="mb-2.5 text-[13.5px] font-bold">App usage today</div>
        {state.usage.length === 0 ? (
          <div className="rounded-xl bg-amberBg px-3.5 py-3 text-[12px] leading-snug text-[#8A5A16]">
            Per-app usage isn't collected yet. It needs Android's usage-access
            permission on your child's phone, which is on the roadmap alongside
            device-owner enrolment.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {state.usage.map((u) => (
              <div key={u.app}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{u.app}</span>
                  <span className="text-body">{fmtDuration(u.minutes)}</span>
                </div>
                <Meter pct={(u.minutes / max) * 100} color={toneColor[u.tone]} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2.5 text-[13.5px] font-bold">Web filtering</div>
        <div className="flex flex-col gap-2">
          <ToggleRow
            boxed
            label="Adult content"
            on={state.filters.adult}
            onChange={(v) => dispatch({ type: 'setFilter', key: 'adult', value: v })}
          />
          <ToggleRow
            boxed
            label="Violence"
            on={state.filters.violence}
            onChange={(v) => dispatch({ type: 'setFilter', key: 'violence', value: v })}
          />
          <ToggleRow
            boxed
            label="Gambling"
            on={state.filters.gambling}
            onChange={(v) => dispatch({ type: 'setFilter', key: 'gambling', value: v })}
          />
          <div className="flex items-center justify-between rounded-xl bg-cream px-3.5 py-2.5">
            <span className="text-[12.5px]">Custom blocklist</span>
            <span className="text-[11.5px] font-bold text-brand">
              {state.filters.custom.length} sites
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2.5 text-[13.5px] font-bold">Recent blocked attempts</div>
        {state.blockedAttempts.length === 0 ? (
          <div className="text-xs text-body">
            Nothing blocked yet. Filtering is enforced on their phone and
            reported here when the two phones next sync.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {state.blockedAttempts.map((b) => (
              <div key={b.site} className="text-xs text-body">
                {b.site} · {b.when}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ alerts */

const ALERT_FILTERS = ['All', 'Location', 'Content', 'Sound'] as const

export function Alerts() {
  const { state, go } = useStore()
  const [filter, setFilter] = useState<(typeof ALERT_FILTERS)[number]>('All')

  const shown = state.alerts.filter((a) => {
    if (filter === 'All') return true
    if (filter === 'Location') return a.kind === 'location'
    if (filter === 'Sound') return a.kind === 'sound'
    return a.kind === 'content' || a.kind === 'contact'
  })

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>Alerts</ScreenTitle>
      <Segments current="alerts" />

      <div className="no-scrollbar -mx-[22px] flex gap-2 overflow-x-auto px-[22px]">
        {ALERT_FILTERS.map((f) => (
          <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f}
          </Pill>
        ))}
      </div>

      {shown.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => a.urgent && go('acoustic')}
          className={`flex gap-3 rounded-[14px] px-3.5 py-3 text-left ${
            a.urgent ? 'bg-coralBg' : 'bg-cream'
          }`}
        >
          <span
            className={`h-[34px] w-[34px] shrink-0 rounded-[10px] ${TONE[a.tone].dot}`}
            aria-hidden
          />
          <span>
            <span className="block text-[13px] font-bold">{a.title}</span>
            <span className="block text-[11.5px] text-body">
              {a.who} · {a.time}
            </span>
          </span>
        </button>
      ))}

      {shown.length === 0 ? (
        <div className="rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] text-body">
          Nothing in this category.
        </div>
      ) : null}
    </div>
  )
}

export function AcousticAlert() {
  const { go, dispatch, state } = useStore()
  const alert = state.alerts.find((a) => a.urgent)

  return (
    <div className="flex h-full flex-col">
      <div className="bg-coral px-[22px] pb-5 pt-[26px] text-white">
        <button
          type="button"
          onClick={() => go('alerts')}
          className="mb-3.5 w-8 text-left text-xl"
          aria-label="Back"
        >
          ←
        </button>
        <div className="text-xs font-bold tracking-[0.05em] opacity-90">ACOUSTIC SAFETY ALERT</div>
        <Display className="mt-1 text-[21px]">Possible distress sound</Display>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
        <div className="flex gap-2">
          <span className="rounded-[14px] bg-coralBg px-3 py-1.5 text-xs font-bold text-coralInk">
            Scream · 92%
          </span>
          <span className="rounded-[14px] bg-cream px-3 py-1.5 text-xs font-bold text-body">
            Panic · 61%
          </span>
        </div>

        <p className="text-[13px] text-body">
          Detected on Leo's phone at 10:05 AM near{' '}
          <b className="text-ink">Maple Street Park</b>.
        </p>

        <MapCanvas
          height={130}
          className="rounded-2xl"
          pins={[{ top: 50, left: 130, color: '#FF6B5B' }]}
        />

        <div className="flex-1" />
        <PrimaryButton tone="coral" onClick={() => go('hub')}>
          Call Leo now
        </PrimaryButton>
        <GhostButton
          onClick={() => {
            if (alert) dispatch({ type: 'dismissAlert', id: alert.id })
            go('alerts')
          }}
        >
          Mark as false alarm
        </GhostButton>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- hub */

/* -------------------------------------------------------------------- tips */

const TIPS = [
  {
    cat: 'Online Safety',
    band: 'bg-tint',
    title: 'Talking to kids about strangers online',
    body: 'A calm script for the "who\'s this friend?" conversation · 3 min',
  },
  {
    cat: 'Screen Habits',
    band: 'bg-amberBg',
    title: 'Signs of doom-scrolling in tweens',
    body: 'What healthy evening screen habits look like · 4 min',
  },
  {
    cat: 'Wellness',
    band: 'bg-violetBg',
    title: 'Rebuilding trust after a broken rule',
    body: 'Repair beats punishment — how to run that talk · 5 min',
  },
]

export function SafetyTips() {
  const [cat, setCat] = useState('Online Safety')
  const cats = ['Online Safety', 'Wellness', 'Screen Habits']
  const shown = TIPS.filter((t) => t.cat === cat)

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>This week's tips</ScreenTitle>

      <div className="no-scrollbar -mx-[22px] flex gap-2 overflow-x-auto px-[22px]">
        {cats.map((c) => (
          <Pill key={c} active={cat === c} onClick={() => setCat(c)}>
            {c}
          </Pill>
        ))}
      </div>

      {shown.map((t) => (
        <article key={t.title} className="overflow-hidden rounded-2xl border border-line">
          <div className={`h-20 ${t.band}`} />
          <div className="p-3.5">
            <h3 className="mb-1 text-sm font-bold">{t.title}</h3>
            <p className="text-xs text-body">{t.body}</p>
          </div>
        </article>
      ))}
    </div>
  )
}

/**
 * Where the child is, in words.
 *
 * Coordinates alone are precise and unreadable — a parent asking "where is
 * she?" cannot answer it from 5.56598, 5.80290. The nearby landmark and street
 * are resolved when this renders and cached, so a phone sitting still does not
 * re-look-up the same corner every minute.
 *
 * The coordinates stay on screen regardless. If the lookup fails, is rate
 * limited, or the phone is offline, nothing is lost — the precise answer is
 * still there, and that is the part that matters in an emergency.
 */
function PositionLine({ fix }: { fix: Fix }) {
  const [place, setPlace] = useState<Place | null>(null)
  const [looking, setLooking] = useState(true)

  useEffect(() => {
    let live = true
    setLooking(true)
    void describePlace(fix.lat, fix.lng)
      .then((p) => live && setPlace(p))
      .finally(() => {
        if (live) setLooking(false)
      })
    return () => {
      live = false
    }
  }, [fix.lat, fix.lng])

  return (
    <>
      {place ? (
        <>
          <b className="text-ink">Near {place.label}</b>
          {place.detail ? <> · {place.detail}</> : null}
          <br />
        </>
      ) : looking ? (
        <>
          Looking up the area…
          <br />
        </>
      ) : null}
      Last known position {ago(fix.ts)} — {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} (±
      {Math.round(fix.acc)}m).
    </>
  )
}
