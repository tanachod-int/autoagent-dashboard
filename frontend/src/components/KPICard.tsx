import React from "react";
import { LucideIcon } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  color: "indigo" | "violet" | "emerald" | "amber";
}

const colorClasses = {
  indigo: {
    bgCircle: "bg-indigo-500/5",
    bgIcon: "bg-indigo-500/10",
    textIcon: "text-indigo-400",
    borderIcon: "border-indigo-500/15"
  },
  violet: {
    bgCircle: "bg-violet-500/5",
    bgIcon: "bg-violet-500/10",
    textIcon: "text-violet-400",
    borderIcon: "border-violet-500/15"
  },
  emerald: {
    bgCircle: "bg-emerald-500/5",
    bgIcon: "bg-emerald-500/10",
    textIcon: "text-emerald-400",
    borderIcon: "border-emerald-500/15"
  },
  amber: {
    bgCircle: "bg-amber-500/5",
    bgIcon: "bg-amber-500/10",
    textIcon: "text-amber-400",
    borderIcon: "border-amber-500/15"
  }
};

export default function KPICard({ title, value, subtitle, icon: Icon, color }: KPICardProps) {
  const theme = colorClasses[color];

  return (
    <div className="bg-slate-900/60 border border-slate-900 p-5 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-slate-850 transition-all">
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform ${theme.bgCircle}`} />
      <div className="flex flex-col gap-1 z-10">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</span>
        <span className="text-2xl font-black text-slate-100 font-mono">{value}</span>
        <span className="text-[10px] text-slate-400 mt-0.5">{subtitle}</span>
      </div>
      <div className={`p-3 rounded-xl z-10 border ${theme.bgIcon} ${theme.textIcon} ${theme.borderIcon}`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
}
