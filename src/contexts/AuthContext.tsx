import type { ReactNode } from "react";
import { AuthProvider as InternalAuthProvider } from "@/hooks/useAuth";

export function AuthProvider({ children }: { children: ReactNode }) {
  return <InternalAuthProvider>{children}</InternalAuthProvider>;
}
