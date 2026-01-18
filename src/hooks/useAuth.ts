import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { withTimeout, isAbortError } from "@/ui/data/async";

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
  const [isProfileCreating, setIsProfileCreating] = useState(false);
  const [lastAuthError, setLastAuthError] = useState<{ message: string; status: number | null } | null>(null);
  const isMountedRef = useRef(true);

  const logAuthError = (error: { message?: string; code?: string; details?: string; hint?: string; status?: number } | null) => {
    if (!error) return;
    setLastAuthError({ message: error.message ?? "Unknown error", status: error.status ?? null });
    console.error("[auth] supabase error", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      status: error.status,
    });
  };

  useEffect(() => {
    console.info("[auth] log", { step: "auth_bootstrap_start" });
    const loadSession = async () => {
      try {
        // Get initial session
        const { data: { session }, error } = await withTimeout(supabase.auth.getSession(), 20000);
        if (error) logAuthError(error);
        if (!isMountedRef.current) return;
        setUser(session?.user ?? null);
        console.info("[auth] log", {
          step: "auth_bootstrap_end",
          hasSession: Boolean(session),
          userId: session?.user?.id ?? null,
        });
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setIsLoading(false);
        }
      } catch (error) {
        if (isAbortError(error)) {
          if (isMountedRef.current) {
            setIsLoading(false);
          }
          return;
        }
        logAuthError(error as { message?: string; code?: string; details?: string; hint?: string; status?: number });
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    loadSession();

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

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        20000,
      );

      if (error) {
        if (isAbortError(error)) {
          return;
        }
        logAuthError(error);
      }
      if (data) {
        if (isMountedRef.current) {
          setProfile(data);
        }
        return;
      }

      if (isMountedRef.current) {
        setIsProfileCreating(true);
      }

      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData.user;
      const displayName =
        currentUser?.user_metadata?.display_name
        ?? currentUser?.email?.split("@")[0]
        ?? "Adventurer";

      const createResult = await withTimeout(
        supabase
          .from("profiles")
          .insert({
            user_id: userId,
            display_name: displayName,
            avatar_url: null,
          })
          .select("*")
          .single(),
        20000,
      );

      if (createResult.error) {
        if (!isAbortError(createResult.error)) {
          logAuthError(createResult.error);
        }
      } else if (isMountedRef.current) {
        setProfile(createResult.data);
      }
    } finally {
      if (isMountedRef.current) {
        setIsProfileCreating(false);
        setIsLoading(false);
      }
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
    isProfileCreating,
    lastAuthError,
    signUp,
    signIn,
    signOut,
    updateProfile,
  };
}
