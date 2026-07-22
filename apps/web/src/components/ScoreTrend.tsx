"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Y axis is pinned to 0-100 rather than auto-scaling. Mutation score is an
 * absolute percentage against a fixed gate, so letting the axis float would
 * make a 4-point wobble look like a collapse.
 */
export function ScoreTrend({
  points,
  height = 190,
}: {
  points: Array<{ label: string; score: number }>;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-faint)",
          fontSize: 13,
        }}
      >
        At least two runs are needed to show a trend.
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2DD4BF" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#2DD4BF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#212C3B" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#5A6D85"
            tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="#5A6D85"
            tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: "#161E29",
              border: "1px solid #2E3C4F",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
            labelStyle={{ color: "#8DA0B8" }}
            formatter={(value: number) => [`${value.toFixed(1)}%`, "Score"]}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#2DD4BF"
            strokeWidth={2}
            fill="url(#scoreFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
