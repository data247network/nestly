import { useEffect, useState } from 'react'
import { Display, Logo, Wordmark } from '../ui/kit'
import { Hub } from './Hub'
import { Admin } from './Admin'
import { hasCloud, supabase } from '../cloud/client'
import { matchPortal, normaliseCode, type PortalRoute } from './routes'

/**
 * The public site: what someone sees before they have an account or an app.
 *
 * Deliberately plain React with no data fetching. A setup link is the *first*
 * thing a child's phone ever loads, often on a slow connection in a hallway
 * with a parent waiting — so this must render instantly and must never depend
 * on the API being reachable to tell them what to do next.
 */

/**
 * One APK, offered twice.
 *
 * Parent and child are the same build; the role is chosen on first launch. Two
 * buttons because that is how a family thinks about it, and because it makes
 * the child's link unambiguous — but shipping one binary means one Play
 * listing, one review, one data-safety form and no chance of the two halves
 * drifting to different versions.
 */
const APK = '/downloads/nestly.apk'
const VERSION = '1.0'

export function Portal({ route }: { route: PortalRoute }) {
  if (route.name === 'setup') return <SetupLanding code={route.code} />
  if (route.name === 'download') return <Downloads />
  if (route.name === 'admin') {
    return (
      <Shell>
        <Admin />
      </Shell>
    )
  }
  if (route.name === 'signin' || route.name === 'signup' || route.name === 'hub') {
    return (
      <Shell>
        <Hub intent={route.name} />
      </Shell>
    )
  }
  return <Landing />
}

/* ------------------------------------------------------------------ chrome */

/**
 * Whether anyone is signed in, for the header alone.
 *
 * Undefined while unknown, which is not the same as signed out: rendering
 * "Sign in" during the check makes the button flicker to "Family Hub" a moment
 * later on every single page load.
 */
