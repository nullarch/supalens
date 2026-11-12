-- =====================================================================
-- Paddle billing: plan tier enum.
-- Kept in its OWN migration (matches the project convention for enum
-- changes, e.g. the firestore enum split) so later migrations can use it
-- as a column type/default in a separate transaction.
-- See docs/paddle-billing-plan.md.
-- =====================================================================
create type plan_tier as enum ('free', 'basic', 'standard', 'premium');
