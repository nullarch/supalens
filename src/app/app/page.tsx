import { redirect } from 'next/navigation'

// /app lands on the operational home — what Supalens is watching right now. Ask is a
// secondary surface reached from the rail (or the overview's quick-ask box).
export default function AppHome() {
  redirect('/app/overview')
}
