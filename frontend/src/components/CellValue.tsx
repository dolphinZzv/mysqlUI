import { cn } from "@/lib/utils";

export function CellValue({
  value,
  className,
  truncate = true,
}: {
  value: unknown;
  className?: string;
  truncate?: boolean;
}) {
  if (value === null || value === undefined) {
    return <span className={cn("select-none italic text-muted-foreground/50", className)}>NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span className={className}>{value ? "true" : "false"}</span>;
  }
  const text = String(value);
  if (truncate) {
    return (
      <span className={cn("block truncate", className)} title={text}>
        {text}
      </span>
    );
  }
  return <span className={cn("whitespace-pre-wrap break-words", className)}>{text}</span>;
}

export function isNumericValue(value: unknown): boolean {
  return typeof value === "number";
}
