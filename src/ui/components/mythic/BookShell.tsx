import type { ReactNode } from "react";

interface BookShellProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  leftPage: ReactNode;
  rightPage: ReactNode;
}

export function BookShell(props: BookShellProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(250,204,21,0.08),transparent_35%),radial-gradient(circle_at_80%_90%,rgba(56,189,248,0.08),transparent_40%),linear-gradient(180deg,#06070c,#05060a)] px-2 py-3 sm:px-4 sm:py-4">
      <div className="mx-auto flex h-[calc(100vh-1.5rem)] max-w-[1760px] flex-col overflow-hidden rounded-2xl border border-amber-200/20 bg-[linear-gradient(180deg,rgba(26,17,8,0.88),rgba(9,10,18,0.96))] shadow-[0_20px_90px_rgba(0,0,0,0.5)] sm:h-[calc(100vh-2rem)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-200/15 px-4 py-3">
          <div>
            <div className="font-display text-2xl tracking-wide text-amber-100">{props.title}</div>
            {props.subtitle ? <div className="text-xs text-amber-100/75">{props.subtitle}</div> : null}
          </div>
          {props.actions ? <div className="flex flex-wrap gap-2">{props.actions}</div> : null}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
          <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(45deg,rgba(255,255,255,0.03)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.03)_50%,rgba(255,255,255,0.03)_75%,transparent_75%,transparent)] [background-size:6px_6px]" />
          <div className="grid h-full min-h-0 gap-3 xl:grid-cols-2">
            <section className="relative min-h-0 overflow-hidden rounded-xl border border-amber-200/20 bg-[linear-gradient(180deg,rgba(17,14,10,0.88),rgba(8,10,16,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.06),transparent_45%),linear-gradient(90deg,rgba(0,0,0,0.18),transparent_18%)]" />
              {props.leftPage}
            </section>
            <section className="relative min-h-0 overflow-hidden rounded-xl border border-amber-200/20 bg-[linear-gradient(180deg,rgba(17,14,10,0.88),rgba(8,10,16,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_75%_20%,rgba(255,255,255,0.06),transparent_45%),linear-gradient(270deg,rgba(0,0,0,0.18),transparent_18%)]" />
              {props.rightPage}
            </section>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-1/2 top-3 hidden w-10 -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,rgba(245,158,11,0.08),rgba(0,0,0,0.35),rgba(245,158,11,0.08))] blur-[1px] xl:block" />
        </div>
      </div>
    </div>
  );
}
