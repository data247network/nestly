import type { ReactNode } from 'react'
import type { Tone } from '../app/types'

/** Tone → the tint/ink pair used by pills, alert cards and status chips. */
export const TONE: Record<Tone, { bg: string; ink: string; dot: string }> = {
  teal: { bg: 'bg-tint', ink: 'text-brand', dot: 'bg-brand' },
  amber: { bg: 'bg-amberBg', ink: 'text-[#8A5A16]', dot: 'bg-amber' },
  coral: { bg: 'bg-coralBg', ink: 'text-coralInk', dot: 'bg-coral' },
  violet: { bg: 'bg-violetBg', ink: 'text-[#5B4EA8]', dot: 'bg-violet' },
}

export function Display({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`font-display font-bold ${className}`} style={style}>
      {children}
    </div>
  )
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return <Display className="text-[20px] leading-tight">{children}</Display>
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="text-sm font-bold">{children}</div>
      {action}
    </div>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-xs font-bold text-body">{children}</div>
}

/** A read-only field that looks like the design's bordered inputs. */
export function Field({
  value,
  onChange,
  placeholder,
  muted = false,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  muted?: boolean
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      readOnly={!onChange}
      onChange={(e) => onChange?.(e.target.value)}
      className={`w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-brand ${
        muted ? 'text-body' : 'text-ink'
      }`}
    />
  )
}

export function PrimaryButton({
  children,
  onClick,
  tone = 'brand',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  tone?: 'brand' | 'coral' | 'ink'
  className?: string
}) {
  const bg = tone === 'coral' ? 'bg-coral' : tone === 'ink' ? 'bg-ink' : 'bg-brand'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl ${bg} px-4 py-[15px] text-center text-[14.5px] font-bold text-white transition active:scale-[0.985] ${className}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border-[1.5px] border-line px-4 py-[14px] text-center text-[13.5px] font-bold text-body transition active:scale-[0.985] ${className}`}
    >
      {children}
    </button>
  )
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="-ml-1 w-8 text-left text-xl leading-none text-ink"
    >
      ←
    </button>
  )
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange?: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${
        on ? 'bg-brand' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all ${
          on ? 'left-[20px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

/** A labelled toggle on its own row — the most repeated pattern in the app. */
export function ToggleRow({
  label,
  hint,
  on,
  onChange,
  boxed = false,
}: {
  label: ReactNode
  hint?: string
  on: boolean
  onChange?: (v: boolean) => void
  boxed?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        boxed ? 'rounded-xl bg-cream px-3.5 py-2.5' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{label}</div>
        {hint ? <div className="text-[11.5px] text-body">{hint}</div> : null}
      </div>
      <Toggle on={on} onChange={onChange} label={typeof label === 'string' ? label : undefined} />
    </div>
  )
}

export function Pill({
  children,
  active = false,
  tone,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  tone?: Tone
  onClick?: () => void
}) {
  const base = 'shrink-0 rounded-2xl px-3.5 py-2 text-xs font-bold transition'
  if (tone) {
    const t = TONE[tone]
    return <span className={`${base} ${t.bg} ${t.ink}`}>{children}</span>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? 'bg-ink text-white' : 'bg-cream text-body'}`}
    >
      {children}
    </button>
  )
}

export function Chip({ children, tone = 'teal' }: { children: ReactNode; tone?: Tone }) {
  const t = TONE[tone]
  return (
    <span className={`inline-block rounded-lg ${t.bg} ${t.ink} px-2 py-[3px] text-[10.5px] font-bold`}>
      {children}
    </span>
  )
}

/** Tappable list row with a chevron. */
export function Row({
  title,
  hint,
  right,
  onClick,
}: {
  title: ReactNode
  hint?: ReactNode
  right?: ReactNode
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className="flex w-full items-center justify-between gap-3 rounded-2xl bg-cream px-3.5 py-3 text-left"
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold">{title}</div>
        {hint ? <div className="text-[11.5px] text-body">{hint}</div> : null}
      </div>
      {right ?? <span className="text-base text-muted">›</span>}
    </Tag>
  )
}

export function Avatar({
  name,
  color,
  size = 38,
}: {
  name: string
  color: string
  size?: number
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.37 }}
    >
      {name.charAt(0)}
    </div>
  )
}

/** Horizontal progress/meter bar. */
export function Meter({
  pct,
  color,
  height = 7,
}: {
  pct: number
  color: string
  height?: number
}) {
  return (
    <div className="w-full rounded overflow-hidden bg-cream" style={{ height }}>
      <div
        className="h-full rounded transition-all"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  )
}

/**
 * The stylised map canvas. Every map in the product is this same graph-paper
 * wash with geofence discs and a pin drawn on top — it stands in for the real
 * tile layer, which is a drop-in replacement (see README).
 */
export function MapCanvas({
  height,
  zones = [],
  pins = [],
  className = '',
}: {
  height: number | string
  zones?: { top: number; left: number; size: number; color: string }[]
  pins?: { top: number; left: number; color?: string }[]
  className?: string
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-mapBg ${className}`}
      style={{ height }}
      aria-hidden
    >
      <div className="map-grid absolute inset-0" style={{ backgroundSize: '26px 26px' }} />
      {zones.map((z, i) => (
        <div
          key={i}
          className="absolute rounded-full border-2 border-dashed"
          style={{
            top: z.top,
            left: z.left,
            width: z.size,
            height: z.size,
            borderColor: z.color,
            background: `${z.color}1A`,
          }}
        />
      ))}
      {pins.map((p, i) => (
        <div
          key={i}
          className="absolute h-4 w-4 rounded-full border-[3px] border-white shadow-pin"
          style={{ top: p.top, left: p.left, background: p.color ?? '#147D77' }}
        />
      ))}
    </div>
  )
}

/** Donut chart for the screen-time breakdown. */
export function Donut({
  segments,
  center,
  size = 76,
}: {
  segments: { value: number; color: string }[]
  center: ReactNode
  size?: number
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  let at = 0
  const stops = segments
    .map((s) => {
      const from = at / total
      at += s.value
      return `${s.color} ${from}turn ${at / total}turn`
    })
    .join(', ')
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(${stops})` }}
    >
      <div
        className="flex items-center justify-center rounded-full bg-cream text-[11px] font-bold"
        style={{ width: size - 20, height: size - 20 }}
      >
        {center}
      </div>
    </div>
  )
}

export function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px]">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {children}
    </div>
  )
}

/** Five-bar sparkline used on the web dashboard child cards. */
export function Bars({ values, color, accent }: { values: number[]; color: string; accent: string }) {
  const max = Math.max(...values, 1)
  const peak = values.indexOf(max)
  return (
    <div className="flex h-[38px] items-end gap-[3px]">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, background: i === peak ? accent : color }}
        />
      ))}
    </div>
  )
}

export function Dots({ index, count = 3 }: { index: number; count?: number }) {
  return (
    <div className="mb-[22px] flex justify-center gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === index ? 'w-[22px] bg-brand' : 'w-1.5 bg-line'
          }`}
        />
      ))}
    </div>
  )
}

/** The Nestly mark — concentric rounded square + dot. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center bg-brand"
      style={{ width: size, height: size, borderRadius: size * 0.32 }}
    >
      <div
        className="rounded-full bg-mint"
        style={{ width: size * 0.38, height: size * 0.38 }}
      />
    </div>
  )
}

export function Wordmark({ size = 19 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={size * 1.79} />
      <Display style={{ fontSize: size }}>Nestly</Display>
    </div>
  )
}
