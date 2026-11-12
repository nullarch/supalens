import type { WidgetSample } from '@/components/dashboard/widgets/__fixtures__/samples'

export const WIDGET_MODES = ['ready', 'loading', 'error', 'empty', 'invalid-data', 'missing', 'long', 'fill', 'zero', 'nonnumeric', 'negative', 'invalid-time', 'future-time', 'references', 'references-long', 'references-fill'] as const

/** Fixture transformations only. Never execute a query or change a stored spec. */
export function sampleProps(sample: WidgetSample, mode: string) {
  let data: unknown = sample.data
  const spec = structuredClone(sample.spec)
  if (mode === 'references' && 'y' in spec && spec.type !== 'scatter') {
    const keys = Array.isArray(spec.y) ? spec.y : [spec.y]
    const maximum = Math.max(1, ...sample.data.rows.flatMap(row => keys.map(key => Number(row[key]) || 0)))
    spec.references = (['neutral', 'target', 'warning', 'critical'] as const).map((intent, index) => ({
      value: maximum * (index + 1) / 5, label: ['Base', 'Target', 'Warn', 'Limit'][index], intent,
    }))
  }
  if (['references-long', 'references-fill'].includes(mode) && 'y' in spec && spec.type !== 'scatter') {
    const keys = Array.isArray(spec.y) ? spec.y : [spec.y]
    const maximum = Math.max(1, ...sample.data.rows.flatMap(row => keys.map(key => Number(row[key]) || 0)))
    const level = maximum / 2
    spec.references = [
      { value: level, label: 'LongUnbrokenReferenceName'.repeat(2).slice(0, 40), intent: 'warning' },
      { value: level, label: '결제 완료 후 접근 권한 누락 확인 기준선 '.repeat(2).slice(0, 40), intent: 'warning' },
      { value: level + .000001, label: '支払い完了後のアクセス権限確認の基準値'.repeat(3).slice(0, 40), intent: 'critical' },
      { value: 0, intent: 'neutral' },
    ]
  }
  if (mode === 'empty') data = { columns: sample.data.columns, rows: [] }
  if (mode === 'invalid-data') data = { rows: 'not-an-array' }
  if (mode === 'missing') data = { columns: ['unrelated'], rows: [{ unrelated: 3 }] }
  if (mode === 'long' || mode === 'fill') {
    spec.title = 'SampleBusinessSignal_'.repeat(6).slice(0, 120)
    spec.description = 'Full recorded definition and context must remain readable. '.repeat(6)
    data = { ...sample.data, rows: sample.data.rows.map((row, index) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      typeof value === 'number' ? 123456789012345 : typeof value === 'string' && !/^\d{4}-/.test(value) ? 'LongInternationalSegment_'.repeat(6) + index : value,
    ]))) }
  }
  if (['zero', 'nonnumeric', 'negative'].includes(mode)) {
    data = { ...sample.data, rows: sample.data.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      typeof value === 'number' ? mode === 'zero' ? 0 : mode === 'negative' ? -Math.abs(value) : 'not-numeric' : value,
    ]))) }
  }
  return {
    spec, data,
    state: mode === 'loading' ? 'loading' as const : mode === 'error' ? 'error' as const : undefined,
    error: mode === 'error' ? 'Sample read failure: ' + 'diagnostic_'.repeat(35) : undefined,
    fill: mode === 'fill' || mode === 'references-fill',
    refreshedAt: mode === 'invalid-time' ? 'invalid' : mode === 'future-time' ? '2099-01-01T00:00:00Z' : '2026-09-07T12:00:00Z',
  }
}
