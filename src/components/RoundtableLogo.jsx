/**
 * ROUNDTABLE LOGO — the brand mark. A panel of 5 seated agents + 7 empty seats
 * around an orchestrator that pulses at the center. Reads as "a panel, with room
 * to grow." Used at nav (28), hero (88), footer (44), and the app.
 *
 * 12 evenly-spaced seats (every 30°, slot 0 = 12 o'clock). 5 active (colored),
 * 7 placeholders (dim). Center = the orchestrator (OpenClaw).
 */
const ACCENT = '#6fa1ff'
// slot → agent color (the active seats)
const SEATS = {
  0: '#d97757',  // Claude — top
  2: '#10a37f',  // GPT — 2 o'clock
  5: '#5b8def',  // Gemini — 5 o'clock
  7: '#b48af7',  // Grok — 7 o'clock
  10: '#4d8df0', // DeepSeek — 10 o'clock
}
const C = 44, R = 32

function seat(i) {
  const a = ((-90 + i * 30) * Math.PI) / 180
  return [C + R * Math.cos(a), C + R * Math.sin(a)]
}

export default function RoundtableLogo({ size = 88, className = '', pulse = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" className={className} role="img" aria-label="Agent Interface">
      <rect x="1" y="1" width="86" height="86" rx="22" fill="#181b21" stroke="#2e323c" strokeWidth="1" />
      {/* dashed orbital ring */}
      <circle cx={C} cy={C} r={R} fill="none" stroke="#2e323c" strokeWidth="1" strokeDasharray="2 4" opacity="0.85" />
      {/* faint radial spokes from the orchestrator to each seated agent */}
      {Object.entries(SEATS).map(([i, color]) => {
        const [x, y] = seat(Number(i))
        return <line key={`spoke-${i}`} x1={C} y1={C} x2={x} y2={y} stroke={color} strokeWidth="0.7" opacity="0.35" />
      })}
      {/* 12 seats — 5 active, 7 placeholders */}
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = seat(i)
        return SEATS[i]
          ? <circle key={i} cx={x} cy={y} r="4" fill={SEATS[i]} />
          : <circle key={i} cx={x} cy={y} r="2" fill="#3a3f4a" />
      })}
      {/* the orchestrator — a glowing accent dot that pulses */}
      <circle cx={C} cy={C} r="5" fill={ACCENT}>
        {pulse && <animate attributeName="r" values="5;5.9;5" dur="2.4s" repeatCount="indefinite" />}
        {pulse && <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" />}
      </circle>
      <circle cx={C} cy={C} r="3" fill="#181b21" stroke={ACCENT} strokeWidth="1" />
    </svg>
  )
}
