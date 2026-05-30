import React from "react";

interface Workflow {
  id: number;
  task_query: string;
  status: string;
  tokens_used: number;
  latency_ms: number;
  created_at: string;
}

interface TrendChartsProps {
  workflows: Workflow[];
}

export default function TrendCharts({ workflows }: TrendChartsProps) {
  const trendData = [...workflows].reverse().slice(-10);

  if (trendData.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm py-12">
        No execution data available for trends.
      </div>
    );
  }

  const width = 500;
  const height = 110;
  const padding = 15;

  // Calculate Latency line coordinates
  const maxLatency = Math.max(...trendData.map((d) => d.latency_ms), 1000);
  const latencyPoints = trendData.map((d, index) => {
    const x = padding + (index * (width - 2 * padding)) / Math.max(trendData.length - 1, 1);
    const y = height - padding - (d.latency_ms / maxLatency) * (height - 2 * padding);
    return { x, y, val: d.latency_ms, id: d.id };
  });

  const latencyPathStr =
    latencyPoints.length > 0
      ? `M ${latencyPoints[0].x} ${latencyPoints[0].y} ` +
        latencyPoints
          .slice(1)
          .map((p) => `L ${p.x} ${p.y}`)
          .join(" ")
      : "";
  const latencyAreaStr =
    latencyPoints.length > 0
      ? `${latencyPathStr} L ${latencyPoints[latencyPoints.length - 1].x} ${
          height - padding
        } L ${latencyPoints[0].x} ${height - padding} Z`
      : "";

  // Calculate Token bar properties
  const maxTokens = Math.max(...trendData.map((d) => d.tokens_used), 500);
  const barWidth = Math.min(25, (width - 2 * padding) / (trendData.length * 1.5));
  const barSpacing = (width - 2 * padding) / Math.max(trendData.length, 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Latency Line Graph */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
          <span>Latency History (ms)</span>
          <span className="text-[10px] text-slate-500 font-mono">
            Max: {maxLatency.toLocaleString()} ms
          </span>
        </span>
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850">
          <svg className="w-full h-auto" viewBox={`0 0 ${width} ${height}`} width="100%">
            <defs>
              <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Horizontal guide lines */}
            <line
              x1={padding}
              y1={padding}
              x2={width - padding}
              y2={padding}
              stroke="#1e293b"
              strokeDasharray="2 2"
            />
            <line
              x1={padding}
              y1={height / 2}
              x2={width - padding}
              y2={height / 2}
              stroke="#1e293b"
              strokeDasharray="2 2"
            />
            <line
              x1={padding}
              y1={height - padding}
              x2={width - padding}
              y2={height - padding}
              stroke="#334155"
            />

            {/* Area fill */}
            {latencyAreaStr && <path d={latencyAreaStr} fill="url(#latencyGrad)" />}
            {/* Trend Line */}
            {latencyPathStr && (
              <path
                d={latencyPathStr}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            )}

            {/* Dots */}
            {latencyPoints.map((p, idx) => (
              <g key={idx} className="group/dot cursor-pointer">
                <circle cx={p.x} cy={p.y} r="4" fill="#022c22" stroke="#10b981" strokeWidth="2" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="8"
                  fill="#10b981"
                  fillOpacity="0"
                  className="hover:fill-opacity-20 transition-all"
                />
                <title>
                  Run #{p.id}: {p.val.toLocaleString()} ms
                </title>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* Token Bar Graph */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
          <span>Tokens Consumption</span>
          <span className="text-[10px] text-slate-500 font-mono">
            Max: {maxTokens.toLocaleString()} tokens
          </span>
        </span>
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850">
          <svg className="w-full h-auto" viewBox={`0 0 ${width} ${height}`} width="100%">
            <defs>
              <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            {/* Horizontal guide lines */}
            <line
              x1={padding}
              y1={padding}
              x2={width - padding}
              y2={padding}
              stroke="#1e293b"
              strokeDasharray="2 2"
            />
            <line
              x1={padding}
              y1={height / 2}
              x2={width - padding}
              y2={height / 2}
              stroke="#1e293b"
              strokeDasharray="2 2"
            />
            <line
              x1={padding}
              y1={height - padding}
              x2={width - padding}
              y2={height - padding}
              stroke="#334155"
            />

            {/* Bars */}
            {trendData.map((d, index) => {
              const x = padding + index * barSpacing + (barSpacing - barWidth) / 2;
              const h = (d.tokens_used / maxTokens) * (height - 2 * padding);
              const y = height - padding - h;
              return (
                <g key={index} className="group/bar cursor-pointer">
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(2, h)}
                    rx="2"
                    fill="url(#tokenGrad)"
                    className="hover:opacity-85 transition-opacity"
                  />
                  <title>
                    Run #{d.id}: {d.tokens_used.toLocaleString()} tokens
                  </title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
