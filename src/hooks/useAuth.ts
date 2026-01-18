import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { withTimeout, isAbortError } from "@/ui/data/async";
import { recordProfilesRead } from "@/ui/data/networkHealth";

const DEV_DEBUG = import.meta.env.DEV;
const PROFILE_TTL_MS = 60000;
const profileCache = new Map<string, { data: Profile | null; fetchedAt: number }>();
const profileInFlight = new Map<string, Promise<Profile | null>>();

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isProfileCreating: boolean;
  lastAuthError: { message: string; status: number | null } | null;
}

let authState: AuthState = {
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  isProfileCreating: false,
  lastAuthError: null,
};

const listeners = new Set<(state: AuthState) => void>();
let authInitialized = false;
let authInitPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

const setAuthState = (partial: Partial<AuthState>) => {
  authState = { ...authState, ...partial };
  listeners.forEach(listener => listener(authState));
};

const notifyAuthError = (error: { message?: string; status?: number }) => {
  if (!error) return;
  setAuthState({
    lastAuthError: { message: error.message ?? "Unknown error", status: error.status ?? null },
  });
};

const ensureAuthSubscription = () => {
  if (authSubscription) return;
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (_event, session) => {
      setAuthState({ session: session ?? null, user: session?.user ?? null });
      if (session?.user) {
        await fetchProfileInternal(session.user.id);
      } else {
        setAuthState({ profile: null, isLoading: false, isProfileCreating: false });
      }
    }
  );
  authSubscription = subscription;
};

const fetchProfileInternal = async (userId: string) => {
  try {
    const cached = profileCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < PROFILE_TTL_MS) {
      setAuthState({ profile: cached.data, isLoading: false });
      return;
    }

    const inFlight = profileInFlight.get(userId);
    if (inFlight) {
      const data = await inFlight;
      setAuthState({ profile: data, isLoading: false });
      return;
    }

    const loadPromise = (async () => {
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
          return null;
        }
        notifyAuthError(error);
        return null;
      }
      recordProfilesRead();
      if (data) {
        profileCache.set(userId, { data, fetchedAt: Date.now() });
      }
      return data ?? null;
    })();

    profileInFlight.set(userId, loadPromise);
    const profileData = await loadPromise;
    profileInFlight.delete(userId);

    if (profileData) {
      setAuthState({ profile: profileData, isLoading: false });
      return;
    }

    setAuthState({ isProfileCreating: true });

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
        notifyAuthError(createResult.error);
      }
    } else {
      profileCache.set(userId, { data: createResult.data, fetchedAt: Date.now() });
      setAuthState({ profile: createResult.data });
    }
  } finally {
    setAuthState({ isProfileCreating: false, isLoading: false });
  }
};

const initAuth = async () => {
  if (authInitialized) return;
  if (authInitPromise) return authInitPromise;
  authInitPromise = (async () => {
    console.info("[auth] log", { step: "auth_bootstrap_start" });
    try {
      const { data: { session }, error } = await withTimeout(supabase.auth.getSession(), 20000);
      if (error) {
        notifyAuthError(error);
      }
      setAuthState({ session: session ?? null, user: session?.user ?? null });
      if (session?.user) {
        await fetchProfileInternal(session.user.id);
      } else {
        setAuthState({ isLoading: false });
      }
      console.info("[auth] log", {
        step: "auth_bootstrap_end",
        hasSession: Boolean(session),
        userId: session?.user?.id ?? null,
      });
    } catch (error) {
      if (isAbortError(error)) {
        setAuthState({ isLoading: false });
        return;
      }
      notifyAuthError(error as { message?: string; status?: number });
      setAuthState({ isLoading: false });
    } finally {
      authInitialized = true;
    }
  })();
  return authInitPromise;
};

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(authState);
  const isMountedRef = useRef(true);

  const logAuthError = (error: { message?: string; code?: string; details?: string; hint?: string; status?: number } | null) => {
    if (!error) return;
    notifyAuthError(error);
    console.error("[auth] supabase error", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      status: error.status,
    });
  };

  useEffect(() => {
    const handleUpdate = (next: AuthState) => {
    if (isMountedRef.current) {
      setState(next);
    }
    };

    listeners.add(handleUpdate);
    ensureAuthSubscription();
    void initAuth();

    return () => {
      isMountedRef.current = false;
      listeners.delete(handleUpdate);
    };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!state.user) throw new Error("Not authenticated");

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("user_id", state.user.id);

    if (error) throw error;
    await fetchProfileInternal(state.user.id);
  };

  return {
    session: state.session,
    user: state.user,
    profile: state.profile,
    isLoading: state.isLoading,
    isProfileCreating: state.isProfileCreating,
    lastAuthError: state.lastAuthError,
    signOut,
    updateProfile,
  };
}
