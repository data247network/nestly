import type { CapacitorConfig } from '@capacitor/cli'

// Pinned to the Capacitor 6.x line on purpose: it targets compileSdk 34 / Gradle
// 8.2 / JDK 17, which is exactly the toolchain already installed on this machine
// under ~/.fbms-android. Capacitor 7 would demand SDK 35 + JDK 21 and break it.
const config: CapacitorConfig = {
  appId: 'family.nestly.app',
  appName: 'Nestly',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#147D77',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
}

export default config
