import { redirect } from 'next/navigation'

// MCP moved under Settings → Developer (it is a developer setting, not a top-level product
// surface). Kept as a redirect so bookmarks, docs and email links keep working.
export default function McpRedirect() {
  redirect('/app/settings/developer')
}
