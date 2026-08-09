/** @type {import('tailwindcss').Config} */
// Design tokens lifted verbatim from FamilyApp.dc.html so the port stays 1:1.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#147D77', // primary teal — buttons, active nav, brand mark
        brandDark: '#0F5F5A', // hover / pressed
        mint: '#5FD3C4', // on-dark accent
        tint: '#E4F5F2', // teal wash — active pills, child notice bg
        cream: '#F7F3EC', // app background / tinted surface
        parchment: '#FBF9F5', // web dashboard sidebar
        line: '#E7E1D6', // hairline border
        line2: '#C9C2B4', // dashed / stronger border
        ink: '#1E2A32', // primary text, dark surfaces
        slate2: '#3E4A50', // dense body text
        body: '#6B7680', // secondary text
        muted: '#9AA2A9', // tertiary text
        amber: '#FFB84D', // warning accent
        amberBg: '#FFF3DE',
        coral: '#FF6B5B', // alert accent
        coralBg: '#FFE9E6',
        coralInk: '#C94A3B',
        violet: '#8B7FD1', // content / encryption accent
        violetBg: '#EFEBFB',
        mapBg: '#DCEFE9', // map canvas
        mapGrid: '#C9E4DC', // map gridlines
        bezel: '#12181C', // phone frame
        night: '#2B3944', // dark surface on child lock
        nightLine: '#47555F',
        nightBody: '#A9B2B9',
        tealInk: '#3E5B57', // body text on teal wash
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Baloo 2"', 'Manrope', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        phone: '0 40px 70px -25px rgba(30,42,50,0.4)',
        browser: '0 40px 70px -25px rgba(30,42,50,0.3)',
        pin: '0 2px 6px rgba(0,0,0,0.2)',
      },
    },
  },
  plugins: [],
}
