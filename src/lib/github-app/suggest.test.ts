import { describe, expect, it } from 'vitest'

import { SUGGEST_THRESHOLD, rankRepos, similarity, suggestRepos, tokenize } from './suggest'

const repo = (fullName: string) => ({ id: fullName, fullName })

describe('tokenize', () => {
  it('breaks on separators, camelCase and letter/digit boundaries', () => {
    expect(tokenize('DailyCart-prod_v2')).toEqual(['daily', 'cart', 'prod', 'v', '2'])
    expect(tokenize('acme/daily-cart')).toEqual(['acme', 'daily', 'cart'])
  })
})

describe('similarity', () => {
  it('is 1 for names that differ only in casing, separators or generic words', () => {
    expect(similarity('daily-cart', 'dailyCart')).toBe(1)
    expect(similarity('DailyCart prod', 'daily_cart')).toBe(1)
  })

  it('rewards a shared meaningful token', () => {
    expect(similarity('dailycart-db', 'dailycart-web')).toBeGreaterThan(SUGGEST_THRESHOLD)
  })

  it('does not match on generic words alone', () => {
    // Both sides reduce to nothing meaningful but "prod"/"api" — must not read as a match.
    expect(similarity('prod db', 'company-api')).toBeLessThan(SUGGEST_THRESHOLD)
    expect(similarity('production database', 'web-app')).toBeLessThan(SUGGEST_THRESHOLD)
  })

  it('ignores short accidental containment', () => {
    // "cs" inside "analytics" is a coincidence, not a signal.
    expect(similarity('cs', 'analytics')).toBeLessThan(SUGGEST_THRESHOLD)
  })

  it('is symmetric', () => {
    expect(similarity('shopfront', 'shopfront-web')).toBeCloseTo(similarity('shopfront-web', 'shopfront'))
  })
})

describe('rankRepos', () => {
  it('weights the bare repo name above the owner-qualified name', () => {
    // The org is called "dailycart" too; the repo actually named dailycart must still win.
    const ranked = rankRepos('dailycart', [repo('dailycart/infra'), repo('dailycart/dailycart')])
    expect(ranked[0].repo.fullName).toBe('dailycart/dailycart')
  })

  it('orders deterministically when scores tie', () => {
    // Neither shares anything with "warehouse", so both score 0 and the name breaks the tie.
    const ranked = rankRepos('warehouse', [repo('acme/beta'), repo('acme/alpha')])
    expect(ranked.map((r) => r.score)).toEqual([0, 0])
    expect(ranked.map((r) => r.repo.fullName)).toEqual(['acme/alpha', 'acme/beta'])
  })

  it('returns every repo, scored, so the caller can still list the rest', () => {
    const repos = [repo('a/one'), repo('a/two'), repo('a/three')]
    expect(rankRepos('one', repos)).toHaveLength(3)
  })
})

describe('suggestRepos', () => {
  it('promotes the obvious match and caps at topN', () => {
    const repos = [
      repo('acme/marketing-site'),
      repo('acme/daily-cart'),
      repo('acme/dailycart-worker'),
      repo('acme/dailycart-admin'),
      repo('acme/unrelated'),
    ]
    const out = suggestRepos('DailyCart prod', repos)
    expect(out).toHaveLength(3)
    expect(out[0].fullName).toBe('acme/daily-cart')
    expect(out.map((r) => r.fullName)).not.toContain('acme/unrelated')
  })

  it('suggests nothing rather than guessing when no repo is close', () => {
    expect(suggestRepos('warehouse', [repo('acme/marketing-site'), repo('acme/blog')])).toEqual([])
  })

  it('suggests nothing for an empty source name', () => {
    expect(suggestRepos('   ', [repo('acme/anything')])).toEqual([])
  })

  it('handles an empty repo list', () => {
    expect(suggestRepos('anything', [])).toEqual([])
  })
})
