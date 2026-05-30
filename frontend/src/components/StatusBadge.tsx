import React from "react";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const getStatusClasses = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      case "sending":
        return "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse";
      case "pending_approval":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse";
      case "rejected":
        return "bg-slate-500/10 text-slate-400 border border-slate-500/20";
      default:
        return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending_approval":
        return "Pending Approval";
      case "sending":
        return "Sending...";
      case "rejected":
        return "Rejected";
      default:
        return status;
    }
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${getStatusClasses(
        status
      )} ${className}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}
