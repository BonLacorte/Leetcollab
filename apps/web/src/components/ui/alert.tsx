import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type AlertVariant = "default" | "destructive" | "success";

export const Alert = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }>(function Alert(
  { className, variant = "default", role = "status", ...props },
  ref,
) {
  return <div className={cn("ui-alert", `ui-alert-${variant}`, className)} ref={ref} role={role} {...props} />;
});

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function AlertTitle(
  { className, ...props },
  ref,
) {
  return <h5 className={cn("ui-alert-title", className)} ref={ref} {...props} />;
});

export const AlertDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function AlertDescription(
  { className, ...props },
  ref,
) {
  return <div className={cn("ui-alert-description", className)} ref={ref} {...props} />;
});
