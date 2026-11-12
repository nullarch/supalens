-- A1 (security): increment_org_usage is SECURITY DEFINER (bypasses RLS + the billing guard) and
-- is only ever invoked by the service-role client. Revoke the accidental `authenticated` grant so a
-- user JWT can't inflate/corrupt an arbitrary org's usage counter via a direct PostgREST rpc call.
revoke execute on function public.increment_org_usage(uuid, integer, bigint) from authenticated;

-- A3 (billing ordering): per-org watermark to drop out-of-order Paddle events (a retried older
-- subscription.updated must not resurrect a canceled plan or rewind the metered usage window).
alter table organizations add column billing_event_at timestamptz;
