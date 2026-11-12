import { describe, expect, it } from 'vitest'
import { reportChangeResult, reportCreationResult, reportPickerRows, reportSaveScope, reportWidgetResult } from './save-result'

const report = { id: 'report-1', slug: 'weekly-abc123', name: 'Weekly review', pinned: false, position: 0 }

describe('report save acknowledgement', () => {
  it('classifies management acknowledgements independently of view refresh', () => {
    expect(reportChangeResult({ ok: true, data: undefined })).toEqual({ kind: 'confirmed', data: undefined })
    expect(reportChangeResult({ ok: false, reason: 'error', message: 'Rejected' })).toEqual({ kind: 'rejected', reason: 'error', message: 'Rejected' })
    for (const value of [undefined, null, [], {}, { ok: 1 }, { ok: 'true' }, { ok: false }]) expect(reportChangeResult(value).kind).toBe('unknown')
  })
  it('requires a strict acknowledgement and usable creation destination', () => {
    expect(reportCreationResult({ ok: true, data: report })).toEqual({ kind: 'confirmed', data: { id: report.id, slug: report.slug } })
    for (const value of [null, [], {}, { ok: 'true', data: report }, { ok: true }, { ok: false }, { ok: false, reason: 'unexpected' }]) {
      expect(reportCreationResult(value).kind).toBe('unknown')
      expect(reportWidgetResult(value).kind).toBe('unknown')
    }
  })
  it.each(['', ' ', '../outside', '//external.test', 'https://external.test', 'safe?next=bad', 'safe#fragment', '%2foutside', 'a\\b'])('does not construct a report route with slug %j', slug => {
    expect(reportCreationResult({ ok: true, data: { id: 'report', slug } }).kind).toBe('unknown')
    expect(reportPickerRows([{ ...report, slug }])).toBeNull()
  })
  it('requires a returned widget id before showing saved', () => {
    expect(reportWidgetResult({ ok: true, data: { id: 'widget-1' } }).kind).toBe('confirmed')
    for (const id of ['', ' ', null, 7, undefined]) {
      expect(reportWidgetResult({ ok: true, data: { id } }).kind).toBe('unknown')
      expect(reportCreationResult({ ok: true, data: { id, slug: 'safe' } }).kind).toBe('unknown')
    }
  })
  it.each(['unconfigured', 'unauthorized', 'not_found', 'error'])('retains explicit %s rejections', reason => {
    for (const parse of [reportCreationResult, reportWidgetResult]) {
      expect(parse({ ok: false, reason, message: 'Try again' })).toEqual({ kind: 'rejected', reason, message: 'Try again' })
      expect(parse({ ok: false, reason, message: { invalid: true } })).toEqual({ kind: 'rejected', reason, message: undefined })
    }
  })
})

describe('report picker read and save scope', () => {
  it('distinguishes an empty list from a malformed read', () => {
    expect(reportPickerRows([])).toEqual([])
    expect(reportPickerRows([report])).toEqual([report])
    for (const value of [null, {}, [null], [report, report], [{ ...report, position: NaN }], [{ ...report, pinned: 'false' }], [{ ...report, name: null }]]) {
      expect(reportPickerRows(value)).toBeNull()
    }
  })
  it('preserves equal payloads and isolates changed visualizations and sources', () => {
    const scope = reportSaveScope({ title: 'A', values: [1, 2] }, 'source-a')
    expect(reportSaveScope({ title: 'A', values: [1, 2] }, 'source-a')).toBe(scope)
    expect(reportSaveScope({ title: 'B', values: [1, 2] }, 'source-a')).not.toBe(scope)
    expect(reportSaveScope({ title: 'A', values: [1, 2] }, 'source-b')).not.toBe(scope)
    expect(reportSaveScope({}, null)).toBe(reportSaveScope({}))
  })
})
