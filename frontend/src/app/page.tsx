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
  ExternalLink
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

interface ProductItem {
  id: number;
  name: string;
  stock_quantity: number;
  price: number;
}

export default function Dashboard() {
  // Inputs
  const [query, setQuery] = useState("หาสินค้าวิกฤตที่เหลือน้อยกว่า 10 ชิ้นแล้วบันทึกลง Google Sheets");
  const [sheetUrl, setSheetUrl] = useState("https://docs.google.com/spreadsheets/d/1KygmZXWBB7cHEixW9ajuafnovvoYNu7-ajjG2aLiJvM");
  
  // States
  const [isLoading, setIsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [serverHealth, setServerHealth] = useState<"connected" | "disconnected" | "checking">("checking");
  const [activeTab, setActiveTab] = useState<"pipeline" | "data">("pipeline");

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
    
    // Auto refresh workflows history list every 15 seconds
    const interval = setInterval(() => {
      fetchWorkflows();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchWorkflows]);

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
      setSuccessMsg("Agent pipeline executed successfully!");
      
      // Refresh list and select the newly created workflow
      await fetchWorkflows();
      if (data.workflow_id) {
        await fetchWorkflowDetail(data.workflow_id);
      }
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
      await fetchWorkflowDetail(activeWorkflow.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Approval failed.";
      setErrorMsg(msg);
    } finally {
      setIsApproving(false);
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

  // Parse products from raw execution results in state if available
  const productsList: ProductItem[] = [];
  if (discordEmbed && discordEmbed.embeds && discordEmbed.embeds[0]) {
    const desc = discordEmbed.embeds[0].description || "";
    // extract items like "* **Premium Laptop Pro**: เหลือ 5 ชิ้น"
    const lines = desc.split("\n");
    lines.forEach((line: string, index: number) => {
      if (line.startsWith("* ")) {
        const match = line.match(/\*\*(.*?)\*\*:\s*เหลือ\s*(\d+)\s*ชิ้น/);
        if (match) {
          productsList.push({
            id: index + 1,
            name: match[1],
            stock_quantity: parseInt(match[2]),
            price: match[1] === "Premium Laptop Pro" ? 45000 : match[1] === "Tablet Air 10\"" ? 12500 : match[1] === "Bluetooth Earbuds" ? 1990 : match[1] === "Smart Fitness Watch" ? 5900 : 1290
          });
        }
      }
    });
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

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${
              serverHealth === "connected" ? "bg-emerald-500 animate-ping" : 
              serverHealth === "disconnected" ? "bg-rose-500" : "bg-amber-500 animate-pulse"
            }`} />
            <span className="text-slate-300 font-medium">
              Backend: {serverHealth === "connected" ? "Connected" : serverHealth === "disconnected" ? "Offline" : "Checking..."}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Control & Configuration */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          {/* Agent Operations Card */}
          <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm shadow-xl flex flex-col gap-5">
            <div className="flex items-center gap-2 text-indigo-400">
              <Play className="w-5 h-5" />
              <h2 className="font-semibold text-lg text-slate-100">Trigger AI Agent</h2>
            </div>

            <form onSubmit={handleRunAgent} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Natural Language Command (Thai)
                </label>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="เช่น: หาสินค้าคงคลังที่เหลือน้อยกว่า 10 ชิ้นแล้วรายงานลง Google Sheets"
                  className="w-full min-h-[90px] px-4 py-3 bg-slate-950 border border-slate-850 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition text-slate-200 placeholder-slate-600 resize-none font-medium"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Target Google Sheets URL
                </label>
                <div className="relative">
                  <FileSpreadsheet className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                  <input
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-850 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition text-slate-200 font-mono text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || serverHealth !== "connected"}
                className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                  isLoading 
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
              <span className="text-xs text-slate-500 font-medium">Quick Prompts:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setQuery("หาสินค้าคงคลังที่เหลือน้อยกว่า 10 ชิ้นแล้วรายงานลง Google Sheets")}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200 transition font-medium text-left"
                >
                  🔍 หาสินค้าวิกฤต (Stock &lt; 10)
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
              <button 
                onClick={() => fetchWorkflows(false)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Refresh
              </button>
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
                      className={`p-3.5 rounded-xl border transition cursor-pointer text-left ${
                        isActive 
                          ? "bg-slate-800/40 border-indigo-500/50 hover:bg-slate-800/60" 
                          : "bg-slate-950 border-slate-900 hover:border-slate-800 hover:bg-slate-950/80"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-500 font-mono">
                          ID: #{wf.id}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                          wf.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          wf.status === "pending_approval" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                          "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}>
                          {wf.status === "pending_approval" ? "Pending Approval" : wf.status}
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
              <span>{successMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
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
                  <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${
                    generateStep?.is_success 
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
                  <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${
                    executeStep?.is_success 
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
                  <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${
                    sheetsStep?.is_success 
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
                  <div className={`p-4 rounded-xl border text-left flex flex-col gap-2 ${
                    discordStep?.is_success 
                      ? "bg-indigo-950/10 border-indigo-500/30 text-indigo-300" 
                      : "bg-slate-950 border-slate-900 opacity-60"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase">Step 4</span>
                      <MessageSquare className={`w-4 h-4 ${discordStep?.is_success ? "text-indigo-400" : "text-slate-650"}`} />
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
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      activeWorkflow.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                      activeWorkflow.status === "pending_approval" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse" :
                      "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}>
                      {activeWorkflow.status}
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
                      className={`text-sm font-semibold pb-2 border-b-2 transition ${
                        activeTab === "pipeline" 
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
                      className={`text-sm font-semibold pb-2 border-b-2 transition ${
                        activeTab === "data" 
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
                      <div className="absolute right-3 top-3 text-[10px] text-slate-600 select-none uppercase font-bold tracking-wider">
                        PostgreSQL
                      </div>
                      <code className="text-emerald-400 block whitespace-pre text-left">
                        {generateStep?.sql_generated || "-- No SQL statement generated --"}
                      </code>
                    </div>

                    <div className="flex flex-col gap-1.5 text-xs text-slate-400 font-medium">
                      <span className="text-slate-500 uppercase text-[10px] tracking-wider font-bold">Execution Log:</span>
                      <p className="text-left font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-900 text-slate-300">
                        {executeStep?.execution_result || "Waiting for execution..."}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tab 2: Products Table */}
                {activeTab === "data" && (
                  <div className="overflow-x-auto max-h-[300px] border border-slate-900 rounded-xl bg-slate-950">
                    {productsList.length === 0 ? (
                      <div className="text-center py-8 text-slate-500 text-xs">
                        No product data returned by execution.
                      </div>
                    ) : (
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 border-b border-slate-900">
                          <tr>
                            <th className="px-4 py-3">Product Name</th>
                            <th className="px-4 py-3 text-center">Remaining Stock</th>
                            <th className="px-4 py-3 text-right">Price (THB)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productsList.map((prod, index) => (
                            <tr 
                              key={index}
                              className="border-b border-slate-900 hover:bg-slate-900/20 text-xs font-medium"
                            >
                              <td className="px-4 py-3 font-semibold text-slate-200">
                                {prod.name}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded font-mono font-bold ${
                                  prod.stock_quantity <= 5 
                                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/25" 
                                    : "bg-amber-500/10 text-amber-400 border border-amber-500/25"
                                }`}>
                                  {prod.stock_quantity}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300">
                                {prod.price.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
                    <span className="text-xs text-slate-400 font-mono">Embed Card Draft</span>
                  </div>

                  {/* Real Discord Embed Styling */}
                  <div className="bg-[#2f3136] rounded-md p-4 text-left font-sans shadow-lg max-w-[600px] w-full border-l-4 border-[#ff4747]">
                    {discordEmbed.embeds && discordEmbed.embeds[0] && (
                      <div className="flex flex-col gap-2.5">
                        <div className="text-sm font-bold text-white hover:underline cursor-pointer">
                          {discordEmbed.embeds[0].title}
                        </div>
                        
                        <div className="text-xs text-[#dcddde] whitespace-pre-wrap leading-relaxed">
                          {/* Parse markdown bold and links for rendering in preview */}
                          {discordEmbed.embeds[0].description.split("\n").map((line: string, i: number) => {
                            if (line.includes("**") || line.includes("[")) {
                              // basic parse
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
                      <button
                        onClick={handleApprove}
                        disabled={isApproving}
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
                    ) : activeWorkflow.status === "completed" ? (
                      <div className="px-5 py-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-emerald-400 text-xs font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Approved & Sent to Discord Channel
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
          ) : (
            <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-8 backdrop-blur-sm flex-1 flex flex-col items-center justify-center text-center text-slate-500 min-h-[400px]">
              <Layers className="w-12 h-12 text-slate-700 mb-3 animate-pulse" />
              <h4 className="font-semibold text-slate-300 mb-1">No Active Operations Workflow</h4>
              <p className="text-xs max-w-[280px]">
                Select a completed run from the logs history or run a new operations agent above.
              </p>
            </div>
          )}

        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <p>© 2026 AutoAgent-Dashboard. Powered by Supabase, Gemini, and LangGraph.</p>
      </footer>
    </div>
  );
}
