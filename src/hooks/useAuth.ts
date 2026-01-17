import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const DEV_DEBUG = import.meta.env.DEV;

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logSupabaseError = (context: string, error: { message?: string; code?: string; details?: string; hint?: string; status?: number } | null) => {
    if (!error) return;
    console.error(context, {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      status: error.status,
    });
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        logSupabaseError("[auth] supabase error", error);
      }
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
          setIsLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        if ((error as { name?: string })?.name === "AbortError") {
          return;
        }
        logSupabaseError("[auth] supabase error", error);
      }
      setProfile(data);
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split("@")[0] },
      },
    });
    if (DEV_DEBUG) {
      console.info("DEV_DEBUG auth signUp", {
        email,
        userId: data.user?.id ?? null,
        error: error?.message ?? null,
      });
    }
    if (error) throw error;
    return data;
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (DEV_DEBUG) {
      console.info("DEV_DEBUG auth signIn", {
        email,
        userId: data.user?.id ?? null,
        error: error?.message ?? null,
      });
    }
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) throw new Error("Not authenticated");

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("user_id", user.id);

    if (error) throw error;
    await fetchProfile(user.id);
  };

  return {
    user,
    profile,
    isLoading,
    signUp,
    signIn,
    signOut,
    updateProfile,
  };
}
