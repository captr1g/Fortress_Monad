import { ImageResponse } from "next/og";
import { PATH_A, PATH_B } from "@/components/ui/FortressMark";

export const alt = "Fortress | Autonomous DeFi strategies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#0a0a0b",
          padding: "100px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -160,
            width: 640,
            height: 640,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, rgba(16,185,129,0.35), rgba(250,204,21,0.15))",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg
            width={104}
            height={(104 * 347.992) / 300}
            viewBox="0 0 300 347.992"
            fill="none"
          >
            <path d={PATH_A} fill="#fafafa" />
            <path d={PATH_B} fill="#fafafa" />
          </svg>
          <span
            style={{
              fontSize: 84,
              fontWeight: 700,
              color: "#fafafa",
              letterSpacing: -2,
            }}
          >
            Fortress
          </span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            fontSize: 34,
            color: "#a1a1aa",
            maxWidth: 900,
          }}
        >
          Describe a strategy. Fortress builds it, simulates it, and runs
          entry and exit on-chain.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            width: 120,
            height: 6,
            borderRadius: 3,
            background: "linear-gradient(120deg, #10b981, #facc15)",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
