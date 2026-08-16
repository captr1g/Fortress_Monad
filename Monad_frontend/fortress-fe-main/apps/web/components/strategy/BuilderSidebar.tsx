import { PROMPT_EXAMPLES, SUPPORTED_PROTOCOLS } from "@/lib/strategy";

const TIPS = [
  "Name the asset and the outcome you want.",
  "Give step-by-step instructions where it matters.",
  "State your risk tolerance and constraints.",
  "Use / to insert a Smart Action.",
];

export function BuilderSidebar({
  onPickExample,
}: {
  onPickExample?: (example: string) => void;
}) {
  return (
    <div className="fx-scroll flex w-[344px] flex-none flex-col gap-7 overflow-y-auto border-l border-line-soft px-[22px] py-6">
      <section>
        <h3 className="mb-3 text-[12px] font-medium text-fg-soft">Writing a good prompt</h3>
        <div className="flex flex-col gap-2.5">
          {TIPS.map((tip, i) => (
            <div key={i} className="flex gap-2.5">
              <span className="mono flex-none text-[11.5px] text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[12.5px] leading-relaxed text-muted">{tip}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-[12px] font-medium text-fg-soft">Examples</h3>
        <div className="flex flex-col">
          {PROMPT_EXAMPLES.map((ex, i) => (
            <button
              key={ex}
              onClick={() => onPickExample?.(ex)}
              className={`flex items-center justify-between py-[11px] text-left ${
                i < PROMPT_EXAMPLES.length - 1 ? "border-b border-line-soft" : ""
              }`}
            >
              <span className="text-[12.5px] text-fg-soft">{ex}</span>
              <span className="text-[12px] text-faint">→</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[12px] font-medium text-fg-soft">Supported protocols</h3>
          <span className="mono text-[11px] text-faint">Base ▾</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {SUPPORTED_PROTOCOLS.map((p) => (
            <div
              key={p}
              className="flex items-center gap-2.5 rounded-lg border border-line-soft bg-surface px-3 py-2.5"
            >
              <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md bg-line text-[10px] font-medium text-muted">
                {p.charAt(0)}
              </span>
              <span className="text-[12.5px] font-medium">{p}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
