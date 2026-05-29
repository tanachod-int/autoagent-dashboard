"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Play,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Table,
  FileSpreadsheet,
  MessageSquare,
  TrendingUp,
  Layers,
  Database,
  Send,
  Loader2,
  Clock,
  Coins,
  History,
  Check,
  ExternalLink,
  Trash2
} from "lucide-react";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_URL = rawApiUrl.endsWith("/") ? rawApiUrl.slice(0, -1) : rawApiUrl;

interface WorkflowStep {
  id: number;
  step_name: string;
  sql_generated: string | null;
  execution_result: string;
  is_success: boolean;
  created_at: string;
}

interface Workflow {
  id: number;
  task_query: string;
  status: string;
  tokens_used: number;
  latency_ms: number;
  created_at: string;
  steps?: WorkflowStep[];
}

interface DiscordEmbedField {
  name: string;
  value: string;
}

interface DiscordEmbedContent {
  title?: string;
  description: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordEmbed {
  embeds?: DiscordEmbedContent[];
}


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

export default function Dashboard() {
  // Inputs
  const [query, setQuery] = useState("หาสินค้าวิกฤตที่เหลือน้อยกว่า 10 ชิ้นแล้วบันทึกลง Google Sheets");
  const [sheetUrl, setSheetUrl] = useState("https://docs.google.com/spreadsheets/d/1KygmZXWBB7cHEixW9ajuafnovvoYNu7-ajjG2aLiJvM");

  // States
  const [isLoading, setIsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [serverHealth, setServerHealth] = useState<"connected" | "disconnected" | "checking">("checking");
  const [activeTab, setActiveTab] = useState<"pipeline" | "data">("pipeline");
  const [currentView, setCurrentView] = useState<"sandbox" | "monitoring">("sandbox");
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // Notifications
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch detailed workflow steps
  const fetchWorkflowDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${API_URL}/api/agent/workflows/${id}`);
      if (res.ok) {
        const data = await res.json();
        setActiveWorkflow(data);
      }
    } catch (err) {
      console.error("Failed to fetch workflow details:", err);
    }
  }, []);

  // Fetch all workflows history
  const fetchWorkflows = useCallback(async (selectLatest = false) => {
    try {
      const res = await fetch(`${API_URL}/api/agent/workflows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data);
        setServerHealth("connected");
        if (selectLatest && data.length > 0) {
          fetchWorkflowDetail(data[0].id);
        }
      } else {
        setServerHealth("disconnected");
      }
    } catch (err) {
      console.error("Failed to fetch workflows:", err);
      setServerHealth("disconnected");
    }
  }, [fetchWorkflowDetail]);

  // Fetch overall dashboard metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/agent/metrics`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    }
  }, []);

  // Check health on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) {
          setServerHealth("connected");
        } else {
          setServerHealth("disconnected");
        }
      } catch {
        setServerHealth("disconnected");
      }
    };

    checkHealth();
    fetchWorkflows(true);
    fetchMetrics();

    // Auto refresh workflows history list and metrics every 15 seconds
    const interval = setInterval(() => {
      fetchWorkflows();
      fetchMetrics();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchWorkflows, fetchMetrics]);

  // Run the agent pipeline
  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    setActiveWorkflow(null);

    try {
      const res = await fetch(`${API_URL}/api/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sheet_url: sheetUrl }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to execute agent workflow");
      }

      const data = await res.json();

      // Refresh list and select the newly created workflow
      await fetchWorkflows();
      await fetchMetrics();
      if (data.workflow_id) {
        await fetchWorkflowDetail(data.workflow_id);
      }

      if (data.success === false) {
        throw new Error(data.error || "Failed to execute agent workflow");
      }
      setSuccessMsg("Agent pipeline executed successfully!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred during execution.";
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Approve and send to Discord
  const handleApprove = async () => {
    if (!activeWorkflow) return;
    setIsApproving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${API_URL}/api/agent/approve/${activeWorkflow.id}`, {
        method: "POST"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to approve workflow");
      }

      setSuccessMsg("Notification successfully approved and sent to Discord!");

      // Refresh workflow data
      await fetchWorkflows();
      await fetchMetrics();
      await fetchWorkflowDetail(activeWorkflow.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Approval failed.";
      setErrorMsg(msg);
    } finally {
      setIsApproving(false);
    }
  };

  // Reject and cancel workflow
  const handleReject = async () => {
    if (!activeWorkflow) return;
    setIsRejecting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${API_URL}/api/agent/reject/${activeWorkflow.id}`, {
        method: "POST"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to reject workflow");
      }

      setSuccessMsg("Notification rejected and workflow cancelled.");

      // Refresh workflow data
      await fetchWorkflows();
      await fetchMetrics();
      await fetchWorkflowDetail(activeWorkflow.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rejection failed.";
      setErrorMsg(msg);
    } finally {
      setIsRejecting(false);
    }
  };

  // Delete a specific workflow
  const handleDeleteWorkflow = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete Workflow #${id}?`)) return;

    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${API_URL}/api/agent/workflows/${id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to delete workflow");
      }

      setSuccessMsg(`Workflow #${id} successfully deleted.`);
      
      if (activeWorkflow?.id === id) {
        setActiveWorkflow(null);
      }

      await fetchWorkflows();
      await fetchMetrics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deletion failed.";
      setErrorMsg(msg);
    }
  };

  // Clear all workflows
  const handleClearAllWorkflows = async () => {
    if (!confirm("Are you sure you want to delete ALL workflows history? This cannot be undone.")) return;

    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${API_URL}/api/agent/workflows`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to clear workflows");
      }

      setSuccessMsg("All workflows successfully deleted.");
      setActiveWorkflow(null);

      await fetchWorkflows();
      await fetchMetrics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to clear all workflows.";
      setErrorMsg(msg);
    }
  };

  // Extract variables for presentation
  const generateStep = activeWorkflow?.steps?.find(s => s.step_name === "generate_sql");
  const executeStep = activeWorkflow?.steps?.find(s => s.step_name === "execute_sql");
  const sheetsStep = activeWorkflow?.steps?.find(s => s.step_name === "write_sheets");
  const discordStep = activeWorkflow?.steps?.find(s => s.step_name === "draft_discord");

  // Try to parse Discord Embed Payload JSON
  let discordEmbed: DiscordEmbed | null = null;
  if (discordStep?.execution_result) {
    try {
      discordEmbed = JSON.parse(discordStep.execution_result);
    } catch {
      // not JSON
    }
  }

  // Dynamic SQL query results parser
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryResults: any[] = [];
  if (executeStep?.execution_result) {
    try {
      const parsed = JSON.parse(executeStep.execution_result);
      if (Array.isArray(parsed)) {
        queryResults = parsed;
      }
    } catch {
      // Legacy parser fallback: parse from Discord embed description markdown if it exists
      if (discordEmbed && discordEmbed.embeds && discordEmbed.embeds[0]) {
        const desc = discordEmbed.embeds[0].description || "";
        const lines = desc.split("\n");
        lines.forEach((line: string) => {
          if (line.startsWith("* ")) {
            const match = line.match(/\*\*(.*?)\*\*:\s*เหลือ\s*(\d+)\s*ชิ้น/);
            if (match) {
              queryResults.push({
                product_name: match[1],
                stock_quantity: parseInt(match[2]),
                price: match[1] === "Premium Laptop Pro" ? 45000 : match[1] === "Tablet Air 10\"" ? 12500 : 0
              });
            }
          }
        });
      }
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600/10 rounded-lg border border-indigo-500/20 text-indigo-400">
            <Layers className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              AutoAgent Dashboard
            </h1>
            <p className="text-xs text-slate-400">AI-Powered Text-to-SQL & Notifications Hub</p>
          </div>
        </div>

        {/* View Selection Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-850 p-1 rounded-xl">
          <button
            onClick={() => setCurrentView("sandbox")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${currentView === "sandbox"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                : "text-slate-400 hover:text-slate-200"
              }`}
          >
            Interactive Sandbox
          </button>
          <button
            onClick={() => {
              setCurrentView("monitoring");
              fetchMetrics();
            }}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${currentView === "monitoring"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                : "text-slate-400 hover:text-slate-200"
              }`}
          >
            Observability Panel
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${serverHealth === "connected" ? "bg-emerald-500 animate-ping" :
                serverHealth === "disconnected" ? "bg-rose-500" : "bg-amber-500 animate-pulse"
              }`} />
            <span className="text-slate-300 font-medium">
              Backend: {serverHealth === "connected" ? "Connected" : serverHealth === "disconnected" ? "Offline" : "Checking..."}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-6">

        {currentView === "sandbox" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Side: Control & Configuration */}
            <section className="lg:col-span-5 flex flex-col gap-6">
              {/* Agent Operations Card */}
              <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm shadow-xl flex flex-col gap-5">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Play className="w-5 h-5" />
                  <h2 className="font-semibold text-lg text-slate-100 text-left">Trigger AI Agent</h2>
                </div>

                <form onSubmit={handleRunAgent} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">
                      Natural Language Command (Thai)
                    </label>
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="เช่น: หาสินค้าคงคลังที่เหลือน้อยกว่า 10 ชิ้นแล้วรายงานลง Google Sheets"
                      className="w-full min-h-[90px] px-4 py-3 bg-slate-950 border border-slate-850 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition text-slate-200 placeholder-slate-600 resize-none font-medium text-left"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">
                      Target Google Sheets URL
                    </label>
                    <div className="relative">
                      <FileSpreadsheet className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                      <input
                        type="url"
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-850 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition text-slate-200 font-mono text-xs text-left"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || serverHealth !== "connected"}
                    className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${isLoading
                        ? "bg-indigo-650/50 text-indigo-300 cursor-not-allowed"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-500/20 active:scale-[0.98]"
                      }`}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Executing Multi-Agent State Machine...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Run AI Operations Agent
                      </>
                    )}
                  </button>
                </form>

                {/* Quick Prompts */}
                <div className="flex flex-col gap-2 mt-2">
                  <span className="text-xs text-slate-500 font-medium text-left">Quick Prompts:</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setQuery("หาสินค้าคงคลังที่เหลือน้อยกว่า 10 ชิ้นแล้วรายงานลง Google Sheets")}
                      className="text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 hover:border-indigo-500/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200 transition font-medium text-left"
                    >
                      🔍 หาสินค้าวิกฤต (Stock &lt; 10)
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuery("สรุปยอดขายรวมของสินค้าแต่ละรายการแล้วรายงานลง Google Sheets")}
                      className="text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 hover:border-indigo-500/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200 transition font-medium text-left"
                    >
                      📊 ยอดขายรายสินค้า (Total Sales)
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuery("ดึงรายการประวัติการขาย 7 วันล่าสุดพร้อมชื่อสินค้าและยอดเงิน")}
                      className="text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 hover:border-indigo-500/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200 transition font-medium text-left"
                    >
                      📅 ประวัติการขาย 7 วันล่าสุด
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuery("หาสินค้าที่มีราคาสูงกว่า 10000 บาทแล้วรายงานลง Google Sheets")}
                      className="text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-850 hover:border-indigo-500/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200 transition font-medium text-left"
                    >
                      💰 สินค้าราคาพรีเมียม (&gt; 10,000)
                    </button>
                  </div>
                </div>
              </div>

              {/* Workflow Execution History */}
              <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm flex-1 flex flex-col gap-4 max-h-[480px] overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-400">
                    <History className="w-5 h-5" />
                    <h3 className="font-semibold text-base text-slate-100">Workflow Execution Logs</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {workflows.length > 0 && (
                      <button
                        onClick={handleClearAllWorkflows}
                        className="text-xs text-rose-450 hover:text-rose-400 font-semibold flex items-center gap-1 transition-all"
                        title="Delete all workflows history"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear All
                      </button>
                    )}
                    <button
                      onClick={() => fetchWorkflows(false)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="overflow-y-auto flex-1 flex flex-col gap-2.5 pr-2">
                  {workflows.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">
                      No workflow history found.
                    </div>
                  ) : (
                    workflows.map((wf) => {
                      const isActive = activeWorkflow?.id === wf.id;
                      return (
                        <div
                          key={wf.id}
                          onClick={() => fetchWorkflowDetail(wf.id)}
                          className={`p-3.5 rounded-xl border transition cursor-pointer text-left ${isActive
                              ? "bg-slate-800/40 border-indigo-500/50 hover:bg-slate-800/60"
                              : "bg-slate-950 border-slate-900 hover:border-slate-800 hover:bg-slate-950/80"
                            }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-500 font-mono">
                                ID: #{wf.id}
                              </span>
                              <button
                                onClick={(e) => handleDeleteWorkflow(wf.id, e)}
                                className="text-slate-500 hover:text-rose-400 transition p-0.5 rounded hover:bg-slate-800/80"
                                title={`Delete Workflow #${wf.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${wf.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                                wf.status === "pending_approval" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                                wf.status === "pending_approval" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                                  wf.status === "rejected" ? "bg-slate-500/10 text-slate-400 border border-slate-500/20" :
                                    "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              }`}>
                              {wf.status === "pending_approval" ? "Pending Approval" : wf.status === "rejected" ? "Rejected" : wf.status}
                            </span>
                          </div>

                          <p className="text-sm font-medium text-slate-300 line-clamp-1 mb-2">
                            {wf.task_query}
                          </p>

                          <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {wf.latency_ms > 0 ? `${(wf.latency_ms / 1000).toFixed(2)}s` : "-"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Coins className="w-3 h-3 text-slate-500" />
                              {wf.tokens_used > 0 ? `${wf.tokens_used} tokens` : "-"}
                            </span>
                            <span>
                              {new Date(wf.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            {/* Right Side: Execution Flow, Inspector, & Preview */}
            <section className="lg:col-span-7 flex flex-col gap-6">
              {/* Notification Feedback Banners */}
              {successMsg && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span className="text-left">{successMsg}</span>
                </div>
              )}
              {errorMsg && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="text-left">{errorMsg}</span>
                </div>
              )}

              {activeWorkflow ? (
                <div className="flex flex-col gap-6">

                  {/* Pipeline Monitor Card */}
                  <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm flex flex-col gap-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <TrendingUp className="w-5 h-5" />
                        <h3 className="font-semibold text-lg text-slate-100">Live Agent Pipeline Tracker</h3>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">Workflow ID: #{activeWorkflow.id}</span>
                    </div>

                    {/* Stepper Pipeline */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 relative">

                      {/* Step 1: SQL Generation */}
                      <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${generateStep?.is_success
                          ? "bg-indigo-950/10 border-indigo-500/30 text-indigo-300"
                          : "bg-slate-950 border-slate-900 opacity-60"
                        }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase">Step 1</span>
                          <Terminal className={`w-4 h-4 ${generateStep?.is_success ? "text-indigo-400" : "text-slate-650"}`} />
                        </div>
                        <h4 className="font-semibold text-sm text-slate-200">SQL Translation</h4>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {generateStep?.is_success ? "Success" : "Pending"}
                        </span>
                      </div>

                      {/* Step 2: DB Execution */}
                      <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${executeStep?.is_success
                          ? "bg-indigo-950/10 border-indigo-500/30 text-indigo-300"
                          : "bg-slate-950 border-slate-900 opacity-60"
                        }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase">Step 2</span>
                          <Database className={`w-4 h-4 ${executeStep?.is_success ? "text-indigo-400" : "text-slate-650"}`} />
                        </div>
                        <h4 className="font-semibold text-sm text-slate-200">Supabase Execution</h4>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {executeStep?.is_success ? "Executed" : "Pending"}
                        </span>
                      </div>

                      {/* Step 3: Google Sheets */}
                      <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${sheetsStep?.is_success
                          ? "bg-indigo-950/10 border-indigo-500/30 text-indigo-300"
                          : "bg-slate-950 border-slate-900 opacity-60"
                        }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase">Step 3</span>
                          <FileSpreadsheet className={`w-4 h-4 ${sheetsStep?.is_success ? "text-indigo-400" : "text-slate-650"}`} />
                        </div>
                        <h4 className="font-semibold text-sm text-slate-200">Google Sheets Log</h4>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {sheetsStep?.is_success ? "Logged" : "Pending"}
                        </span>
                      </div>

                      {/* Step 4: Discord Embed Draft */}
                      <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${discordStep?.is_success
                          ? "bg-indigo-950/10 border-indigo-500/30 text-indigo-300"
                          : "bg-slate-950 border-slate-900 opacity-60"
                        }`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase">Step 4</span>
                          <MessageSquare className={`w-4 h-4 ${discordStep?.is_success ? "text-indigo-400" : "text-slate-655"}`} />
                        </div>
                        <h4 className="font-semibold text-sm text-slate-200">Discord Drafting</h4>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {discordStep?.is_success ? "Drafted" : "Pending"}
                        </span>
                      </div>

                    </div>

                    {/* Workflow Metrics Banner */}
                    <div className="flex flex-wrap gap-4 items-center justify-between bg-slate-950 border border-slate-900 rounded-xl p-3 text-xs font-mono text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Total Latency:</span>
                        <strong className="text-slate-200">
                          {activeWorkflow.latency_ms > 0 ? `${activeWorkflow.latency_ms} ms` : "N/A"}
                        </strong>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-slate-500" />
                        <span>LLM API Cost (Tokens):</span>
                        <strong className="text-slate-200">
                          {activeWorkflow.tokens_used > 0 ? activeWorkflow.tokens_used : "N/A"}
                        </strong>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${activeWorkflow.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                            activeWorkflow.status === "pending_approval" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                              activeWorkflow.status === "rejected" ? "bg-slate-500/10 text-slate-450 border border-slate-500/20" :
                                "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}>
                          {activeWorkflow.status === "pending_approval" ? "Pending Approval" : activeWorkflow.status}
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Data & SQL Inspector Tab View */}
                  <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm flex flex-col gap-4">

                    {/* Tabs Switcher */}
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => setActiveTab("pipeline")}
                          className={`text-sm font-semibold pb-2 border-b-2 transition ${activeTab === "pipeline"
                              ? "border-indigo-500 text-indigo-400"
                              : "border-transparent text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <Terminal className="w-4 h-4" /> SQL Code & Console
                          </span>
                        </button>
                        <button
                          onClick={() => setActiveTab("data")}
                          className={`text-sm font-semibold pb-2 border-b-2 transition ${activeTab === "data"
                              ? "border-indigo-500 text-indigo-400"
                              : "border-transparent text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <Table className="w-4 h-4" /> Data Inspector
                          </span>
                        </button>
                      </div>

                      {sheetsStep?.is_success && (
                        <a
                          href={sheetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          Open Google Sheets
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {/* Tab 1: SQL Code console */}
                    {activeTab === "pipeline" && (
                      <div className="flex flex-col gap-3">
                        <div className="bg-slate-950 rounded-xl p-4 border border-slate-850 font-mono text-xs overflow-x-auto relative">
                          <code className="text-emerald-400 block whitespace-pre text-left">
                            {generateStep?.sql_generated || "-- No SQL statement generated --"}
                          </code>
                        </div>

                        <div className="flex flex-col gap-1.5 text-xs text-slate-400 font-medium">
                          <span className="text-slate-500 uppercase text-[10px] tracking-wider font-bold text-left">Execution Log:</span>
                          <p className="text-left font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-900 text-slate-300">
                            {executeStep?.execution_result || "Waiting for execution..."}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Tab 2: Dynamic Data Inspector Table */}
                    {activeTab === "data" && (
                      <div className="overflow-x-auto max-h-[300px] border border-slate-900 rounded-xl bg-slate-950">
                        {queryResults.length === 0 ? (
                          <div className="text-center py-8 text-slate-500 text-xs">
                            No query database results found in this execution step.
                          </div>
                        ) : (
                          (() => {
                            const columns = Object.keys(queryResults[0]);
                            return (
                              <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 border-b border-slate-900 sticky top-0 backdrop-blur-md">
                                  <tr>
                                    {columns.map((col) => (
                                      <th key={col} className="px-4 py-3 capitalize font-semibold tracking-wider">
                                        {col.replace(/_/g, " ")}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {queryResults.map((row, rowIndex) => (
                                    <tr
                                      key={rowIndex}
                                      className="border-b border-slate-900 hover:bg-slate-900/10 text-xs transition"
                                    >
                                      {columns.map((col) => {
                                        const val = row[col];
                                        let displayVal = String(val === null || val === undefined ? "-" : val);
                                        
                                        // Dynamic Formatting
                                        const isNumber = typeof val === "number" || (!isNaN(Number(val)) && val !== "");
                                        const isDate = col.includes("date") || col.includes("time") || col.includes("_at");

                                        if (isDate && val) {
                                          try {
                                            displayVal = new Date(val).toLocaleString([], {
                                              hour: '2-digit',
                                              minute: '2-digit',
                                              second: '2-digit',
                                              day: '2-digit',
                                              month: '2-digit',
                                              year: 'numeric'
                                            });
                                          } catch {
                                            // ignore
                                          }
                                        } else if (isNumber && typeof val === "number") {
                                          displayVal = val.toLocaleString();
                                        }

                                        return (
                                          <td key={col} className="px-4 py-3 text-left font-medium text-slate-300">
                                            {col === "stock_quantity" ? (
                                              <span className={`px-2 py-0.5 rounded font-mono font-bold ${val <= 5
                                                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/25"
                                                  : "bg-amber-500/10 text-amber-400 border border-amber-500/25"
                                                }`}>
                                                {displayVal}
                                              </span>
                                            ) : (
                                              displayVal
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()
                        )}
                      </div>
                    )}

                  </div>

                  {/* Discord Embed Preview Container */}
                  {discordEmbed && (
                    <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-indigo-400">
                          <MessageSquare className="w-5 h-5" />
                          <h3 className="font-semibold text-lg text-slate-100">Discord Notification Preview</h3>
                        </div>
                      </div>

                      {/* Real Discord Embed Styling */}
                      <div
                        className="bg-[#2f3136] rounded-md p-4 text-left font-sans shadow-lg max-w-[600px] w-full border-l-4"
                        style={{ borderLeftColor: discordEmbed.embeds?.[0]?.color ? `#${discordEmbed.embeds[0].color.toString(16).padStart(6, '0')}` : '#ff4747' }}
                      >
                        {discordEmbed.embeds && discordEmbed.embeds[0] && (
                          <div className="flex flex-col gap-2.5">
                            <div className="text-sm font-bold text-white hover:underline cursor-pointer">
                              {discordEmbed.embeds[0].title}
                            </div>

                            <div className="text-xs text-[#dcddde] whitespace-pre-wrap leading-relaxed">
                              {/* Parse markdown bold and links for rendering in preview */}
                              {discordEmbed.embeds[0].description.split("\n").map((line: string, i: number) => {
                                if (line.includes("**") || line.includes("[")) {
                                  return (
                                    <p key={i} className="mb-1">
                                      {line.replace(/\*\*/g, "")}
                                    </p>
                                  );
                                }
                                return <p key={i} className="mb-1">{line}</p>;
                              })}
                            </div>

                            {discordEmbed.embeds[0].fields && (
                              <div className="grid grid-cols-1 gap-2 mt-1">
                                {discordEmbed.embeds[0].fields.map((f: DiscordEmbedField, i: number) => (
                                  <div key={i} className="p-2 bg-[#202225] rounded border border-transparent">
                                    <div className="text-xs font-bold text-white mb-0.5">{f.name}</div>
                                    <div className="text-xs text-[#00aff4] hover:underline cursor-pointer">
                                      {f.value.replace(/\[.*?\]\((.*?)\)/, "$1")}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="text-[10px] text-[#72767d] flex items-center justify-between mt-2 pt-2 border-t border-[#36393f]">
                              <span>{discordEmbed.embeds[0].footer?.text}</span>
                              <span>
                                {discordEmbed.embeds[0].timestamp ? new Date(discordEmbed.embeds[0].timestamp).toLocaleDateString() : ""}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Human-in-the-Loop Actions */}
                      <div className="flex items-center justify-end gap-3 mt-2">
                        {activeWorkflow.status === "pending_approval" ? (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={handleReject}
                              disabled={isRejecting || isApproving}
                              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-300 hover:text-white font-semibold text-sm rounded-xl transition flex items-center gap-2 border border-slate-750"
                            >
                              {isRejecting ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Rejecting...
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="w-4 h-4 text-slate-400" />
                                  Reject & Cancel
                                </>
                              )}
                            </button>
                            <button
                              onClick={handleApprove}
                              disabled={isApproving || isRejecting}
                              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-semibold text-sm rounded-xl transition flex items-center gap-2 hover:shadow-lg hover:shadow-emerald-500/20"
                            >
                              {isApproving ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Dispatching...
                                </>
                              ) : (
                                <>
                                  <Check className="w-4 h-4 font-extrabold" />
                                  Approve & Send to Discord
                                </>
                              )}
                            </button>
                          </div>
                        ) : activeWorkflow.status === "completed" ? (
                          <div className="px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-emerald-400 text-xs font-bold flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" />
                            Approved & Sent to Discord Channel
                          </div>
                        ) : activeWorkflow.status === "rejected" ? (
                          <div className="px-5 py-2.5 bg-slate-500/10 border border-slate-500/25 rounded-xl text-slate-400 text-xs font-bold flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4" />
                            Workflow rejected & cancelled
                          </div>
                        ) : (
                          <div className="px-5 py-2.5 bg-rose-500/10 border border-rose-500/25 rounded-xl text-rose-400 text-xs font-bold flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4" />
                            Workflow failed
                          </div>
                        )}
                      </div>

                    </div>
                  )}

                </div>
              ) : isLoading ? (
                // Premium Loader View
                <div className="bg-slate-900/60 border border-slate-850 rounded-2xl p-8 backdrop-blur-sm flex-1 flex flex-col items-center justify-center text-center min-h-[500px] gap-8 shadow-xl">
                  {/* Glowing Spinner */}
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-indigo-500/10 border-t-indigo-500 animate-spin" />
                    <div className="absolute inset-0 w-16 h-16 rounded-full border border-indigo-500/30 animate-pulse scale-110" />
                  </div>

                  <div className="flex flex-col gap-2 max-w-md">
                    <h4 className="font-bold text-lg text-slate-100">
                      Executing Agent Pipeline...
                    </h4>
                    <p className="text-xs text-slate-400">
                      The LangGraph state machine is processing your request. Please wait while the agents collaborate.
                    </p>
                  </div>

                  {/* Execution Steps Loader */}
                  <div className="w-full max-w-md bg-slate-950 border border-slate-900 rounded-xl p-5 flex flex-col gap-4 text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold animate-pulse">1</div>
                      <div className="flex-1">
                        <h5 className="text-xs font-semibold text-slate-200">Text-to-SQL Translation</h5>
                        <p className="text-[10px] text-slate-500">Converting natural Thai query into PostgreSQL</p>
                      </div>
                      <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded animate-pulse">Running</span>
                    </div>

                    <div className="h-px bg-slate-900" />

                    <div className="flex items-center gap-3 opacity-50">
                      <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold">2</div>
                      <div className="flex-1">
                        <h5 className="text-xs font-semibold text-slate-350">Supabase Execution</h5>
                        <p className="text-[10px] text-slate-500">Querying live database records</p>
                      </div>
                      <span className="text-[10px] bg-slate-800 text-slate-500 px-2 py-0.5 rounded">Pending</span>
                    </div>

                    <div className="h-px bg-slate-900" />

                    <div className="flex items-center gap-3 opacity-50">
                      <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold">3</div>
                      <div className="flex-1">
                        <h5 className="text-xs font-semibold text-slate-350">Google Sheets Logging</h5>
                        <p className="text-[10px] text-slate-500">Appending results to Google Sheet</p>
                      </div>
                      <span className="text-[10px] bg-slate-800 text-slate-500 px-2 py-0.5 rounded">Pending</span>
                    </div>

                    <div className="h-px bg-slate-900" />

                    <div className="flex items-center gap-3 opacity-50">
                      <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold">4</div>
                      <div className="flex-1">
                        <h5 className="text-xs font-semibold text-slate-350">Discord Webhook Drafting</h5>
                        <p className="text-[10px] text-slate-500">Preparing rich notification payload</p>
                      </div>
                      <span className="text-[10px] bg-slate-800 text-slate-500 px-2 py-0.5 rounded">Pending</span>
                    </div>
                  </div>
                </div>
              ) : (
                // Premium Onboarding/Empty State View
                <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-8 backdrop-blur-sm flex-1 flex flex-col items-center justify-center text-center min-h-[500px] gap-8 shadow-xl">
                  <div className="p-4 bg-indigo-600/10 rounded-2xl border border-indigo-500/20 text-indigo-400">
                    <Layers className="w-10 h-10 animate-pulse" />
                  </div>
                  
                  <div className="flex flex-col gap-2 max-w-sm">
                    <h4 className="font-bold text-lg text-slate-100">
                      AutoAgent Control Center
                    </h4>
                    <p className="text-xs text-slate-400">
                      Ready to execute multi-agent workflows. Start by running a query or select an existing execution from the logs history.
                    </p>
                  </div>

                  {/* Step Guide Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl text-left mt-2">
                    <div className="p-4 bg-slate-950/50 border border-slate-850 rounded-xl hover:border-slate-800 transition">
                      <div className="flex items-center gap-2 text-indigo-400 mb-2">
                        <Play className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Step 1</span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-200 mb-1">Trigger Command</h5>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Input a natural Thai request or use a Quick Prompt on the left.
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950/50 border border-slate-850 rounded-xl hover:border-slate-800 transition">
                      <div className="flex items-center gap-2 text-indigo-400 mb-2">
                        <Terminal className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Step 2</span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-200 mb-1">Verify Pipeline</h5>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Inspect translated SQL, live query results, and generated sheet logs.
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950/50 border border-slate-850 rounded-xl hover:border-slate-800 transition">
                      <div className="flex items-center gap-2 text-indigo-400 mb-2">
                        <MessageSquare className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Step 3</span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-200 mb-1">Approve & Dispatch</h5>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Preview the Discord webhook embed card and click dispatch to approve.
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-6 text-left">
            {/* Header banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/40 border border-slate-900 p-6 rounded-2xl backdrop-blur-sm shadow-xl">
              <div>
                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-400 animate-pulse" />
                  Observability & Performance Analytics
                </h2>
                <p className="text-xs text-slate-400 mt-1">Real-time telemetry, model tokens consumption, and database query status metrics.</p>
              </div>
              <button
                onClick={fetchMetrics}
                className="self-start md:self-auto px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-all flex items-center gap-1.5 active:scale-[0.98]"
              >
                <History className="w-3.5 h-3.5" />
                Sync Telemetry
              </button>
            </div>

            {/* KPI Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">

              {/* Card 1: Total Runs */}
              <div className="bg-slate-900/60 border border-slate-900 p-5 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-slate-850 transition-all">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform" />
                <div className="flex flex-col gap-1 z-10">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Operations Runs</span>
                  <span className="text-2xl font-black text-slate-100 font-mono">{metrics?.total_runs || 0}</span>
                  <span className="text-[10px] text-slate-405 mt-0.5">Total pipeline invocations</span>
                </div>
                <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400 z-10 border border-indigo-500/15">
                  <Layers className="w-5 h-5" />
                </div>
              </div>

              {/* Card 2: Total Tokens */}
              <div className="bg-slate-900/60 border border-slate-900 p-5 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-slate-850 transition-all">
                <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform" />
                <div className="flex flex-col gap-1 z-10">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">LLM Tokens Consumed</span>
                  <span className="text-2xl font-black text-slate-100 font-mono">{(metrics?.total_tokens || 0).toLocaleString()}</span>
                  <span className="text-[10px] text-slate-405 mt-0.5">Gemini 3.1 Flash Lite API volume</span>
                </div>
                <div className="p-3 bg-violet-500/10 rounded-xl text-violet-400 z-10 border border-violet-500/15">
                  <Coins className="w-5 h-5" />
                </div>
              </div>

              {/* Card 3: Avg Latency */}
              <div className="bg-slate-900/60 border border-slate-900 p-5 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-slate-850 transition-all">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform" />
                <div className="flex flex-col gap-1 z-10">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Average Pipeline Latency</span>
                  <span className="text-2xl font-black text-slate-100 font-mono">
                    {metrics ? `${(metrics.avg_latency_ms / 1000).toFixed(2)}s` : "0.00s"}
                  </span>
                  <span className="text-[10px] text-slate-405 font-mono mt-0.5">
                    {metrics ? `${metrics.avg_latency_ms.toLocaleString()} ms` : "0 ms"}
                  </span>
                </div>
                <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 z-10 border border-emerald-500/15">
                  <Clock className="w-5 h-5" />
                </div>
              </div>

              {/* Card 4: Success Rate */}
              <div className="bg-slate-900/60 border border-slate-900 p-5 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden group hover:border-slate-850 transition-all">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform" />
                <div className="flex flex-col gap-1 z-10">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Overall Success Rate</span>
                  <span className="text-2xl font-black text-slate-100 font-mono">
                    {metrics ? `${metrics.success_rate}%` : "100%"}
                  </span>
                  <span className="text-[10px] text-slate-405 mt-0.5">
                    {metrics ? `${metrics.completed_runs} of ${metrics.completed_runs + metrics.failed_runs + metrics.rejected_runs} runs` : "0 of 0 runs"}
                  </span>
                </div>
                <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 z-10 border border-amber-500/15">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

            </div>

            {/* Visual Graphs Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

              {/* Left: Donut Success Rate */}
              <div className="lg:col-span-4 bg-slate-900/60 border border-slate-900 p-6 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col gap-5">
                <h3 className="font-bold text-sm text-slate-350 uppercase tracking-wider border-b border-slate-800 pb-2">
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
                      <circle
                        cx="60"
                        cy="60"
                        r="50"
                        fill="transparent"
                        stroke="#1e293b"
                        strokeWidth="10"
                      />

                      {(() => {
                        const total = (metrics?.completed_runs || 0) + (metrics?.pending_runs || 0) + (metrics?.failed_runs || 0) + (metrics?.rejected_runs || 0);
                        if (total === 0) {
                          return (
                            <circle
                              cx="60"
                              cy="60"
                              r="50"
                              fill="transparent"
                              stroke="#334155"
                              strokeWidth="10"
                            />
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
                      <span className="text-2xl font-black text-slate-100 font-mono">
                        {metrics ? `${metrics.success_rate}%` : "100%"}
                      </span>
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

              {/* Right: Trend Graphs */}
              <div className="lg:col-span-8 bg-slate-900/60 border border-slate-900 p-6 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col gap-5">
                <h3 className="font-bold text-sm text-slate-350 uppercase tracking-wider border-b border-slate-800 pb-2">
                  Performance Trends (Last 10 Executions)
                </h3>

                {(() => {
                  const trendData = [...workflows].reverse().slice(-10);
                  if (trendData.length === 0) {
                    return (
                      <div className="flex-1 flex items-center justify-center text-slate-550 text-sm py-12">
                        No execution data available for trends.
                      </div>
                    );
                  }

                  const width = 500;
                  const height = 110;
                  const padding = 15;

                  // Calculate Latency line coordinates
                  const maxLatency = Math.max(...trendData.map(d => d.latency_ms), 1000);
                  const latencyPoints = trendData.map((d, index) => {
                    const x = padding + (index * (width - 2 * padding)) / Math.max(trendData.length - 1, 1);
                    const y = height - padding - (d.latency_ms / maxLatency) * (height - 2 * padding);
                    return { x, y, val: d.latency_ms, id: d.id };
                  });

                  const latencyPathStr = latencyPoints.length > 0
                    ? `M ${latencyPoints[0].x} ${latencyPoints[0].y} ` + latencyPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ")
                    : "";
                  const latencyAreaStr = latencyPoints.length > 0
                    ? `${latencyPathStr} L ${latencyPoints[latencyPoints.length - 1].x} ${height - padding} L ${latencyPoints[0].x} ${height - padding} Z`
                    : "";

                  // Calculate Token bar properties
                  const maxTokens = Math.max(...trendData.map(d => d.tokens_used), 500);
                  const barWidth = Math.min(25, (width - 2 * padding) / (trendData.length * 1.5));
                  const barSpacing = (width - 2 * padding) / Math.max(trendData.length, 1);

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                      {/* Latency Line Graph */}
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
                          <span>Latency History (ms)</span>
                          <span className="text-[10px] text-slate-500 font-mono">Max: {maxLatency.toLocaleString()} ms</span>
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
                            <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#1e293b" strokeDasharray="2 2" />
                            <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#1e293b" strokeDasharray="2 2" />
                            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" />

                            {/* Area fill */}
                            {latencyAreaStr && <path d={latencyAreaStr} fill="url(#latencyGrad)" />}
                            {/* Trend Line */}
                            {latencyPathStr && <path d={latencyPathStr} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />}

                            {/* Dots */}
                            {latencyPoints.map((p, idx) => (
                              <g key={idx} className="group/dot cursor-pointer">
                                <circle cx={p.x} cy={p.y} r="4" fill="#022c22" stroke="#10b981" strokeWidth="2" />
                                <circle cx={p.x} cy={p.y} r="8" fill="#10b981" fillOpacity="0" className="hover:fill-opacity-20 transition-all" />
                                <title>Run #{p.id}: {p.val.toLocaleString()} ms</title>
                              </g>
                            ))}
                          </svg>
                        </div>
                      </div>

                      {/* Token Bar Graph */}
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
                          <span>Tokens Consumption</span>
                          <span className="text-[10px] text-slate-500 font-mono">Max: {maxTokens.toLocaleString()} tokens</span>
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
                            <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#1e293b" strokeDasharray="2 2" />
                            <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#1e293b" strokeDasharray="2 2" />
                            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" />

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
                                  <title>Run #{d.id}: {d.tokens_used.toLocaleString()} tokens</title>
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                      </div>

                    </div>
                  );
                })()}

              </div>

            </div>

            {/* Recent Executions Logs Table */}
            <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm shadow-xl flex flex-col gap-4">
              <h3 className="font-bold text-sm text-slate-350 uppercase tracking-wider border-b border-slate-800 pb-2">
                Telemetry Log Streams
              </h3>

              <div className="overflow-x-auto rounded-xl border border-slate-900 bg-slate-950/40">
                {workflows.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    No run logs detected in database.
                  </div>
                ) : (
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/80 border-b border-slate-900">
                      <tr>
                        <th className="px-4 py-3 text-center">Run ID</th>
                        <th className="px-4 py-3">Task Instruction / Prompt</th>
                        <th className="px-4 py-3 text-center">Outcome Status</th>
                        <th className="px-4 py-3 text-right">Latency</th>
                        <th className="px-4 py-3 text-right">Tokens Used</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workflows.map((wf) => (
                        <tr
                          key={wf.id}
                          className="border-b border-slate-900/60 hover:bg-slate-900/10 text-xs transition font-medium"
                        >
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-500">
                            #{wf.id}
                          </td>
                          <td className="px-4 py-3.5 text-slate-200 font-semibold max-w-[320px] truncate text-left">
                            {wf.task_query}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${wf.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                                wf.status === "pending_approval" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                                  "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              }`}>
                              {wf.status === "pending_approval" ? "Pending Approval" : wf.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-slate-300">
                            {wf.latency_ms > 0 ? `${(wf.latency_ms / 1000).toFixed(2)}s` : "-"}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-slate-300">
                            {wf.tokens_used > 0 ? wf.tokens_used.toLocaleString() : "-"}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  fetchWorkflowDetail(wf.id);
                                  setCurrentView("sandbox");
                                }}
                                className="px-2.5 py-1 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded border border-indigo-500/20 text-[10px] font-bold uppercase transition-all"
                              >
                                Inspect Run
                              </button>
                              <button
                                onClick={(e) => handleDeleteWorkflow(wf.id, e)}
                                className="p-1 bg-rose-600/10 hover:bg-rose-600 text-rose-450 hover:text-white rounded border border-rose-500/20 transition-all"
                                title={`Delete Run #${wf.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* System Architecture Walkthrough Guide */}
            <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm shadow-xl flex flex-col gap-4">
              <h3 className="font-bold text-sm text-slate-350 uppercase tracking-wider border-b border-slate-800 pb-2 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Pipeline Integration Blueprint
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 relative">

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col gap-2 relative">
                  <div className="text-indigo-400 font-mono text-xs font-bold uppercase">Phase 1</div>
                  <h4 className="font-bold text-xs text-slate-200">Natural Query Input</h4>
                  <p className="text-[10px] text-slate-500">Natural language command (Thai) triggers the FastAPI agent pipeline entry point.</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col gap-2 relative">
                  <div className="text-indigo-400 font-mono text-xs font-bold uppercase">Phase 2</div>
                  <h4 className="font-bold text-xs text-slate-200">SQL Translation</h4>
                  <p className="text-[10px] text-slate-500">Gemini LLM compiles target Thai statement into valid PostgreSQL commands.</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col gap-2 relative">
                  <div className="text-indigo-400 font-mono text-xs font-bold uppercase">Phase 3</div>
                  <h4 className="font-bold text-xs text-slate-200">Supabase Execution</h4>
                  <p className="text-[10px] text-slate-500">FastAPI executes query safely, extracting critical low stock item records.</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col gap-2 relative">
                  <div className="text-indigo-400 font-mono text-xs font-bold uppercase">Phase 4</div>
                  <h4 className="font-bold text-xs text-slate-200">Google Sheets Logger</h4>
                  <p className="text-[10px] text-slate-500">Results are securely written to the shared report spreadsheet via Service Account.</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 flex flex-col gap-2 relative">
                  <div className="text-indigo-400 font-mono text-xs font-bold uppercase">Phase 5</div>
                  <h4 className="font-bold text-xs text-slate-200">Human Approval Gate</h4>
                  <p className="text-[10px] text-slate-500">Dashboard prompts human validation. On click, Discord webhook triggers output card delivery.</p>
                </div>

              </div>
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <p>© 2026 AutoAgent-Dashboard. Powered by Supabase, Gemini, and LangGraph.</p>
      </footer>
    </div>
  );
}
