import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { recordProfilesRead } from "@/ui/data/networkHealth";

const DEV_DEBUG = import.meta.env.DEV;
const AUTH_DEBUG = DEV_DEBUG && import.meta.env.VITE_DEBUG_AUTH === "true";
const E2E_BYPASS_AUTH = DEV_DEBUG && import.meta.env.VITE_E2E_BYPASS_AUTH === "true";
const PROFILE_TTL_MS = 60000;
const AUTH_TIMEOUT_MS = 20000;
const AUTH_FAILSAFE_MS = 30000;
const profileCache = new Map<string, { data: Profile | null; fetchedAt: number }>();
const profileInFlight = new Map<string, Promise<Profile | null>>();

const isProfileFetchTimeout = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("profile fetch timed out");
};

const isSessionFetchTimeout = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("auth session fetch timed out");
};

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isProfileCreating: boolean;
  lastAuthError: { message: string; status: number | null } | null;
}

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
}

const initialState: AuthState = {
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  isProfileCreating: false,
  lastAuthError: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

const logAuthDebug = (payload: Record<string, unknown>) => {
  if (!AUTH_DEBUG) return;
  console.debug("[auth] log", payload);
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const updateState = useCallback((partial: Partial<AuthState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  const notifyAuthError = useCallback((error: { message?: string; status?: number } | null) => {
    if (!error) return;
    updateState({
      lastAuthError: { message: error.message ?? "Unknown error", status: error.status ?? null },
    });
  }, [updateState]);

  const fetchProfileInternal = useCallback(async (userId: string) => {
    logAuthDebug({ step: "profile_fetch_start", userId });
    try {
      const cached = profileCache.get(userId);
      const now = Date.now();
      if (cached && now - cached.fetchedAt < PROFILE_TTL_MS) {
        updateState({ profile: cached.data, isLoading: false });
        return;
      }

      const inFlight = profileInFlight.get(userId);
      if (inFlight) {
        const data = await inFlight;
        updateState({ profile: data, isLoading: false });
        return;
      }

      const loadPromise = (async () => {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (error) {
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
        updateState({ profile: profileData, isLoading: false });
        return;
      }

      updateState({ isProfileCreating: true });

      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData.user;
      const displayName =
        currentUser?.user_metadata?.display_name
        ?? currentUser?.email?.split("@")[0]
        ?? "Adventurer";

      const createResult = await supabase
        .from("profiles")
        .insert({
          user_id: userId,
          display_name: displayName,
          avatar_url: null,
        })
        .select("*")
        .single();

      if (createResult.error) {
        notifyAuthError(createResult.error);
      } else {
        profileCache.set(userId, { data: createResult.data, fetchedAt: Date.now() });
        updateState({ profile: createResult.data });
      }
    } finally {
      logAuthDebug({ step: "profile_fetch_end", userId });
      updateState({ isProfileCreating: false, isLoading: false });
    }
  }, [notifyAuthError, updateState]);

  useEffect(() => {
    let isActive = true;
    const failsafeId = setTimeout(() => {
      if (!isActive) return;
      updateState({ isLoading: false, isProfileCreating: false });
      notifyAuthError({ message: "Auth bootstrap timed out", status: null });
    }, AUTH_FAILSAFE_MS);

    if (E2E_BYPASS_AUTH) {
      const fakeUser = {
        id: "e2e-user",
        email: "e2e@example.com",
      } as User;
      setState({
        session: { user: fakeUser } as Session,
        user: fakeUser,
        profile: {
          id: "e2e-profile",
          user_id: "e2e-user",
          display_name: "E2E Tester",
          avatar_url: null,
        },
        isLoading: false,
        isProfileCreating: false,
        lastAuthError: null,
      });
      clearTimeout(failsafeId);
      return () => {
        isActive = false;
      };
    }

    if (DEV_DEBUG) {
      console.count("[auth] init");
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isActive) return;
        updateState({ session: session ?? null, user: session?.user ?? null });
        if (session?.user) {
          try {
            await withTimeout(fetchProfileInternal(session.user.id), AUTH_TIMEOUT_MS, "Profile fetch");
          } catch (error) {
            if (!isProfileFetchTimeout(error)) {
              notifyAuthError(error as { message?: string; status?: number });
            }
            updateState({ isLoading: false, isProfileCreating: false });
          }
        } else {
          updateState({ profile: null, isProfileCreating: false, isLoading: false });
        }
      }
    );

    const bootstrap = async () => {
      if (DEV_DEBUG) {
        console.count("[auth] getSession");
      }
      try {
        const { data: { session }, error } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          "Auth session fetch"
        );
        if (!isActive) return;
        if (error) {
          notifyAuthError(error);
        }
        updateState({ session: session ?? null, user: session?.user ?? null });
        if (session?.user) {
          await withTimeout(fetchProfileInternal(session.user.id), AUTH_TIMEOUT_MS, "Profile fetch");
        } else {
          updateState({ profile: null });
        }
      } catch (error) {
        if (isActive) {
          if (!isProfileFetchTimeout(error) && !isSessionFetchTimeout(error)) {
            notifyAuthError(error as { message?: string; status?: number });
          }
        }
      } finally {
        if (isActive) {
          updateState({ isLoading: false });
        }
        clearTimeout(failsafeId);
      }
    };

    void bootstrap();

    return () => {
      isActive = false;
      clearTimeout(failsafeId);
      subscription?.unsubscribe();
    };
  }, [fetchProfileInternal, notifyAuthError, updateState]);

  const signOut = useCallback(async () => {
    if (E2E_BYPASS_AUTH) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const updateProfile = useCallback(async (updates: Partial<Profile>) => {
    if (E2E_BYPASS_AUTH) return;
    if (!state.user) throw new Error("Not authenticated");

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("user_id", state.user.id);

    if (error) throw error;
    await fetchProfileInternal(state.user.id);
  }, [fetchProfileInternal, state.user]);

  const value = useMemo(() => ({
    session: state.session,
    user: state.user,
    profile: state.profile,
    isLoading: state.isLoading,
    isProfileCreating: state.isProfileCreating,
    lastAuthError: state.lastAuthError,
    signOut,
    updateProfile,
  }), [signOut, state.isLoading, state.isProfileCreating, state.lastAuthError, state.profile, state.session, state.user, updateProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
