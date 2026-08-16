"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { smartActionPhrase, type SmartAction } from "@/lib/actions";

export type RichPromptHandle = {
  insertChip: (action: SmartAction) => void;
  replaceChip: (el: HTMLElement, action: SmartAction) => void;
  focus: () => void;
};

type CaretXY = { x: number; y: number } | null;

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSlash?: (caret: CaretXY) => void;
  onEditChip?: (el: HTMLElement, action: SmartAction) => void;
  placeholder?: string;
  maxLength?: number;
};

// Rich prompt input: free text + atomic inline Smart Action chips, on a
// contentEditable surface. The DOM owns the content; we serialize on change.
// The aurora (drifting blobs + typing bloom) is ported from the textarea version.
export const RichPromptInput = forwardRef<RichPromptHandle, Props>(function RichPromptInput(
  { value, onChange, onSlash, onEditChip, placeholder = "Describe your strategy…", maxLength = 2000 },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const auroraRef = useRef<HTMLDivElement>(null);
  const heat = useRef(0);
  const raf = useRef(0);
  const lastValue = useRef("");
  const savedRange = useRef<Range | null>(null);

  function serialize(): string {
    const el = editorRef.current;
    if (!el) return "";
    let out = "";
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
      else if (node instanceof HTMLElement) out += node.dataset.phrase ?? node.textContent ?? "";
    });
    return out;
  }

  function emitChange() {
    const el = editorRef.current;
    if (!el) return;
    const v = serialize();
    el.dataset.empty = v.length === 0 ? "true" : "false";
    lastValue.current = v;
    onChange(v);
  }

  // Sync external value changes (examples / reset) — never during our own edits.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || value === lastValue.current) return;
    el.textContent = value;
    el.dataset.empty = value.length === 0 ? "true" : "false";
    lastValue.current = value;
  }, [value]);

  // Aurora intensity follows decaying heat.
  useEffect(() => {
    const tick = () => {
      heat.current *= 0.98;
      const a = auroraRef.current;
      if (a) {
        a.style.opacity = (0.1 + heat.current * 0.22).toFixed(3);
        a.style.transform = `scale(${(1 + heat.current * 0.05).toFixed(3)})`;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  function caretXY(): CaretXY {
    const sel = window.getSelection();
    const el = editorRef.current;
    if (!sel || sel.rangeCount === 0 || !el) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    return { x: rect.left - host.left, y: rect.top - host.top };
  }

  function bloom() {
    const layer = auroraRef.current;
    const pos = caretXY();
    if (!layer || !pos) return;
    const b = document.createElement("div");
    b.style.cssText =
      `position:absolute;left:${pos.x - 55}px;top:${pos.y - 55}px;width:110px;height:110px;` +
      "border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,.5),rgba(250,204,21,.22) 45%,transparent 70%);" +
      "pointer-events:none;filter:blur(12px);opacity:.5;transform:scale(.4);" +
      "transition:transform 1.5s cubic-bezier(.2,.7,.3,1),opacity 1.5s ease-out";
    layer.appendChild(b);
    requestAnimationFrame(() => {
      b.style.transform = "scale(2)";
      b.style.opacity = "0";
    });
    setTimeout(() => b.remove(), 1600);
  }

  function buildChip(action: SmartAction): HTMLElement {
    const phrase = smartActionPhrase(action);
    const chip = document.createElement("span");
    chip.className = "fx-chip";
    chip.contentEditable = "false";
    chip.dataset.phrase = phrase;
    chip.dataset.action = JSON.stringify(action);
    const label = document.createElement("span");
    label.textContent = phrase;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "fx-chip-edit";
    edit.setAttribute("aria-label", "Edit action");
    edit.textContent = "▾";
    chip.append(label, edit);
    return chip;
  }

  function insertChipAtCaret(action: SmartAction) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let range: Range;
    if (savedRange.current && el.contains(savedRange.current.startContainer)) {
      range = savedRange.current;
    } else if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    sel?.removeAllRanges();
    sel?.addRange(range);
    range.deleteContents();
    const chip = buildChip(action);
    range.insertNode(chip);
    const space = document.createTextNode(" ");
    chip.after(space);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    emitChange();
  }

  useImperativeHandle(ref, () => ({
    insertChip: insertChipAtCaret,
    replaceChip: (el, action) => {
      el.replaceWith(buildChip(action));
      emitChange();
    },
    focus: () => editorRef.current?.focus(),
  }));

  // contentEditable accepts anything the clipboard offers by default — an
  // image (screenshot, copied picture) pastes in as an inline <img>, and
  // rich HTML brings its own formatting along. Neither belongs in a plain-
  // text prompt to an LLM, and an inline image especially just sits there
  // looking broken since it contributes nothing to the serialized value.
  // Force every paste down to plain text only.
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    heat.current = Math.min(heat.current + 0.42, 1);
    bloom();
    emitChange();
  }

  function handleClick(e: React.MouseEvent) {
    const editBtn = (e.target as HTMLElement).closest(".fx-chip-edit");
    if (!editBtn) return;
    const chip = editBtn.closest(".fx-chip") as HTMLElement | null;
    if (!chip?.dataset.action) return;
    onEditChip?.(chip, JSON.parse(chip.dataset.action) as SmartAction);
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface-2">
      <div
        ref={auroraRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ opacity: 0.1, willChange: "opacity, transform" }}
      >
        <div
          className="absolute"
          style={{
            left: "-12%",
            top: "-40%",
            width: "60%",
            height: "180%",
            background: "radial-gradient(circle, rgba(16,185,129,.6), transparent 60%)",
            filter: "blur(30px)",
            animation: "fdrift1 9s ease-in-out infinite",
          }}
        />
        <div
          className="absolute"
          style={{
            right: "-12%",
            top: "-30%",
            width: "58%",
            height: "170%",
            background: "radial-gradient(circle, rgba(250,204,21,.42), transparent 60%)",
            filter: "blur(32px)",
            animation: "fdrift2 11s ease-in-out infinite",
          }}
        />
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        data-empty="true"
        onInput={() => {
          heat.current = Math.min(heat.current + 0.42, 1);
          bloom();
          emitChange();
        }}
        onClick={handleClick}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          heat.current = Math.min(heat.current + 0.22, 1);
          if (e.key === "/" && onSlash) {
            e.preventDefault();
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange();
            onSlash(caretXY());
          }
        }}
        className="fx-editor relative z-10 w-full px-4 pt-4 text-[15px] leading-relaxed text-fg outline-none"
        style={{ minHeight: '160px' }}
      />

      <div className="relative z-10 flex items-center justify-between px-4 pb-3 pt-2">
        <span className="mono text-[11.5px] text-faint">
          <span className="rounded bg-line px-1.5 py-0.5 text-muted">/</span> to insert action
        </span>
        <span className="mono text-[11.5px] text-faint">
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
});
