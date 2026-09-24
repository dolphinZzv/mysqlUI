import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SqlSchema {
  tables: { name: string; columns: string[] }[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  schema?: SqlSchema;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

const KEYWORDS = [
  "SELECT","FROM","WHERE","INSERT","INTO","VALUES","UPDATE","SET","DELETE","CREATE","ALTER","DROP",
  "TABLE","DATABASE","SCHEMA","INDEX","VIEW","TRIGGER","PROCEDURE","FUNCTION","EVENT","PRIMARY","KEY",
  "FOREIGN","REFERENCES","UNIQUE","NOT","NULL","DEFAULT","AUTO_INCREMENT","INT","BIGINT","SMALLINT",
  "TINYINT","DECIMAL","NUMERIC","FLOAT","DOUBLE","VARCHAR","CHAR","TEXT","BLOB","DATE","DATETIME",
  "TIMESTAMP","TIME","YEAR","JSON","ENUM","BOOLEAN","AND","OR","IN","LIKE","BETWEEN","IS","EXISTS",
  "JOIN","LEFT","RIGHT","INNER","OUTER","CROSS","ON","GROUP","BY","ORDER","ASC","DESC","HAVING",
  "LIMIT","OFFSET","UNION","ALL","DISTINCT","AS","CASE","WHEN","THEN","ELSE","END","COUNT","SUM",
  "AVG","MIN","MAX","COALESCE","IFNULL","CONCAT","NOW","CURDATE","DATE_FORMAT","CAST","CONVERT",
  "WITH","EXPLAIN","SHOW","DESCRIBE","USE","BEGIN","COMMIT","ROLLBACK","TRANSACTION","GRANT","REVOKE",
  "IF","REPLACE","IGNORE","TRUNCATE","RENAME","ADD","COLUMN","CONSTRAINT","CHECK","ENGINE","CHARSET",
];

const KEYWORD_SET = new Set(KEYWORDS);

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

const tokenRe = new RegExp(
  [
    "(\\/\\*[\\s\\S]*?\\*\\/)", // 1 block comment
    "(--[^\\n]*|#[^\\n]*)", // 2 line comment
    "('(?:[^'\\\\]|\\\\.|'')*')", // 3 single quoted
    "(\"(?:[^\"\\\\]|\\\\.|\"\")*\")", // 4 double quoted
    "(`(?:[^`]|``)*`)", // 5 backtick
    "(\\b\\d+(?:\\.\\d+)?\\b)", // 6 number
    "([A-Za-z_][A-Za-z0-9_$]*)", // 7 word
  ].join("|"),
  "g"
);

// highlight renders SQL into HTML with span classes.
export function highlightSQL(sql: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  tokenRe.lastIndex = 0;
  while ((m = tokenRe.exec(sql)) !== null) {
    out += escapeHtml(sql.slice(last, m.index));
    const [full, block, line, sq, dq, bt, num, word] = m;
    if (block || line) {
      out += `<span class="text-muted-foreground/60 italic">${escapeHtml(full)}</span>`;
    } else if (sq) {
      out += `<span class="text-emerald-400">${escapeHtml(full)}</span>`;
    } else if (dq) {
      out += `<span class="text-emerald-400">${escapeHtml(full)}</span>`;
    } else if (bt) {
      out += `<span class="text-amber-400">${escapeHtml(full)}</span>`;
    } else if (num) {
      out += `<span class="text-orange-400">${escapeHtml(full)}</span>`;
    } else if (word && KEYWORD_SET.has(word.toUpperCase())) {
      out += `<span class="text-sky-400 font-medium">${escapeHtml(full)}</span>`;
    } else {
      out += escapeHtml(full);
    }
    last = m.index + full.length;
  }
  out += escapeHtml(sql.slice(last));
  return out + "\n";
}

interface Suggestion {
  label: string;
  kind: "table" | "column" | "keyword";
  detail?: string;
}

export function SqlEditor({ value, onChange, onRun, schema, placeholder, className, minHeight = 180 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [activeWord, setActiveWord] = useState<{ start: number; end: number } | null>(null);

  const lineCount = Math.max(1, value.split("\n").length);

  const tableColumns = useMemo(() => {
    const map = new Map<string, string[]>();
    schema?.tables.forEach((t) => map.set(t.name.toLowerCase(), t.columns));
    return map;
  }, [schema]);

  const allColumns = useMemo(() => {
    const set = new Set<string>();
    schema?.tables.forEach((t) => t.columns.forEach((c) => set.add(c)));
    return Array.from(set);
  }, [schema]);

  const computeCaret = useCallback(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return { top: 0, left: 0 };
    const style = window.getComputedStyle(ta);
    const props = [
      "fontFamily","fontSize","fontWeight","letterSpacing","lineHeight","paddingTop","paddingLeft",
      "paddingRight","paddingBottom","borderTopWidth","borderLeftWidth","whiteSpace","wordBreak",
      "overflowWrap","tabSize",
    ] as const;
    mirror.style.width = `${ta.clientWidth}px`;
    props.forEach((p) => {
      const kebab = p.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      mirror.style.setProperty(kebab, style[p]);
    });
    const caret = ta.selectionStart;
    mirror.textContent = value.slice(0, caret);
    const marker = document.createElement("span");
    marker.textContent = value.slice(caret) || ".";
    mirror.appendChild(marker);
    return {
      top: marker.offsetTop - ta.scrollTop,
      left: marker.offsetLeft - ta.scrollLeft,
    };
  }, [value]);

  const openSuggestions = useCallback(
    (force: boolean) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = ta.selectionStart;
      const before = value.slice(0, caret);
      const wordMatch = /([A-Za-z_][A-Za-z0-9_$]*)$/.exec(before);
      const word = wordMatch ? wordMatch[1] : "";
      const dotMatch = /([A-Za-z_][A-Za-z0-9_$]*)\.$/.exec(before);
      const prefix = word.toLowerCase();

      let items: Suggestion[] = [];
      if (dotMatch) {
        const cols = tableColumns.get(dotMatch[1].toLowerCase()) ?? [];
        items = cols.map((c) => ({ label: c, kind: "column" as const, detail: dotMatch[1] }));
      } else {
        if (word.length === 0 && !force) {
          setSuggestions([]);
          setMenuPos(null);
          return;
        }
        const tables: Suggestion[] = (schema?.tables ?? [])
          .filter((t) => t.name.toLowerCase().startsWith(prefix))
          .map((t) => ({ label: t.name, kind: "table" as const, detail: "table" }));
        const cols: Suggestion[] = allColumns
          .filter((c) => c.toLowerCase().startsWith(prefix))
          .slice(0, 40)
          .map((c) => ({ label: c, kind: "column" as const, detail: "column" }));
        const kws: Suggestion[] = KEYWORDS.filter((k) => k.toLowerCase().startsWith(prefix)).map((k) => ({
          label: k,
          kind: "keyword" as const,
        }));
        items = [...tables, ...cols, ...kws].slice(0, 50);
      }

      if (items.length === 0) {
        setSuggestions([]);
        setMenuPos(null);
        return;
      }
      const pos = computeCaret();
      setSuggestions(items);
      setSelected(0);
      setActiveWord(wordMatch ? { start: caret - word.length, end: caret } : { start: caret, end: caret });
      setMenuPos({ top: pos.top + 22, left: pos.left });
    },
    [value, tableColumns, allColumns, schema, computeCaret]
  );

  const applySuggestion = useCallback(
    (s: Suggestion) => {
      const ta = textareaRef.current;
      if (!ta || !activeWord) return;
      const next = value.slice(0, activeWord.start) + s.label + value.slice(activeWord.end);
      onChange(next);
      setSuggestions([]);
      setMenuPos(null);
      requestAnimationFrame(() => {
        const pos = activeWord.start + s.label.length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.focus();
      });
    },
    [value, activeWord, onChange]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("[data-sql-autocomplete]")) {
        setSuggestions([]);
        setMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestions[selected]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggestions([]);
        setMenuPos(null);
        return;
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      openSuggestions(true);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = e.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const kindColor = (kind: Suggestion["kind"]) =>
    kind === "table" ? "text-emerald-400" : kind === "column" ? "text-amber-400" : "text-sky-400";

  return (
    <div className={cn("relative flex min-h-0 overflow-hidden bg-card font-mono text-[13px] leading-6", className)}>
      <div
        ref={gutterRef}
        className="scrollbar-thin shrink-0 select-none overflow-hidden border-r bg-muted/30 py-2 text-right text-muted-foreground/60"
        style={{ width: 48 }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="h-6 pr-3">
            {i + 1}
          </div>
        ))}
      </div>

      <div className="relative min-w-0 flex-1">
        <pre
          ref={highlightRef}
          aria-hidden
          className="scrollbar-thin pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-foreground"
          dangerouslySetInnerHTML={{ __html: highlightSQL(value) }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            requestAnimationFrame(() => openSuggestions(false));
          }}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          onClick={() => setSuggestions([])}
          className="scrollbar-thin absolute inset-0 resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/40"
          style={{ minHeight }}
        />

        {suggestions.length > 0 && menuPos && (
          <div
            data-sql-autocomplete
            className="absolute z-30 max-h-56 w-64 overflow-auto rounded-md border bg-popover p-1 text-[13px] shadow-lg"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}:${s.label}:${i}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(s);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left",
                  i === selected ? "bg-accent" : "hover:bg-accent/60"
                )}
              >
                <span className={cn("font-mono", kindColor(s.kind))}>{s.label}</span>
                {s.detail && <span className="ml-auto text-[10px] text-muted-foreground">{s.detail}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* hidden mirror used to position the autocomplete caret */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 -z-10 whitespace-pre-wrap break-words opacity-0"
      />
    </div>
  );
}
