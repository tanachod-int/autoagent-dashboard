import React from "react";
import { LucideIcon } from "lucide-react";

interface PipelineStepCardProps {
  stepNumber: number;
  title: string;
  isSuccess: boolean;
  successText: string;
  pendingText: string;
  icon: LucideIcon;
}

export default function PipelineStepCard({
  stepNumber,
  title,
  isSuccess,
  successText,
  pendingText,
  icon: Icon,
}: PipelineStepCardProps) {
  return (
    <div
      className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${
        isSuccess
          ? "bg-indigo-950/10 border-indigo-500/30 text-indigo-300"
          : "bg-slate-950 border-slate-900 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500 uppercase">Step {stepNumber}</span>
        <Icon className={`w-4 h-4 ${isSuccess ? "text-indigo-400" : "text-slate-650"}`} />
      </div>
      <h4 className="font-semibold text-sm text-slate-200">{title}</h4>
      <span className="text-[10px] text-slate-500 font-mono">
        {isSuccess ? successText : pendingText}
      </span>
    </div>
  );
}
