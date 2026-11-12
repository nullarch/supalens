import { vi } from 'vitest'

/** A read-only thenable query recorder; it never imports or connects to a database. */
export function localClient(rows: Record<string, unknown[]> = {}, signedIn = true) {
  const calls: unknown[][] = []
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: 'user-a' } : null } })) },
    from: vi.fn((table: string) => {
      const response = Promise.resolve({ data: rows[table] ?? [], error: null })
      const record = (method: string, args: unknown[]) => { calls.push([table, method, ...args]); return query }
      const query = {
        then: response.then.bind(response),
        select: (...args: unknown[]) => record('select', args),
        eq: (...args: unknown[]) => record('eq', args),
        is: (...args: unknown[]) => record('is', args),
        in: (...args: unknown[]) => record('in', args),
        order: (...args: unknown[]) => record('order', args),
        limit: (...args: unknown[]) => record('limit', args),
      }
      return query
    }),
  }
  return { client, calls }
}

export const navigation = {
  redirect: (url: string): never => { throw new Error(`REDIRECT:${url}`) },
  notFound: (): never => { throw new Error('NOT_FOUND') },
}
export const translations = { getTranslations: async () => (key: string) => key, getLocale: async () => 'en' }
export const common = { 'next/navigation': navigation, 'next-intl/server': translations }
export type RouteElement = { type: unknown; props: Record<string, unknown>; key: string | null }

export function elements(node: unknown, type: string): RouteElement[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type))
  if (node === null || typeof node !== 'object' || !('props' in node)) return []
  const element = node as RouteElement
  return [...(element.type === type ? [element] : []), ...elements(element.props.children, type)]
}

export function oneElement(node: unknown, type: string): RouteElement {
  const matches = elements(node, type)
  if (matches.length !== 1) throw new Error(`Expected one ${type}; received ${matches.length}`)
  return matches[0]
}
