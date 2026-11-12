import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'

import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createClient()
  if (supabase) await supabase.auth.signOut()
  // 303 → browser issues a GET to the marketing landing
  return NextResponse.redirect(new URL('/', requestBase(req)), { status: 303 })
}
