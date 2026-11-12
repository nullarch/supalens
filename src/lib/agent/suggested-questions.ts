/**
 * Suggested questions built from a source's APPROVED KPIs.
 *
 * The empty Ask screen used to offer nothing but a blank box (outside the demo source). Once a
 * team has approved KPI definitions, those titles are the questions they actually ask — so the
 * chips are generated from the catalog rather than invented. Pure: the caller supplies the
 * localized templates, so this file holds no copy.
 */

/** The minimum a catalog row must expose for a chip. Matches `KpiCatalogRow` structurally. */
export interface SuggestibleKpi {
  key: string
  title: string
  status: string
  importance?: number
}

export interface SuggestedQuestion {
  /** stable react key — `${kpi.key}:${templateIndex}` */
  id: string
  text: string
}

export const MAX_SUGGESTED_QUESTIONS = 6

/**
 * One chip per approved KPI, most important first, cycling through the templates so a source
 * with few KPIs still shows variety instead of six rows of the same phrasing.
 *
 * `templates` are localized strings containing `{title}` (e.g. "{title} 지난주 대비").
 */
export function buildSuggestedQuestions(
  kpis: SuggestibleKpi[],
  templates: string[],
  max = MAX_SUGGESTED_QUESTIONS,
): SuggestedQuestion[] {
  if (templates.length === 0) return []
  const approved = kpis
    .filter((k) => k.status === 'accepted' && k.title.trim().length > 0)
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
  if (approved.length === 0) return []

  const out: SuggestedQuestion[] = []
  // Round-robin over templates: with 1 KPI the user still gets several angles on it; with 6+
  // KPIs each gets exactly one chip, so breadth wins over repetition. Capped at the template
  // count so a single KPI never repeats the same phrasing to pad the row out to `max`.
  const rounds = Math.min(templates.length, Math.ceil(max / approved.length))
  for (let round = 0; round < rounds && out.length < max; round++) {
    const template = templates[round % templates.length]
    for (const kpi of approved) {
      if (out.length >= max) break
      out.push({ id: `${kpi.key}:${round}`, text: template.replace('{title}', kpi.title.trim()) })
    }
  }
  return out
}
