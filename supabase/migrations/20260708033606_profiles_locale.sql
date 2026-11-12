-- i18n Phase 3: per-user stored locale.
--
-- Emails and other recipient-context notifications are produced OUTSIDE a request
-- (Trigger.dev cron host has no NEXT_LOCALE cookie), so the recipient's locale must be
-- STORED. `profiles.locale` is the source of truth for those paths. NULL = unset →
-- callers fall back to the app default ('en'). The app LanguageSwitcher persists the
-- choice here via the existing `prof_upd` self-update policy (id = auth.uid()); no new
-- policy or guard trigger is needed.

alter table public.profiles
  add column if not exists locale text
  check (locale is null or locale in ('en', 'ko', 'ja'));

comment on column public.profiles.locale is
  'User UI/notification locale (en|ko|ja). NULL = unset → default (en). Set by the in-app language switcher; read by cron/email paths that have no request context.';
