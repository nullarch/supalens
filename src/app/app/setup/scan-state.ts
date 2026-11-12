import { BOOTSTRAP_PHASES, type BootstrapProgress, type BootstrapPhase } from '@/lib/bootstrap/events'

export interface ScanStatus extends Pick<BootstrapProgress, 'phases' | 'counts' | 'items' | 'error'> {
  active: boolean
  resumeFrom: BootstrapPhase | null
}
export type ScanGate = 'failed' | 'limit' | 'quota' | 'conflict' | 'repository' | 'permission' | null
export type ScanRequest = 'idle' | 'submitting' | 'waiting'

export function scanFailed(status: ScanStatus): boolean {
  return BOOTSTRAP_PHASES.some(p => status.phases[p] === 'failed')
}
export function scanReady(status: ScanStatus): boolean {
  return !status.active && !scanFailed(status) && status.phases.kpi === 'done'
}
export function scanGate(status: number, code?: string): ScanGate {
  if (status === 402) return code === 'context_limit' ? 'limit' : 'quota'
  if (status === 401 || status === 403) return 'permission'
  if (status === 409 && code === 'scan_in_progress') return 'conflict'
  if (status === 409 && ['repo_invalid', 'installation_not_found'].includes(code ?? '')) return 'repository'
  return 'failed'
}
