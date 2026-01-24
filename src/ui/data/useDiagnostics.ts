import { useContext } from "react";
import { DiagnosticsContext } from "@/ui/data/diagnosticsContext";

export function useDiagnostics() {
  const ctx = useContext(DiagnosticsContext);
  if (!ctx) {
    throw new Error("useDiagnostics must be used within DiagnosticsProvider");
  }
  return ctx;
}
