import { useStore } from '../app/store'
import { useDevice } from '../platform/device'
import { Scene } from '../art/Scene'
import { Display, Dots, Field, FieldLabel, PrimaryButton, Wordmark } from '../ui/kit'

/**
 * The three onboarding flash cards.
 *
 * The source design used abstract geometric placeholders here; these carry the
 * real family artwork, which is what the cards are actually for — a parent
 * deciding in three swipes whether this app is for their household.
 */
const CARDS = [
  {
    scene: 'safe' as const,
    title: "Know they're safe, always",
    body: 'Real-time location and gentle check-ins, so you always know your child is okay — without hovering.',
    alt: 'A parent checking their child’s location on a phone while the child walks to school',
  },
  {
    scene: 'gently' as const,
    title: 'See their world, gently',
    body: 'A friendly view of screen time and app activity, so you can guide instead of guess.',
    alt: 'A parent and child looking at a tablet together',
  },
  {
    scene: 'together' as const,
    title: 'Set limits, together',
    body: 'Build routines like School or Lunch that keep working even offline.',
    alt: 'A family of four standing together',
  },
]

export function Onboarding({
  index,
  onNext,
}: {
  index: 0 | 1 | 2
  /** Live flow advances through local state; the showcase navigates by screen id. */
  onNext?: () => void
}) {
  const { go } = useStore()
  const { completeOnboarding } = useDevice()
  const card = CARDS[index]
  const last = index === 2
  // Onboarding ends by handing over to the role gate — there is no account to
  // sign in to yet, and the device has to know which half of the link it is.
  const finish = () => void completeOnboarding()

  return (
    <div className="flex h-full flex-col px-[26px] pb-[26px] pt-[30px]">
      <div className="flex flex-1 items-center justify-center">
        <Scene name={card.scene} title={card.alt} className="w-[200px]" />
      </div>

      <Dots index={index} />

      <Display className="mb-2.5 text-center text-[25px] leading-tight">{card.title}</Display>
      <p className="mb-6 text-center text-sm leading-[1.55] text-body">{card.body}</p>

      {last ? (
        <PrimaryButton onClick={finish}>Get started</PrimaryButton>
      ) : (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="p-2.5 text-[13.5px] font-bold text-muted"
          >
            Skip
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => (onNext ? onNext() : go(index === 0 ? 'onboard2' : 'onboard3'))}
            className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-brand text-[19px] text-white transition active:scale-95"
          >
            →
          </button>
        </div>
      )}
    </div>
  )
}

export function SignIn() {
  const { go } = useStore()
  return (
    <div className="flex h-full flex-col px-[26px] py-[38px]">
      <div className="mb-9">
        <Wordmark />
      </div>
      <Display className="mb-1.5 text-[23px]">Welcome back</Display>
      <p className="mb-[26px] text-[13.5px] text-body">Sign in to check in on your family.</p>

      <div className="mb-[18px] flex flex-col gap-3">
        <Field value="parent@family.com" muted />
        <Field value="••••••••" muted />
      </div>

      <button type="button" className="mb-5 text-right text-[12.5px] font-bold text-brand">
        Forgot password?
      </button>

      <PrimaryButton className="mb-4" onClick={() => go('home')}>
        Sign in
      </PrimaryButton>

      <div className="text-center text-[13px] text-body">
        New family?{' '}
        <button type="button" onClick={() => go('addChild')} className="font-bold text-brand">
          Create account
        </button>
      </div>
    </div>
  )
}

export function AddChild() {
  const { go } = useStore()
  const ages = ['5–8', '9–12', '13–15', '16–18']
  const colors = ['#147D77', '#FF6B5B', '#FFB84D', '#8B7FD1']

  return (
    <div className="flex h-full flex-col px-6 py-[30px]">
      <button type="button" onClick={() => go('login')} className="mb-[18px] w-8 text-left text-xl">
        ←
      </button>
      <div className="mb-1.5 text-[11.5px] font-bold tracking-[0.05em] text-brand">STEP 1 OF 2</div>
      <Display className="mb-[22px] text-[22px]">Add your first child</Display>

      <FieldLabel>NAME</FieldLabel>
      <div className="mb-5">
        <Field value="Maya" />
      </div>

      <FieldLabel>AGE RANGE</FieldLabel>
      <div className="mb-5 flex flex-wrap gap-2">
        {ages.map((a, i) => (
          <span
            key={a}
            className={`rounded-[20px] px-3.5 py-2.5 text-[12.5px] font-bold ${
              i === 1 ? 'bg-tint text-brand' : 'bg-cream text-body'
            }`}
          >
            {a}
          </span>
        ))}
      </div>

      <FieldLabel>AVATAR COLOR</FieldLabel>
      <div className="mb-[30px] flex gap-2.5">
        {colors.map((c, i) => (
          <span
            key={c}
            className={`h-[34px] w-[34px] rounded-full ${i === 0 ? 'ring-[2.5px] ring-ink' : ''}`}
            style={{ background: c }}
          />
        ))}
      </div>

      <div className="flex-1" />
      <PrimaryButton onClick={() => go('enrollDevice')}>Continue</PrimaryButton>
    </div>
  )
}

export function EnrollDevice() {
  const { go } = useStore()
  const steps = [
    'Scan this QR code during setup',
    'Confirm Supervised Mode / Device Owner',
    "Set a passcode so the profile can't be removed",
  ]
  return (
    <div className="flex h-full flex-col px-6 py-[30px]">
      <button
        type="button"
        onClick={() => go('addChild')}
        className="mb-[18px] w-8 text-left text-xl"
      >
        ←
      </button>
      <div className="mb-1.5 text-[11.5px] font-bold tracking-[0.05em] text-brand">STEP 2 OF 2</div>
      <Display className="mb-[18px] text-[22px]">Enroll Maya's phone</Display>

      <div className="mb-5 flex gap-2">
        <span className="flex-1 rounded-xl bg-brand py-2.5 text-center text-[13px] font-bold text-white">
          iOS
        </span>
        <span className="flex-1 rounded-xl bg-cream py-2.5 text-center text-[13px] font-bold text-body">
          Android
        </span>
      </div>

      <div className="mx-auto mb-5 flex h-[140px] w-[140px] items-center justify-center rounded-2xl border-[1.5px] border-dashed border-line2 bg-cream">
        <QrPlaceholder />
      </div>

      <ol className="mb-[22px] flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2.5 text-[13px]">
            <span className="font-bold text-brand">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="flex-1" />
      <PrimaryButton onClick={() => go('home')}>Device enrolled ✓</PrimaryButton>
    </div>
  )
}

/**
 * A stand-in QR block. The real enrollment code is minted server-side and
 * carries the one-time device token — see README "Where the real backend
 * plugs in".
 */
function QrPlaceholder() {
  // A fixed pattern, so it reads as a QR code rather than random noise.
  const cells = [
    0b1110111, 0b1000101, 0b1011101, 0b1010001, 0b1110110, 0b0001011, 0b1101101,
  ]
  return (
    <svg viewBox="0 0 7 7" className="h-24 w-24" shapeRendering="crispEdges" aria-hidden>
      {cells.flatMap((row, y) =>
        Array.from({ length: 7 }, (_, x) =>
          (row >> (6 - x)) & 1 ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#1E2A32" />
          ) : null,
        ),
      )}
    </svg>
  )
}
