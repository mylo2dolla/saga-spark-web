import type { ReactNode } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";

interface BoardCardDetailSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function BoardCardDetailSurface(props: BoardCardDetailSurfaceProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={props.onOpenChange}>
        <DrawerTrigger asChild>{props.trigger}</DrawerTrigger>
        <DrawerContent className="border border-amber-200/20 bg-[linear-gradient(180deg,rgba(18,14,10,0.96),rgba(8,10,16,0.98))] text-amber-50">
          <DrawerHeader>
            <DrawerTitle className="font-display text-amber-100">{props.title}</DrawerTitle>
            {props.subtitle ? <DrawerDescription className="text-amber-100/70">{props.subtitle}</DrawerDescription> : null}
          </DrawerHeader>
          <div className="max-h-[68vh] overflow-auto px-4 pb-4">
            {props.children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-2rem)] border border-amber-200/25 bg-[linear-gradient(180deg,rgba(18,14,10,0.96),rgba(8,10,16,0.98))] p-0 text-amber-50"
      >
        <div className="border-b border-amber-200/20 px-3 py-2">
          <div className="font-display text-base text-amber-100">{props.title}</div>
          {props.subtitle ? <div className="text-xs text-amber-100/70">{props.subtitle}</div> : null}
        </div>
        <div className="max-h-[420px] overflow-auto p-3">
          {props.children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
