import type { HealthStatus } from "../../api/business-health";

interface HealthScoreGaugeProps {
  score: number;
  status: HealthStatus;
  size?: number;
  showLabel?: boolean;
  grade?: string;
}

function colorFor(score: number): { stroke: string; text: string } {
  if (score >= 75) return { stroke: "#16a34a", text: "#15803d" }; // green
  if (score >= 50) return { stroke: "#eab308", text: "#a16207" }; // yellow
  return { stroke: "#dc2626", text: "#991b1b" }; // red
}

const statusLabel: Record<HealthStatus, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  concerning: "Concerning",
  critical: "Critical",
};

export function HealthScoreGauge({
  score,
  status,
  size = 220,
  showLabel = true,
  grade,
}: HealthScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const { stroke, text } = colorFor(clamped);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div
      className="inline-flex flex-col items-center justify-center"
      style={{ width: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Business health score: ${Math.round(clamped)} out of 100`}
      >
        {/* Background track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={12}
        />
        {/* Filled arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={12}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease" }}
        />
        <text
          x={cx}
          y={cy - (grade ? 14 : 6)}
          textAnchor="middle"
          fontSize={size * 0.32}
          fontWeight={700}
          fill={text}
        >
          {Math.round(clamped)}
        </text>
        {grade && (
          <text
            x={cx}
            y={cy + size * 0.12}
            textAnchor="middle"
            fontSize={size * 0.14}
            fontWeight={600}
            fill={text}
          >
            {grade}
          </text>
        )}
      </svg>
      {showLabel && (
        <div className="mt-2 text-sm font-medium" style={{ color: text }}>
          {statusLabel[status]}
        </div>
      )}
    </div>
  );
}
