import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      aria-orientation={orientation}
      className={cn("ui-separator", `ui-separator-${orientation}`, className)}
      role="separator"
      {...props}
    />
  );
}
