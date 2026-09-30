import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function validateJSON(value: string, { allowEmpty = true } = {}): string | null {
  const trimmed = value.trim();
  if (!trimmed) return allowEmpty ? null : "This field cannot be empty";
  try {
    JSON.parse(trimmed);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON";
  }
}

export function formatJSONString(value: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(value), null, indent);
  } catch {
    return value;
  }
}

const JSON_CLS = {
  key: "text-sky-600 dark:text-sky-300",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  literal: "text-violet-600 dark:text-violet-400",
  punct: "text-muted-foreground",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders JSON to highlighted HTML (keys, strings, numbers, literals). */
export function highlightJson(input: string): string {
  const out: string[] = [];
  const n = input.length;
  let i = 0;
  const push = (text: string, cls: string) => {
    out.push(cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text));
  };

  while (i < n) {
    const c = input[i];

    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (input[j] === "\\") {
          j += 2;
          continue;
        }
        if (input[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      let k = j;
      while (k < n && /\s/.test(input[k])) k++;
      push(input.slice(i, j), input[k] === ":" ? JSON_CLS.key : JSON_CLS.string);
      i = j;
      continue;
    }

    if ((c >= "0" && c <= "9") || (c === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(input[j])) j++;
      push(input.slice(i, j), JSON_CLS.number);
      i = j;
      continue;
    }

    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z]/.test(input[j])) j++;
      push(input.slice(i, j), JSON_CLS.literal);
      i = j;
      continue;
    }

    if ("{}[],:".includes(c)) {
      push(c, JSON_CLS.punct);
      i++;
      continue;
    }

    let j = i;
    while (j < n && !/["\dA-Za-z{}[\],:-]/.test(input[j])) j++;
    push(input.slice(i, j), "");
    i = j;
  }
  return out.join("");
}

interface Props extends Omit<React.ComponentProps<"textarea">, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  showError?: boolean;
}

/**
 * A JSON textarea with syntax highlighting: a transparent <textarea> sits over
 * a highlighted <pre> and their scroll positions are kept in sync.
 */
export function JsonEditor({ value, onChange, allowEmpty = true, showError = true, className, ...props }: Props) {
  const error = validateJSON(value, { allowEmpty });
  const preRef = React.useRef<HTMLPreElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const syncScroll = React.useCallback(() => {
    const pre = preRef.current;
    const textarea = textareaRef.current;
    if (!pre || !textarea) return;
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }, []);

  const html = React.useMemo(() => highlightJson(value) + "\n", [value]);

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "relative min-h-[7rem] overflow-hidden rounded-md border shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring",
          error && "border-destructive focus-within:ring-destructive"
        )}
      >
        <pre
          ref={preRef}
          aria-hidden="true"
          className="scrollbar-thin pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre p-3 font-mono text-xs leading-relaxed"
        >
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <Textarea
          ref={textareaRef}
          spellCheck={false}
          autoComplete="off"
          wrap="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          className={cn(
            "scrollbar-thin relative block resize-y overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-relaxed text-transparent outline-none focus-visible:ring-0",
            className
          )}
          {...props}
        />
      </div>
      {showError && error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
