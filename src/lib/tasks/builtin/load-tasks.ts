// Imports every task a self-hosted install runs, so each registers with the built-in backend.
// ./trigger/cloud (hosted-service tasks) is deliberately absent. Keep this list in step with the
// files in ./trigger — src/lib/tasks/builtin/builtin.test.ts fails when one is missing.
import '../../../../trigger/analyze'
import '../../../../trigger/analyze-code'
import '../../../../trigger/analyze-firestore'
import '../../../../trigger/bootstrap-business'
import '../../../../trigger/bootstrap-supabase-projects'
import '../../../../trigger/evaluate-alerts'
import '../../../../trigger/explain-alert'
import '../../../../trigger/extract-kpis'
import '../../../../trigger/generate-context'
import '../../../../trigger/maintenance'
import '../../../../trigger/messenger-answer'
import '../../../../trigger/process-revocations'
import '../../../../trigger/weekly-digest'
