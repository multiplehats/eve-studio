/**
 * Ambient background: sparse horizontal bars in the geometry of the eve
 * logomark, drifting slowly like rows of session events. Masked away from
 * the center so the hero copy stays clean.
 */

type Segment = { left: string; width: string }
type Row = { top: string; drift: string; duration: string; segments: Array<Segment> }

const ROWS: Array<Row> = [
  { top: "6%", drift: "-70px", duration: "52s", segments: [{ left: "4%", width: "72px" }, { left: "14%", width: "28px" }, { left: "82%", width: "56px" }] },
  { top: "13%", drift: "50px", duration: "64s", segments: [{ left: "9%", width: "40px" }, { left: "88%", width: "34px" }] },
  { top: "21%", drift: "-45px", duration: "58s", segments: [{ left: "2%", width: "26px" }, { left: "7%", width: "64px" }, { left: "91%", width: "44px" }] },
  { top: "29%", drift: "60px", duration: "70s", segments: [{ left: "11%", width: "52px" }, { left: "84%", width: "26px" }, { left: "90%", width: "60px" }] },
  { top: "38%", drift: "-55px", duration: "48s", segments: [{ left: "5%", width: "34px" }, { left: "93%", width: "38px" }] },
  { top: "47%", drift: "40px", duration: "66s", segments: [{ left: "8%", width: "60px" }, { left: "87%", width: "30px" }] },
  { top: "56%", drift: "-65px", duration: "56s", segments: [{ left: "3%", width: "44px" }, { left: "10%", width: "24px" }, { left: "90%", width: "52px" }] },
  { top: "65%", drift: "48px", duration: "62s", segments: [{ left: "6%", width: "68px" }, { left: "85%", width: "40px" }] },
  { top: "74%", drift: "-40px", duration: "54s", segments: [{ left: "12%", width: "30px" }, { left: "89%", width: "28px" }, { left: "94%", width: "36px" }] },
  { top: "83%", drift: "56px", duration: "68s", segments: [{ left: "4%", width: "48px" }, { left: "86%", width: "62px" }] },
  { top: "91%", drift: "-50px", duration: "60s", segments: [{ left: "9%", width: "36px" }, { left: "15%", width: "56px" }, { left: "92%", width: "30px" }] },
]

export function TraceField() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        maskImage:
          "radial-gradient(ellipse 55% 55% at 50% 45%, transparent 35%, black 78%)",
      }}
    >
      {ROWS.map((row, i) => (
        <div
          key={i}
          className="trace-row absolute inset-x-0"
          style={{
            top: row.top,
            "--drift": row.drift,
            "--drift-duration": row.duration,
          } as React.CSSProperties}
        >
          {row.segments.map((seg, j) => (
            <span
              key={j}
              className="absolute h-[3px] rounded-full bg-[#1c1c1c]"
              style={{ left: seg.left, width: seg.width }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
