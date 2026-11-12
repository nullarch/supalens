import type { ReactNode } from 'react'

import { SettingsNav } from '@/components/dashboard/SettingsNav'
import s from './settings-section.module.css'

/**
 * The Settings section. The sidebar holds one Settings row, so every page under /app/settings
 * renders behind this shared sub-nav — moving the six configuration rows one level in, where they
 * only cost attention while someone is configuring something.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={s.section}>
      <SettingsNav />
      {children}
    </div>
  )
}
