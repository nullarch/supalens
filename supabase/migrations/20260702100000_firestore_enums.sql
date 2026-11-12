-- Firestore connector — enum values (first *document* / non-SQL connector).
-- See docs/firestore-connector-plan.md §5 and docs/db-schema.md §7 (new-connector extension).
--
-- These ALTER TYPE ... ADD VALUE statements live in their OWN migration, separate from the
-- CHECK-constraint change that USES 'gcp_service_account' (…_firestore_secret_check.sql),
-- because a newly added enum value cannot be used in the same transaction that added it
-- (docs/db-schema.md §8). The next migration runs after this one commits.
--
-- `engine` is used purely as the driver-dispatch key: firestore's read path is the document
-- driver (src/lib/firestore/*), NOT the pg/mysql SQL path (src/lib/query/*).

alter type ds_engine   add value if not exists 'firestore';   -- driver-dispatch key (document)
alter type ds_provider add value if not exists 'firebase';    -- brand
alter type secret_kind add value if not exists 'gcp_service_account';  -- service-account JSON (reversible)
