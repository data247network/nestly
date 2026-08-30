import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Screen } from './app/Router'
import { PolicyBridge } from './app/PolicyBridge'
import { CloudBridge } from './app/CloudBridge'
import { CloudHydrate } from './app/CloudHydrate'
import { CloudCommandBridge } from './app/CloudCommandBridge'
import { NotesBridge } from './app/NotesBridge'
import { PushBridge } from './app/PushBridge'
import { WEB_SCREENS } from './app/nav'
import { useStore } from './app/store'
import { useDevice } from './platform/device'
import { Showcase } from './showcase/Showcase'
import { Portal, currentPortalRoute } from './portal/Portal'
import { UpdateBanner } from './app/UpdateBanner'
import { TabBar, showsTabBar } from './ui/TabBar'
import { RoleGate } from './screens/setup'
import { Onboarding } from './screens/onboarding'
import { Login } from './screens/login'
import { hasCloud, supabase } from './cloud/client'

export default function App() {
  const native = Capacitor.isNativePlatform()
  const wide = useWideViewport()
  const { ready, role, onboarded, signedIn, signIn, signOut } = useDevice()
  const { state } = useStore()
  const [card, setCard] = useState<0 | 1 | 2>(0)
  const [authReady, setAuthReady] = useState(false)
  const [cloudSession, setCloudSession] = useState<boolean | null>(null)

  useEffect(() => {
    if (!native) return
    StatusBar.setStyle({ style: Style.Light }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#FFFFFF' }).catch(() => {})
    SplashScreen.hide().catch(() => {})
  }, [native])

  useEffect(() => {
    if (!ready || role !== 'parent') {
      setCloudSession(null)
      setAuthReady(role !== 'parent')
      return
    }
    if (!hasCloud()) {
      setCloudSession(null)
      setAuthReady(true)
      return
    }

    let cancelled = false
    const client = supabase()
    setAuthReady(false)
    setCloudSession(null)

    const applySession = async (session: unknown) => {
      if (cancelled) return
      const valid = Boolean(session)
      setCloudSession(valid)
      if (valid && !signedIn) await signIn()
      if (!valid && signedIn) await signOut()
      if (!cancelled) setAuthReady(true)
    }

    void client.auth.getSession()
      .then(({ data, error }) => {
        if (error) return applySession(null)
        return applySession(data.session)
      })
      .catch(() => applySession(null))

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      void applySession(session)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [ready, role, signedIn, signIn, signOut])

  if (!ready || (role === 'parent' && hasCloud() && !authReady)) return <Splash />
  const portal = native || forcedApp() ? null : currentPortalRoute()
  if (portal) return <Portal route={portal} />
  if (wide && !native && showcaseRequested()) return <><PolicyBridge /><CloudBridge /><Showcase /></>
  if (!onboarded) return <div className="safe-top flex h-full flex-col bg-white"><Onboarding index={card} onNext={() => setCard((c) => Math.min(2, c + 1) as 0 | 1 | 2)} /></div>
  if (!role) return <div className="safe-top flex h-full flex-col bg-white"><RoleGate /></div>
  if (role === 'child') return <div className="safe-top flex h-full flex-col bg-white"><CloudCommandBridge /><UpdateBanner /><Screen id="childHome" /></div>

  // For cloud-backed parent accounts, Supabase is the authentication source of truth.
  // Local signedIn is retained only for non-cloud/test builds and legacy UI state.
  const parentSignedIn = hasCloud() ? cloudSession === true : signedIn
  if (!parentSignedIn) return <div className="safe-top flex h-full flex-col bg-white"><Login onSignedIn={signIn} /></div>

  const isWebScreen = WEB_SCREENS.includes(state.screen)
  const screen = isWebScreen ? 'home' : state.screen
  return (
    <div className="safe-top relative flex h-full flex-col bg-white">
      <PolicyBridge /><CloudBridge /><CloudHydrate /><NotesBridge /><PushBridge /><CloudCommandBridge />
      <button type="button" onClick={() => void signOut()} className="absolute right-3 top-3 z-50 rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-body shadow-sm">Sign out</button>
      <div className="min-h-0 flex-1 overflow-y-auto"><UpdateBanner /><Screen id={screen} /></div>
      {showsTabBar(screen) ? <TabBar /> : null}
    </div>
  )
}

function Splash() { return <div className="flex h-full items-center justify-center bg-brand"><div className="h-12 w-12 rounded-full border-[6px] border-mint" /></div> }
function forcedApp(): boolean { return flag('app') }
function showcaseRequested(): boolean { return flag('showcase') }
function flag(name: string): boolean { try { return new URLSearchParams(globalThis.location?.search ?? '').get(name) === '1' } catch { return false } }
function useWideViewport() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1100)
  useEffect(() => { const mq = window.matchMedia('(min-width: 1100px)'); const on = () => setWide(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }, [])
  return wide
}
