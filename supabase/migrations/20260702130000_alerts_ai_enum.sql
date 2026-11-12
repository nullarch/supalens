-- AI-native alerts, part 1/2: add the 'anomaly' alert type. A new enum value can't be USED in the
-- same transaction it's added, so the columns that reference the anomaly path land in the next file
-- (same split pattern as the Firestore enum migrations 20260702100*).
alter type alert_type add value if not exists 'anomaly';
