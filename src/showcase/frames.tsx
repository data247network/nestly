import type { ReactNode } from 'react'

/**
 * The presentation frames — a phone and a desktop browser.
 *
 * These are what make the three versions legible side by side in a review or a
 * stakeholder walkthrough. They are chrome only: the live app renders inside
 * them, so what you see in the frame is exactly what ships.
 */

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[794px] w-[380px] shrink-0 rounded-[54px] bg-bezel p-3.5 shadow-phone">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[40px] bg-white">
        <StatusBar />
        <div className="relative flex-1 overflow-hidden">{children}</div>
        <div className="mx-auto mb-2.5 mt-2 h-[5px] w-[120px] shrink-0 rounded-full bg-ink" />
      </div>
    </div>
  )
}

function StatusBar() {
  return (
    <div className="relative flex h-11 shrink-0 items-center justify-between px-7 text-[13px] font-bold text-ink">
      <span>9:41</span>
      <div className="absolute left-1/2 top-1.5 h-[26px] w-24 -translate-x-1/2 rounded-[14px] bg-bezel" />
      <div className="relative h-2.5 w-5 rounded-[3px] border-[1.5px] border-ink">
        <div className="absolute bottom-px left-px top-px w-3.5 rounded-[1px] bg-ink" />
      </div>
    </div>
  )
}

export function BrowserFrame({
  children,
  sidebar,
}: {
  children: ReactNode
  sidebar: ReactNode
}) {
  return (
    <div className="w-[1120px] max-w-full overflow-hidden rounded-2xl border border-line bg-white shadow-browser">
      <div className="flex h-[46px] items-center gap-2 border-b border-line bg-cream px-4">
        <span className="h-[11px] w-[11px] rounded-full bg-coral" />
        <span className="h-[11px] w-[11px] rounded-full bg-amber" />
        <span className="h-[11px] w-[11px] rounded-full bg-mint" />
        <div className="ml-3.5 rounded-lg border border-line bg-white px-4 py-[5px] text-xs text-body">
          app.nestly.family
        </div>
      </div>
      <div className="flex h-[660px]">
        <div className="flex w-[190px] shrink-0 flex-col gap-1 border-r border-line bg-parchment px-3.5 py-5">
          {sidebar}
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
