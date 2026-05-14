import type { WorkspaceMember } from "@paperclipai/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const SIZE_CLASS: Record<string, string> = {
  xs: "size-5 text-[10px]",
  sm: "size-6 text-xs",
  md: "size-8 text-sm",
  lg: "size-10 text-base",
};

function looksLikeUrl(value: string | undefined): boolean {
  if (!value) return false;
  return value.startsWith("http") || value.startsWith("/");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export interface MemberAvatarProps {
  member?: Pick<WorkspaceMember, "displayName" | "avatar" | "type"> | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  fallback?: string;
}

export function MemberAvatar({
  member,
  size = "md",
  className,
  fallback,
}: MemberAvatarProps) {
  const sizeClass = SIZE_CLASS[size] ?? SIZE_CLASS.md;
  const name = member?.displayName ?? fallback ?? "?";
  const avatar = member?.avatar;
  const isUrl = looksLikeUrl(avatar);
  const isAgent = member?.type === "agent";

  return (
    <Avatar
      className={cn(
        sizeClass,
        isAgent && "ring-1 ring-primary/40",
        className,
      )}
    >
      {isUrl ? <AvatarImage src={avatar} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          "select-none font-medium",
          isAgent && "bg-primary/10 text-primary",
        )}
      >
        {avatar && !isUrl ? avatar : initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
