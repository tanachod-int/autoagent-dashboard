import React from "react";

interface Metrics {
  total_runs: number;
  total_tokens: number;
  avg_latency_ms: number;
  completed_runs: number;
  pending_runs: number;
  failed_runs: number;
  rejected_runs: number;
  success_rate: number;
}

interface DonutChartProps {
  metrics: Metrics | null;
}

export default function DonutChart({ metrics }: DonutChartProps) {
  const total =
    (metrics?.completed_runs || 0) +
    (metrics?.pending_runs || 0) +
    (metrics?.failed_runs || 0) +
    (metrics?.rejected_runs || 0);

  const successRate = metrics ? `${metrics.success_rate}%` : "100%";

  return (
    <div className="lg:col-span-4 bg-slate-900/60 border border-slate-900 p-6 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col gap-5">
      <h3 className="font-bold text-sm text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">
        Outcome Distribution
      </h3>
      <div className="flex flex-col items-center justify-center py-4 gap-4">
        {/* SVG Donut Chart */}
        <div className="relative w-40 h-40">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
            <defs>
              <filter id="donutGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" />
              </filter>
            </defs>

            {/* Background circle */}
            <circle cx="60" cy="60" r="50" fill="transparent" stroke="#1e293b" strokeWidth="10" />

            {(() => {
              if (total === 0) {
                return (
                  <circle cx="60" cy="60" r="50" fill="transparent" stroke="#334155" strokeWidth="10" />
                );
              }

              const r = 50;
              const circ = 2 * Math.PI * r; // ~314.16
              const c_pct = (metrics?.completed_runs || 0) / total;
              const p_pct = (metrics?.pending_runs || 0) / total;
              const f_pct = (metrics?.failed_runs || 0) / total;
              const r_pct = (metrics?.rejected_runs || 0) / total;

              const c_len = circ * c_pct;
              const p_len = circ * p_pct;
              const f_len = circ * f_pct;
              const r_len = circ * r_pct;

              return (
                <>
                  {/* Completed Segment (Green) */}
                  {c_len > 0 && (
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="transparent"
                      stroke="#10b981"
                      strokeWidth="10"
                      strokeDasharray={`${c_len} ${circ}`}
                      strokeDashoffset="0"
                      filter="url(#donutGlow)"
                    />
                  )}

                  {/* Pending Segment (Amber) */}
                  {p_len > 0 && (
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="transparent"
                      stroke="#f59e0b"
                      strokeWidth="10"
                      strokeDasharray={`${p_len} ${circ}`}
                      strokeDashoffset={-c_len}
                      filter="url(#donutGlow)"
                    />
                  )}

                  {/* Failed Segment (Red) */}
                  {f_len > 0 && (
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="transparent"
                      stroke="#ef4444"
                      strokeWidth="10"
                      strokeDasharray={`${f_len} ${circ}`}
                      strokeDashoffset={-(c_len + p_len)}
                      filter="url(#donutGlow)"
                    />
                  )}

                  {/* Rejected Segment (Slate) */}
                  {r_len > 0 && (
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="transparent"
                      stroke="#64748b"
                      strokeWidth="10"
                      strokeDasharray={`${r_len} ${circ}`}
                      strokeDashoffset={-(c_len + p_len + f_len)}
                      filter="url(#donutGlow)"
                    />
                  )}
                </>
              );
            })()}
          </svg>

          {/* Centered statistics text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black text-slate-100 font-mono">{successRate}</span>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Success</span>
          </div>
        </div>

        {/* Legends */}
        <div className="grid grid-cols-4 gap-1 w-full mt-2 text-[11px]">
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-semibold text-slate-300">Success</span>
            </div>
            <span className="font-mono text-slate-500">{metrics?.completed_runs || 0} runs</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="font-semibold text-slate-300">Pending</span>
            </div>
            <span className="font-mono text-slate-500">{metrics?.pending_runs || 0} runs</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="font-semibold text-slate-300">Failed</span>
            </div>
            <span className="font-mono text-slate-500">{metrics?.failed_runs || 0} runs</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="font-semibold text-slate-300">Rejected</span>
            </div>
            <span className="font-mono text-slate-500">{metrics?.rejected_runs || 0} runs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
