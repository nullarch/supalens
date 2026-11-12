'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect } from 'react';
import { createClient } from './client';
import { SupabaseClient } from '@supabase/supabase-js';
import { track, identify } from '@/utils/analytics';

const Context = createContext<SupabaseClient | null>(null);

export default function SupabaseProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    if (!supabase) return;

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        const user = session?.user;
        if (user?.id) identify(user.id, user.email ? { email: user.email } : undefined);
        track('signed_in');
        router.refresh();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  return <Context.Provider value={supabase}>{children}</Context.Provider>;
}

export const useSupabase = () => {
  const context = useContext(Context);
  return context;
};

export const useSupabaseRequired = () => {
  const context = useContext(Context);

  if (context === null) {
    throw new Error('Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.');
  }

  return context;
};