function useSignedIn(): boolean | undefined {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (!hasCloud()) return setSignedIn(false)

    // Subscribed, not sampled.
    //
    // A one-shot check at mount cannot see a sign-in that happens afterwards,
    // and that is the normal case: the header renders on /signin while the
    // visitor is still signed out, they submit the form, the hub swaps to the
    // dashboard — and the header goes on offering "Sign in" until something
    // forces a reload. Subscribing also covers signing out, and a session
    // expiring mid-visit.
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setSignedIn(session != null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return signedIn
}

function Shell({ children }: { children: React.ReactNode }) {
  const signedIn = useSignedIn()
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="/" aria-label="Nestly home">
            <Wordmark />
          </a>
          <nav className="flex items-center gap-5 text-[13.5px] font-bold text-body">
            <a href="/download" className="hover:text-brand">
              Download
            </a>
            {signedIn === undefined ? (
              <span className="px-4 py-2.5 text-transparent">Sign in</span>
            ) : (
              <a
                href={signedIn ? '/hub' : '/signin'}
                className="rounded-xl bg-brand px-4 py-2.5 text-white transition hover:bg-brandDark"
              >
                {signedIn ? 'Family Hub' : 'Sign in'}
              </a>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-16 border-t border-line bg-cream">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-8 text-[12.5px] text-body">
          <Logo />
          <p className="mt-2 max-w-xl leading-relaxed">
            Nestly keeps working with no signal at all. Routines, limits and
            emergency numbers live on the child's phone, so nothing depends on
            our servers being up.
          </p>
          <p className="mt-3 text-muted">© {new Date().getFullYear()} Nestly</p>
        </div>
      </footer>
    </div>
  )
}

/* ----------------------------------------------------------------- landing */

const BENEFITS = [
  {
    icon: '🛡',
    title: 'Real-time monitoring',
    body: 'See what is happening now, and what happened while you were apart.',
    bg: '#E4F5F2',
    fg: '#147D77',
  },
  {
    icon: '📍',
    title: 'Location tracking',
    body: 'Zones for home and school that tell you on arrival and departure.',
    bg: '#EFEBFB',
    fg: '#8B7FD1',
  },
  {
    icon: '⏱',
    title: 'Screen time limits',
    body: 'Routines that lock the phone at bedtime, enforced with no signal.',
    bg: '#FFF3DE',
    fg: '#8A5A16',
  },
  {
    icon: '🔔',
    title: 'Instant alerts',
    body: 'Blocked sites, low battery and new contacts, as they happen.',
    bg: '#FFE9E6',
    fg: '#C94A3B',
  },
]

const STEPS = [
  {
    n: 1,
    title: 'Create your account',
    body: 'Sign up as a parent. Your Family Hub is created with you as its first adult.',
  },
  {
    n: 2,
    title: 'Add a child, share the link',
    body: 'Adding a child gives you a setup link and an 8-character code to send them.',
  },
  {
    n: 3,
    title: 'Set up their phone',
    body: 'The link installs the app and the code links that phone to your account.',
  },
]

function Landing() {
  return (
    <Shell>
      <section className="mx-auto max-w-5xl px-6 pt-14">
        <span className="inline-block rounded-full bg-tint px-3.5 py-1.5 text-[12px] font-bold text-brand">
          Works offline over Bluetooth
        </span>
        <Display className="mt-5 max-w-2xl text-[42px] leading-[1.1]">
          Know they're safe. Without hovering.
        </Display>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-body">
          Location, screen time and gentle routines that keep working when the
          signal doesn't — because the rules live on your child's phone, not on
          our servers.
        </p>
        {/* The four things a parent is actually buying, stated before any
            call to action. Each one is a capability the app really has — this
            row is not aspirational. */}
        <div className="mt-9 grid max-w-3xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b) => (
            <div key={b.title}>
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-[19px]"
                style={{ background: b.bg, color: b.fg }}
              >
                {b.icon}
              </span>
              <h3 className="mt-2.5 text-[13.5px] font-bold">{b.title}</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-body">{b.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href="/download"
            className="rounded-xl bg-brand px-5 py-3 text-[14px] font-bold text-white transition hover:bg-brandDark"
          >
            Download the app
          </a>
          <a
            href="/hub"
            className="rounded-xl border border-line px-5 py-3 text-[14px] font-bold text-brand"
          >
            Open Family Hub
          </a>
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-5xl px-6">
        <h2 className="text-center text-[13px] font-bold tracking-[0.08em] text-brand">
          GET STARTED IN 3 STEPS
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-line p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-[14px] font-bold text-brand">
                {s.n}
              </span>
              <h3 className="mt-3 text-[15px] font-bold">{s.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-body">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-5xl px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-tint p-6">
            <h3 className="text-[15px] font-bold text-brand">Cloud sync</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-tealInk">
              When there is internet, you see your family from anywhere, and
              their history survives a lost or replaced phone.
            </p>
          </div>
          <div className="rounded-2xl bg-cream p-6">
            <h3 className="text-[15px] font-bold">Bluetooth sync</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-body">
              With no internet at all, the two phones still talk directly. Limits
              are enforced and events are logged, then sent when you are near.
            </p>
          </div>
        </div>
      </section>
    </Shell>
  )
}

/* --------------------------------------------------------------- downloads */

function Downloads() {
  return (
    <Shell>
      <section className="mx-auto max-w-3xl px-6 py-14">
        <Display className="text-[30px]">Download Nestly</Display>
        <p className="mt-3 text-[14px] leading-relaxed text-body">
          One app for both phones. Each install asks once whether it is the
          parent's phone or the child's.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <DownloadCard
            title="Parent's phone"
            body="See where they are, set routines and limits, read the activity report."
          />
          <DownloadCard
            title="Child's phone"
            body="Runs the routines, keeps emergency numbers reachable, shows exactly what is shared."
          />
        </div>

        <SideloadNotice />
      </section>
    </Shell>
  )
}

function DownloadCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-line p-5">
      <h3 className="text-[15px] font-bold">{title}</h3>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-body">{body}</p>
      <a
        href={APK}
        download
        className="mt-4 rounded-xl bg-brand px-4 py-3 text-center text-[13.5px] font-bold text-white transition hover:bg-brandDark"
      >
        Download APK
      </a>
      <span className="mt-2 text-center text-[11.5px] text-muted">
        Version {VERSION} · Android 5.1+
      </span>
    </div>
  )
}

/**
 * Android will not install a downloaded APK without permission, and it asks in
 * a dialog that reads like a security warning. Saying so up front is the
 * difference between a parent finishing setup and abandoning it.
 */
function SideloadNotice() {
  return (
    <div className="mt-8 rounded-2xl bg-amberBg px-5 py-4 text-[12.5px] leading-relaxed text-[#8A5A16]">
      <b>Installing outside the Play Store.</b> When you open the downloaded
      file, Android asks whether to allow installs from that app — your browser
      or file manager. That prompt is expected. Nestly is not yet on the Play
      Store, so this is the only way to install it today.
    </div>
  )
}

/* ------------------------------------------------------------ setup link */

/**
 * Where a child's setup link lands.
 *
 * The code is shown rather than used: this page cannot redeem it, because
 * redemption has to happen *on the phone being linked* — that is what binds the
 * device. Doing it here would enrol whichever machine opened the link.
 */
function SetupLanding({ code }: { code: string | null }) {
  const [typed, setTyped] = useState('')
  const effective = code ?? (normaliseCode(typed).length === 8 ? normaliseCode(typed) : null)

  return (
    <Shell>
      <section className="mx-auto max-w-2xl px-6 py-14">
        <span className="text-[12px] font-bold tracking-[0.06em] text-brand">
          SETTING UP THIS PHONE
        </span>
        <Display className="mt-2 text-[30px]">Let's link this phone</Display>

        {effective ? (
          <div className="mt-6 rounded-2xl bg-tint py-7 text-center">
            <div className="text-[11.5px] font-bold tracking-[0.05em] text-tealInk">
              YOUR SETUP CODE
            </div>
            <Display className="mt-1.5 text-[36px] tracking-[0.12em] text-brand">
              {effective.slice(0, 4)}-{effective.slice(4)}
            </Display>
            <div className="mt-2 text-[11.5px] text-tealInk">
              Expires 24 hours after it was created
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-line p-5">
            <label
              htmlFor="code"
              className="text-[11.5px] font-bold tracking-[0.05em] text-body"
            >
              ENTER THE CODE YOUR PARENT SENT
            </label>
            <input
              id="code"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="ABCD-1234"
              autoCapitalize="characters"
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-[18px] tracking-[0.1em] outline-none focus:border-brand"
            />
          </div>
        )}

        <ol className="mt-8 flex flex-col gap-4">
          <Step n={1} title="Install Nestly on this phone">
            <a
              href={APK}
              download
              className="mt-2 inline-block rounded-xl bg-brand px-4 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-brandDark"
            >
              Download the app
            </a>
          </Step>
          <Step n={2} title="Open it and choose “This is my child's phone”">
            <p className="text-[13px] leading-relaxed text-body">
              This decides which half of Nestly the phone runs. It is asked once.
            </p>
          </Step>
          <Step n={3} title="Tap “Have a setup code?” and enter the code">
            <p className="text-[13px] leading-relaxed text-body">
              That links this phone to your family's account. The phone needs to
              be online for this one step; everything after it works offline.
            </p>
          </Step>
        </ol>

        <div className="mt-8 rounded-2xl bg-cream px-5 py-4 text-[12px] leading-relaxed text-body">
          Nestly shows the child exactly what is shared, and the app is visible
          on their phone at all times. It is not designed to be hidden.
        </div>
      </section>
    </Shell>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-[13px] font-bold text-brand">
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="text-[14.5px] font-bold">{title}</h3>
        {children}
      </div>
    </li>
  )
}

/** Resolves the current URL to a portal route, or null for the app. */
export function currentPortalRoute(): PortalRoute | null {
  if (typeof window === 'undefined') return null
  return matchPortal(window.location.pathname, window.location.search)
}
