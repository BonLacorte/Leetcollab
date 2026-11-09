import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type, ...props },
  ref,
) {
  return <input className={cn("ui-input", className)} ref={ref} type={type} {...props} />;
});
