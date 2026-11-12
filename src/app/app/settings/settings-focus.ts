/** Return focus only if a pending/removed control left it on the document body. */
export function captureSettingsFocus() {
  const control = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return { control, region: control?.closest<HTMLElement>('[data-setting]') ?? null }
}

export function restoreSettingsFocus(origin: ReturnType<typeof captureSettingsFocus> | null) {
  if (!origin || document.activeElement !== document.body) return
  const target = origin.control?.isConnected && !origin.control.matches(':disabled') ? origin.control
    : origin.region?.isConnected ? origin.region.querySelector<HTMLElement>('[data-save-notice]') : null
  target?.focus({ preventScroll: true })
}
