// Server-side client for the company event hub. Copy this file into a service; it has no dependencies.
// Never put the key in browser or app code. Send from your server after the business change has committed.

export interface HubEvent {
  /** Stable for this occurrence, for example `purchase:<order id>`. A retry must reuse it. */
  eventId: string;
  /** lowercase_snake_case. Shared names: signup, activation, purchase, subscription_payment, refund. */
  name: string;
  /** ISO 8601 with a timezone. */
  occurredAt: string;
  /** Your internal user ID. Do not use an email address. */
  userRef?: string;
  anonymousId?: string;
  value?: number;
  currency?: string;
  /** First-party attribution such as utm_source or ca_variant. */
  attribution?: Record<string, string>;
  /** Flat, non-personal values only. Personal fields such as email are refused. */
  props?: Record<string, string | number | boolean | null>;
  /** The only place for personal data. Stored apart from events and removed by forgetPerson. */
  person?: { email?: string; name?: string };
}

export interface HubClientOptions {
  /** Defaults to STREAMIZE_EVENTS_URL. */
  url?: string;
  /** Defaults to STREAMIZE_EVENTS_KEY. */
  key?: string;
  timeoutMs?: number;
}

/** `retry` tells an outbox whether to try again with the same event IDs. A 4xx other than 429 needs a fix, not a retry. */
export class HubError extends Error {
  constructor(message: string, readonly status: number, readonly retry: boolean) {
    super(message);
    this.name = 'HubError';
  }
}

export function createHubClient(options: HubClientOptions = {}) {
  const url = (options.url ?? process.env.STREAMIZE_EVENTS_URL ?? '').replace(/\/$/, '');
  const key = options.key ?? process.env.STREAMIZE_EVENTS_KEY ?? '';
  const timeoutMs = options.timeoutMs ?? 10000;

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!url || !key) throw new HubError('Configure STREAMIZE_EVENTS_URL and STREAMIZE_EVENTS_KEY', 0, false);
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new HubError(error instanceof Error ? error.message : 'Network error', 0, true);
    }
    if (response.ok) return response.json();
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new HubError(detail.error ?? `HTTP ${response.status}`, response.status, response.status === 429 || response.status >= 500);
  }

  return {
    /** At most 100 events and 128 KB per call. Replaying the same events is safe and counts as duplicates. */
    send: (events: HubEvent[]) => call('POST', '/v1/events', { events }) as Promise<{ accepted: number; duplicates: number }>,
    /** Call when a user deletes their account. */
    forgetPerson: (userRef: string) => call('DELETE', `/v1/people/${encodeURIComponent(userRef)}`) as Promise<{ peopleRemoved: number; eventsAnonymized: number }>,
  };
}
