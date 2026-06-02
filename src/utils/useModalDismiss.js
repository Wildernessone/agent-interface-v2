import { useEffect, useRef } from 'react'

/**
 * Shared modal/drawer accessibility behaviors:
 *  - Escape closes the modal.
 *  - Focus is restored to whatever element was focused before the modal opened
 *    (so keyboard/screen-reader users return to the trigger on close).
 *  - Optionally moves focus into the modal on open (pass a focusRef to a
 *    focusable element inside it).
 *
 * Pass { active } for always-mounted drawers that toggle via an `open` prop;
 * when inactive the listeners and focus handling are skipped.
 *
 * Deliberately does NOT trap Tab — a focus trap needs interactive verification;
 * this covers the high-value, low-risk behaviors. Pair with
 * role="dialog" aria-modal="true" aria-labelledby=… on the container.
 */
export function useModalDismiss(onClose, { active = true, focusRef } = {}) {
  // Keep the latest onClose without re-registering the listener every render
  // (most callers pass an inline arrow).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!active) return undefined
    const restore = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.() }
    }
    document.addEventListener('keydown', onKey)
    if (focusRef?.current) {
      const el = focusRef.current
      requestAnimationFrame(() => { try { el.focus({ preventScroll: true }) } catch { /* element gone */ } })
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restore && typeof restore.focus === 'function') {
        try { restore.focus({ preventScroll: true }) } catch { /* element gone */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
