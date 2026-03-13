import React, { useId } from "react";
import {
  Area,
  AreaChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { color } from "../constants/tailwind";

const safeData = [
  {
    time: "18:00",
    sniffer: 0.5,
    purway: 0.4,
  },
  {
    time: "18:10",
    sniffer: 1.8,
    purway: 1.4,
  },
  {
    time: "18:18",
    sniffer: 4.6,
    purway: 3.9,
  },
  {
    time: "18:24",
    sniffer: 6.8,
    purway: 5.6,
  },
  {
    time: "18:30",
    sniffer: 8.5,
    purway: 7.1,
  },
  {
    time: "18:38",
    sniffer: 10.2,
    purway: 8.7,
    
  },
  {
    time: "18:46",
    sniffer: 11.4,
    purway: 9.8,
  },
  {
    time: "19:00",
    sniffer: 11.6,
    purway: 10.0,
  },
  {
    time: "19:30",
    sniffer: 11.6,
    purway: 10.0,
  },
  {
    time: "20:00",
    sniffer: 11.7,
    purway: 10.1,
  },
  {
    time: "Now",
    sniffer: 11.9,
    purway: 10.1,
  },
];

const seriesTheme = {
  purway: {
    label: "ln/min",
    valueLabel: "Purway",
    stroke: color.orange,
    fill: "rgba(253, 148, 86, 0.26)",
  },
  sniffer: {
    label: "ln/min",
    valueLabel: "Sniffer",
    stroke: color.green,
    fill: "rgba(106, 214, 194, 0.30)",
  },
};

export function FlowChart() {
  const chartId = useId().replace(/:/g, "");
  const latestPoint = safeData[safeData.length - 1];
  const peakValue = Math.max(
    ...safeData.map((point) => point.sniffer),
    ...safeData.map((point) => point.purway),
  );
  const leftTicks = [
    0,
    Math.ceil(peakValue * 0.35),
    Math.ceil(peakValue * 0.7),
    Math.ceil(peakValue),
  ];

  return (
    <div
      className="flex h-full w-full flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-xs uppercase tracking-[0.18em]"
            style={{ color: color.green }}
          >
            methane flow
          </p>
          <h3
            className="text-xl font-bold tracking-tight"
            style={{ color: color.text }}
          >
            Combined sensor view
          </h3>
        </div>
        <div
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: color.orangeSoft, color: color.orange }}
        >
          Live
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(seriesTheme).map(([sensorKey, theme]) => {
          const latestValue = latestPoint[sensorKey];

          return (
            <div
              key={sensorKey}
              className="rounded-lg border px-3 py-2.5"
              style={{ backgroundColor: color.surface, borderColor: color.border }}
            >
              <div className="text-[13px] uppercase tracking-[0.12em]" style={{ color: color.textMuted }}>
                {theme.valueLabel}
              </div>
              <div className="flex flex-row mt-1 text-lg font-semibold leading-none" style={{ color: theme.stroke }}>
                {latestValue.toFixed(1)}
                <p className="ms-1 mt-1.5 text-[11px] uppercase tracking-[0.12em]" style={{ color: color.textMuted}}>
                    {theme.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="min-h-[400px] rounded-xl border p-3"
      style={{ backgroundColor: color.surface, borderColor: color.border }}
    >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={safeData}
            margin={{ top: 8, right: 6, left: 8, bottom: 0 }}
          >
            <defs>
              {Object.entries(seriesTheme).map(([sensorKey, theme]) => (
                <linearGradient
                  key={sensorKey}
                  id={`flowGradient-${chartId}-${sensorKey}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={theme.fill} stopOpacity={0.95} />
                  <stop offset="70%" stopColor={theme.fill} stopOpacity={0.34} />
                  <stop offset="100%" stopColor={theme.fill} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="4 4"
              stroke={color.borderStrong}
              vertical={false}
            />
            <XAxis
              dataKey="time"
              stroke={color.textDim}
              style={{ fontSize: "11px" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke={color.textDim}
              tickLine={false}
              axisLine={{ stroke: color.borderStrong }}
              width={44}
              style={{ fontSize: "11px" }}
              ticks={leftTicks}
              tick={{ fill: color.text, fontSize: 11 }}
              label={{
                value: "ln/min",
                angle: -90,
                position: "insideLeft",
                offset: 0,
                fill: color.text,
                fontSize: 11,
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: color.surface,
                border: `1px solid ${color.borderStrong}`,
                borderRadius: "8px",
                color: color.text,
              }}
              formatter={(value) =>
                value != null && !Number.isNaN(value)
                  ? Number(value).toFixed(2)
                  : "0.00"
              }
              labelStyle={{ color: color.text }}
            />
            {Object.entries(seriesTheme).map(([sensorKey, theme]) => {
              const dataKey = sensorKey;

              return (
                <React.Fragment key={sensorKey}>
                  <Area
                    type="monotone"
                    dataKey={dataKey}
                    stroke={theme.stroke}
                    strokeWidth={2.3}
                    fill={`url(#flowGradient-${chartId}-${sensorKey})`}
                    isAnimationActive={false}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: theme.stroke }}
                  />
                  <Line
                    type="monotone"
                    dataKey={dataKey}
                    stroke={theme.stroke}
                    strokeWidth={2.3}
                    dot={false}
                    isAnimationActive={false}
                  />
                </React.Fragment>
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
