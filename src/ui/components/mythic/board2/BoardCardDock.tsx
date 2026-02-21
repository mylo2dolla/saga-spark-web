import type { ReactNode } from "react";
import { BoardCardDetailSurface } from "@/ui/components/mythic/board2/BoardCardDetailSurface";
import type { NarrativeDockCardModel, NarrativeTone } from "@/ui/components/mythic/board2/types";

interface BoardCardDockProps {
  cards: NarrativeDockCardModel[];
  openCardId: string | null;
  onOpenCardIdChange: (id: string | null) => void;
  renderDetail: (card: NarrativeDockCardModel) => ReactNode;
}

function toneClass(tone: NarrativeTone | undefined): string {
  if (tone === "good") return "border-emerald-200/40 bg-emerald-300/12 text-emerald-100";
  if (tone === "warn") return "border-amber-200/45 bg-amber-300/14 text-amber-100";
  if (tone === "danger") return "border-red-200/45 bg-red-300/14 text-red-100";
  return "border-amber-200/25 bg-amber-100/8 text-amber-100/85";
}

function PreviewCard(props: { card: NarrativeDockCardModel; open: boolean }) {
  const { card } = props;
  return (
    <button
      type="button"
      className={`h-full w-full rounded-md border px-2.5 py-2 text-left transition hover:border-amber-200/45 hover:bg-amber-200/10 ${toneClass(card.tone)} ${props.open ? "ring-1 ring-amber-300/70" : ""}`.trim()}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide">{card.title}</div>
        {card.badge ? (
          <div className="rounded border border-amber-200/35 bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {card.badge}
          </div>
        ) : null}
      </div>
      <div className="mt-1 space-y-0.5 text-[11px] text-amber-100/80">
        {card.previewLines.length === 0 ? (
          <div>Open for details.</div>
        ) : (
          card.previewLines.slice(0, 3).map((line, index) => (
            <div key={`${card.id}-preview-${index + 1}`} className="truncate">{line}</div>
          ))
        )}
      </div>
    </button>
  );
}

export function BoardCardDock(props: BoardCardDockProps) {
  return (
    <div className="rounded-lg border border-amber-200/25 bg-[linear-gradient(160deg,rgba(22,17,12,0.95),rgba(10,12,18,0.96))] p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-amber-100/70">Quick Cards</div>
        <div className="text-[11px] text-amber-100/60">tap for details</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {props.cards.map((card) => {
          const open = props.openCardId === card.id;
          return (
            <BoardCardDetailSurface
              key={`dock-card-${card.id}`}
              open={open}
              onOpenChange={(nextOpen) => props.onOpenCardIdChange(nextOpen ? card.id : null)}
              title={card.title}
              subtitle={card.previewLines[0]}
              trigger={<PreviewCard card={card} open={open} />}
            >
              {props.renderDetail(card)}
            </BoardCardDetailSurface>
          );
        })}
      </div>
    </div>
  );
}
