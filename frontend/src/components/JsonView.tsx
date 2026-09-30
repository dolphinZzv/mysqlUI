import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { highlightJson } from "@/components/JsonEditor";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  value: unknown;
  className?: string;
  maxHeight?: string;
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Read-only, syntax-highlighted JSON block with a copy button. */
export function JsonView({ value, className, maxHeight = "28rem" }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const text = React.useMemo(() => pretty(value), [value]);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success(t("structure.copied", "Copied"));
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-muted/40", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        className="absolute right-2 top-2 z-10"
        title={t("structure.copy", "Copy")}
      >
        {copied ? <Check className="text-emerald-500" /> : <Copy />}
      </Button>
      <pre
        className="scrollbar-thin overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed"
        style={{ maxHeight }}
      >
        <code dangerouslySetInnerHTML={{ __html: highlightJson(text) }} />
      </pre>
    </div>
  );
}
