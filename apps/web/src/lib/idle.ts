import { useEffect } from 'react'

const IDLE_MS = 30 * 60 * 1000
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

/**
 * Calls onIdle after 30 minutes without input. Uses wall-clock time so a sleeping
 * laptop or a background tab still times out when it wakes up.
 */
export const useIdleTimeout = (active: boolean, onIdle: () => void): void => {
  useEffect(() => {
    if (!active) return
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const check = () => {
      if (Date.now() - last >= IDLE_MS) onIdle()
    }
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
