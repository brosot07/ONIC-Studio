import { useEffect } from 'react'

const IDLE_MS = 30 * 60 * 1000
const KEY = 'onic.lastActivity'
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

const readShared = (): number => {
  try {
    return Number(localStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

/**
 * Calls onIdle after 30 minutes without input in ANY open ONIC Studio tab. Uses wall-clock
 * time, so a sleeping laptop or a background tab still times out when it wakes up.
 */
export const useIdleTimeout = (active: boolean, onIdle: () => void): void => {
  useEffect(() => {
    if (!active) return
    let last = Date.now()
    let lastWrite = 0
    const touch = () => {
      last = Date.now()
      // Share activity with other tabs, at most every few seconds.
      if (last - lastWrite > 5000) {
        lastWrite = last
        try {
          localStorage.setItem(KEY, String(last))
        } catch {
          // Private mode: this tab still times out on its own.
        }
      }
    }
    const check = () => {
      if (Date.now() - Math.max(last, readShared()) >= IDLE_MS) onIdle()
    }
    touch()
    for (const event of ACTIVITY) window.addEventListener(event, touch, { passive: true })
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, 30_000)
    return () => {
      for (const event of ACTIVITY) window.removeEventListener(event, touch)
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(timer)
    }
  }, [active, onIdle])
}
