"use client";

import { useRef, useState } from "react";
import type { SmartAction } from "@/lib/actions";
import { ActionPicker, type Draft, type Step } from "./ActionPicker";
import { RichPromptInput, type RichPromptHandle } from "./RichPromptInput";

const PICKER_WIDTH = 360;

type Anchor = { left: number; top: number; width: number };
type Initial = { draft: Draft; step: Step; amountPct?: number };

// The rich prompt input + the "/" Smart Action wizard. Typing "/" opens the
// wizard at the caret; confirming inserts an inline chip. Clicking a chip's ▾
// reopens the wizard prefilled so the user can edit it in place.
export function PromptComposer({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichPromptHandle>(null);
  const editingChip = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [initial, setInitial] = useState<Initial | undefined>(undefined);

  function anchorAt(x: number, y: number) {
    const wrapWidth = wrapperRef.current?.offsetWidth ?? PICKER_WIDTH;
    // Never wider than the composer itself — on mobile the wrapper is
    // narrower than PICKER_WIDTH, so a fixed 360px picker would overflow.
    const width = Math.min(PICKER_WIDTH, wrapWidth);
    setAnchor({ left: Math.max(0, Math.min(x, wrapWidth - width)), top: y, width });
  }

  function openForInsert(caret: { x: number; y: number } | null) {
    editingChip.current = null;
    setInitial(undefined);
    anchorAt(caret?.x ?? 0, (caret?.y ?? 0) + 24);
  }

  function openForEdit(el: HTMLElement, action: SmartAction) {
    editingChip.current = el;
    setInitial({
      draft: {
        toolId: action.toolId,
        label: action.label,
        protocol: action.protocol,
        chainId: action.chainId,
        token: action.token,
      },
      step: "amount",
      amountPct: action.amountPct,
    });
    const host = wrapperRef.current?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (host) anchorAt(rect.left - host.left, rect.bottom - host.top + 6);
  }

  function close() {
    setAnchor(null);
    editingChip.current = null;
  }

  function confirm(action: SmartAction) {
    if (editingChip.current) editorRef.current?.replaceChip(editingChip.current, action);
    else editorRef.current?.insertChip(action);
    close();
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <RichPromptInput
        ref={editorRef}
        value={value}
        onChange={onChange}
        onSlash={openForInsert}
        onEditChip={openForEdit}
      />
      {anchor && (
        <ActionPicker
          style={{ left: anchor.left, top: anchor.top, width: anchor.width }}
          initial={initial}
          onSelect={confirm}
          onClose={close}
        />
      )}
    </div>
  );
}
