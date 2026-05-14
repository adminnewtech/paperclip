import type { ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface WorkspaceLayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  right?: ReactNode;
  rightOpen?: boolean;
  dir?: "ltr" | "rtl";
  mobileLeftOpen?: boolean;
  onMobileLeftOpenChange?: (open: boolean) => void;
  mobileRightOpen?: boolean;
  onMobileRightOpenChange?: (open: boolean) => void;
}

export function WorkspaceLayout({
  header,
  sidebar,
  main,
  right,
  rightOpen = false,
  dir = "ltr",
  mobileLeftOpen = false,
  onMobileLeftOpenChange,
  mobileRightOpen = false,
  onMobileRightOpenChange,
}: WorkspaceLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-3rem)] w-full flex-col" dir={dir}>
      <div className="shrink-0">{header}</div>
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop left sidebar */}
        <aside className="hidden w-60 shrink-0 border-e border-border lg:block">
          {sidebar}
        </aside>

        {/* Mobile left sheet */}
        <Sheet open={mobileLeftOpen} onOpenChange={onMobileLeftOpenChange}>
          <SheetContent
            side={dir === "rtl" ? "right" : "left"}
            className="w-72 p-0"
          >
            {sidebar}
          </SheetContent>
        </Sheet>

        <main className="flex min-w-0 flex-1 flex-col">{main}</main>

        {right && rightOpen ? (
          <aside
            className={cn(
              "hidden w-60 shrink-0 border-s border-border lg:block",
            )}
          >
            {right}
          </aside>
        ) : null}

        {/* Mobile right sheet */}
        {right ? (
          <Sheet open={mobileRightOpen} onOpenChange={onMobileRightOpenChange}>
            <SheetContent
              side={dir === "rtl" ? "left" : "right"}
              className="w-72 p-0"
            >
              {right}
            </SheetContent>
          </Sheet>
        ) : null}
      </div>
    </div>
  );
}
