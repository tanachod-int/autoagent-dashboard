import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

from app.agent import run_data_agent, db_update_workflow
from app.discord_client import send_discord_webhook
from app.database import get_db_connection

# Load environment variables
load_dotenv()

app = FastAPI(
    title="AutoAgent Dashboard API",
    description="Backend API for AutoAgent Dashboard",
    version="1.0.0"
)

# CORS configuration to support Next.js frontend port (default: 3000)
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunAgentRequest(BaseModel):
    query: str
    sheet_url: Optional[str] = None


@app.get("/")
def read_root() -> dict[str, str]:
    """Root endpoint to check API status."""
    return {"status": "running", "message": "AutoAgent Dashboard API is online"}


@app.get("/health")
def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/api/agent/run")
def run_agent(payload: RunAgentRequest):
    """
    Run the LangGraph Text-to-SQL data agent.
    """
    if not payload.query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
        
    try:
        final_state = run_data_agent(payload.query, payload.sheet_url)
        if final_state.get("error"):
            return {
                "success": False,
                "workflow_id": final_state.get("workflow_id"),
                "error": final_state.get("error"),
                "sql": final_state.get("sql"),
                "metrics": {
                    "latency_ms": final_state.get("total_latency_ms"),
                    "tokens_used": final_state.get("total_tokens")
                }
            }
            
        return {
            "success": True,
            "workflow_id": final_state.get("workflow_id"),
            "sql": final_state.get("sql"),
            "query_results": final_state.get("query_results"),
            "sheet_url": final_state.get("sheet_url"),
            "discord_payload": final_state.get("discord_payload"),
            "metrics": {
                "latency_ms": final_state.get("total_latency_ms"),
                "tokens_used": final_state.get("total_tokens")
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent workflow execution failed: {str(e)}")


@app.post("/api/agent/approve/{workflow_id}")
def approve_workflow(workflow_id: int):
    """
    Approve the drafted notification and trigger the Discord Webhook.
    """
    conn = get_db_connection()
    discord_payload = None
    
    try:
        with conn.cursor() as cur:
            # Check workflow status
            cur.execute("SELECT status, task_query, tokens_used, latency_ms FROM agent_workflows WHERE id = %s;", (workflow_id,))
            wf = cur.fetchone()
            if not wf:
                raise HTTPException(status_code=404, detail="Workflow not found")
                
            status, query, tokens, latency = wf
            if status == "completed":
                return {"message": "Workflow has already been approved and completed"}
                
            # Fetch drafted Discord payload
            cur.execute(
                """
                SELECT execution_result 
                FROM workflow_steps 
                WHERE workflow_id = %s AND step_name = 'draft_discord' AND is_success = TRUE;
                """,
                (workflow_id,)
            )
            step = cur.fetchone()
            if not step or not step[0]:
                raise HTTPException(status_code=400, detail="No valid drafted Discord payload found for this workflow")
                
            try:
                discord_payload = json.loads(step[0])
            except Exception as json_err:
                raise HTTPException(status_code=500, detail=f"Failed to parse drafted Discord payload: {str(json_err)}")
                
        # Send Webhook
        success = send_discord_webhook(discord_payload)
        
        if success:
            # Update workflow status to completed
            db_update_workflow(workflow_id, "completed", tokens, latency)
            return {"success": True, "message": "Notification successfully sent to Discord"}
        else:
            db_update_workflow(workflow_id, "failed", tokens, latency)
            raise HTTPException(status_code=502, detail="Failed to send notification to Discord Webhook")
            
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing approval: {str(e)}")
    finally:
        conn.close()


@app.get("/api/agent/workflows")
def list_workflows(limit: int = 20):
    """
    List recent agent workflows for monitoring.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, task_query, status, tokens_used, latency_ms, created_at
                FROM agent_workflows
                ORDER BY created_at DESC
                LIMIT %s;
                """,
                (limit,)
            )
            rows = cur.fetchall()
            workflows = []
            for r in rows:
                workflows.append({
                    "id": r[0],
                    "task_query": r[1],
                    "status": r[2],
                    "tokens_used": r[3],
                    "latency_ms": r[4],
                    "created_at": r[5].isoformat() if r[5] else None
                })
            return workflows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list workflows: {str(e)}")
    finally:
        conn.close()


@app.get("/api/agent/workflows/{workflow_id}")
def get_workflow_details(workflow_id: int):
    """
    Get detailed logs and steps for a specific workflow.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # 1. Fetch workflow details
            cur.execute(
                """
                SELECT id, task_query, status, tokens_used, latency_ms, created_at
                FROM agent_workflows
                WHERE id = %s;
                """,
                (workflow_id,)
            )
            wf = cur.fetchone()
            if not wf:
                raise HTTPException(status_code=404, detail="Workflow not found")
                
            workflow_data = {
                "id": wf[0],
                "task_query": wf[1],
                "status": wf[2],
                "tokens_used": wf[3],
                "latency_ms": wf[4],
                "created_at": wf[5].isoformat() if wf[5] else None,
                "steps": []
            }
            
            # 2. Fetch steps
            cur.execute(
                """
                SELECT id, step_name, sql_generated, execution_result, is_success, created_at
                FROM workflow_steps
                WHERE workflow_id = %s
                ORDER BY created_at ASC;
                """,
                (workflow_id,)
            )
            steps_rows = cur.fetchall()
            for sr in steps_rows:
                workflow_data["steps"].append({
                    "id": sr[0],
                    "step_name": sr[1],
                    "sql_generated": sr[2],
                    "execution_result": sr[3],
                    "is_success": sr[4],
                    "created_at": sr[5].isoformat() if sr[5] else None
                })
                
            return workflow_data
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch workflow details: {str(e)}")
    finally:
        conn.close()
