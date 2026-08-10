import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Screen } from './app/Router'
import { PolicyBridge } from './app/PolicyBridge'
import { CloudBridge } from './app/CloudBridge'
import { WEB_SCREENS } from './app/nav'
import { useStore } from './app/store'
import { useDevice } from './platform/device'
import { Showcase } from './showcase/Showcase'
import { TabBar, showsTabBar } from './ui/TabBar'
import { RoleGate } from './screens/setup'
import { Onboarding } from './screens/onboarding'
import { Login } from './screens/login'

/**
 * Routes by device role first, screen second.
 *
 * A Nestly install is a parent phone or a child phone, and that decides which
 * half of the product it can show — a child device has no alerts feed and no
 * rule editor. Until the role is chosen, nothing else can render.
 */
export default function App() {
  const native = Capacitor.isNativePlatform()
  const wide = useWideViewport()
  const { ready, role, onboarded, signedIn, signIn } = useDevice()
  const { state } = useStore()
  const [card, setCard] = useState<0 | 1 | 2>(0)

  useEffect(() => {
    if (!native) return
    StatusBar.setStyle({ style: Style.Light }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#FFFFFF' }).catch(() => {})
    SplashScreen.hide().catch(() => {})
  }, [native])

  if (!ready) return <Splash />

  // The desktop showcase is a design review surface, not a device. It sits
  // above the role gate so every screen stays reachable for a walkthrough.
  if (wide && !native) {
    return (
      <>
        <PolicyBridge />
      <CloudBridge />
        <Showcase />
      </>
    )
  }

  // Order matters: the flash cards explain what this is, and only then does the
  // device commit to being a parent or a child phone.
  if (!onboarded) {
    return (
      <div className="safe-top flex h-full flex-col bg-white">
        <Onboarding index={card} onNext={() => setCard((c) => Math.min(2, c + 1) as 0 | 1 | 2)} />
      </div>
    )
  }

  if (!role) {
    return (
      <div className="safe-top flex h-full flex-col bg-white">
        <RoleGate />
      </div>
    )
  }

  if (role === 'child') {
    return (
      <div className="safe-top flex h-full flex-col bg-white">
        <Screen id="childHome" />
      </div>
    )
  }

  // Parent devices sign in; child devices deliberately do not. A child must be
  // able to reach their lock screen and their emergency numbers without a
  // password — gating that would turn a safety feature into a hazard.
  if (!signedIn) {
    return (
      <div className="safe-top flex h-full flex-col bg-white">
        <Login onSignedIn={signIn} />
      </div>
    )
  }

  // Web dashboard screens have no phone layout; on a small screen fall back to
  // the parent home rather than rendering a desktop split at 380px wide.
  const isWebScreen = WEB_SCREENS.includes(state.screen)
  const screen = isWebScreen ? 'home' : state.screen

  return (
    <div className="safe-top flex h-full flex-col bg-white">
      <PolicyBridge />
      <CloudBridge />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Screen id={screen} />
      </div>
      {showsTabBar(screen) ? <TabBar /> : null}
    </div>
  )
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-brand">
      <div className="h-12 w-12 rounded-full border-[6px] border-mint" />
    </div>
  )
}

function useWideViewport() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1100,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}
