"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/utils/supabase/provider";

// Marketing pages are statically rendered (SSG, for SEO) — there's no
// server-known auth state at build time. So this reads the session
// client-side, after hydration, and stays in sync via onAuthStateChange
// (same subscription pattern as SupabaseProvider). The logged-out CTA
// pair is what's server-rendered/prerendered; it flips to the single
// "go to app" CTA once the client resolves a session — a brief flash
// for a signed-in visitor, not a stale-forever bug.
export function useSignedIn(): boolean {
  const supabase = useSupabase();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(!!data.user);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  return signedIn;
}
