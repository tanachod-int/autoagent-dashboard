import os
import json
import time
import logging
import secrets
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Security, status, Request, Depends, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

from app.agent import run_data_agent, db_update_workflow
from app.discord_client import send_discord_webhook
from app.database import get_db_connection

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

# --- Constants ---
SENDING_TIMEOUT_SECONDS = 300  # 5 minutes timeout for "sending" state

# Server-side in-memory session store (Suitable for single-instance deployments)
active_sessions: Dict[str, datetime] = {}

def create_session() -> str:
    token = secrets.token_hex(32)
    active_sessions[token] = datetime.now(timezone.utc) + timedelta(days=1)  # 24 hours expiration
    return token

def is_session_valid(token: str) -> bool:
    if not token or token not in active_sessions:
        return False
    if datetime.now(timezone.utc) > active_sessions[token]:
        del active_sessions[token]
        return False
    return True

# Session validation dependency
def verify_session(request: Request):
    env = os.getenv("ENV", "development")
    admin_password = os.getenv("ADMIN_PASSWORD")
    
    # In development, skip session authentication if ADMIN_PASSWORD is not configured
    if env != "production" and not admin_password:
        return None
        
    token = request.cookies.get("session_token")
    if not is_session_valid(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid or expired session cookie"
        )
    return token

def get_allowed_origins() -> list[str]:
    """Single source of truth for allowed origins, used by both CORS and CSRF."""
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    frontend_url = os.getenv("FRONTEND_URL")
    if frontend_url:
        for url in frontend_url.split(","):
            cleaned = url.strip()
            if cleaned and cleaned not in origins:
                origins.append(cleaned)
    return origins


# CSRF verification dependency for state-changing endpoints (POST, DELETE)
def verify_csrf(request: Request):
    env = os.getenv("ENV", "development")
    if env != "production":
        return

    allowed_origins = get_allowed_origins()

    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")

    if origin:
        if origin not in allowed_origins:
            raise HTTPException(status_code=403, detail="CSRF check failed: Origin not permitted")
    elif referer:
        matched = False
        for allowed in allowed_origins:
            if referer.startswith(allowed):
                matched = True
                break
        if not matched:
            raise HTTPException(status_code=403, detail="CSRF check failed: Referer not permitted")
    else:
        raise HTTPException(status_code=403, detail="CSRF check failed: Missing Origin/Referer headers")

# In-memory IP-based rate limiter (10 requests/minute per client IP)
rate_limit_records = defaultdict(list)

def rate_limiter(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    rate_limit_records[client_ip] = [t for t in rate_limit_records[client_ip] if now - t < 60]
    
    if len(rate_limit_records[client_ip]) >= 10:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Maximum 10 requests per minute."
        )
    rate_limit_records[client_ip].append(now)

# Dedicated rate limiter for authentication endpoints (5 login requests/minute)
login_attempts = defaultdict(list)

def login_rate_limiter(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    login_attempts[client_ip] = [t for t in login_attempts[client_ip] if now - t < 60]
    
    if len(login_attempts[client_ip]) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again after a minute."
        )
    login_attempts[client_ip].append(now)


class LoginRequest(BaseModel):
    password: str


class RunAgentRequest(BaseModel):
    query: str
    sheet_url: Optional[str] = None


app = FastAPI(
    title="AutoAgent Dashboard API",
    description="Backend API for AutoAgent Dashboard",
    version="1.0.0"
)

# CORS configuration — uses shared get_allowed_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler — log full error server-side, return generic message to client
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions and return a generic error message."""
    logger.exception("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again."},
    )


@app.on_event("startup")
def startup_event():
    env = os.getenv("ENV", "development")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if env == "production" and not admin_password:
        raise RuntimeError("CRITICAL ERROR: ADMIN_PASSWORD environment variable must be set in production mode!")
        
    print("[Startup] Running database migrations...")
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();"
            )
            print("[Startup] Database migrated: Added 'updated_at' column to 'agent_workflows' table.")
        conn.commit()
    except Exception as e:
        print(f"[Startup ERROR] Failed to run database migrations: {e}")
        if env == "production":
            raise RuntimeError(f"Database migration failed: {str(e)}")
    finally:
        conn.close()


@app.get("/")
def read_root() -> dict[str, str]:
    """Root endpoint to check API status."""
    return {"status": "running", "message": "AutoAgent Dashboard API is online"}


@app.get("/health")
def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/api/auth/login", dependencies=[Depends(login_rate_limiter), Depends(verify_csrf)])
def login(payload: LoginRequest, response: Response):
    expected_password = os.getenv("ADMIN_PASSWORD")
    env = os.getenv("ENV", "development")
    
    if not expected_password:
        if env == "production":
            raise HTTPException(status_code=500, detail="Server misconfiguration: ADMIN_PASSWORD not set")
        token = create_session()
    else:
        if not secrets.compare_digest(payload.password.encode(), expected_password.encode()):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = create_session()
        
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=(env == "production"),
        samesite="lax",
        max_age=86400
    )
    return {"success": True, "message": "Successfully authenticated"}


@app.post("/api/auth/logout", dependencies=[Depends(verify_csrf)])
def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token and token in active_sessions:
        del active_sessions[token]
    response.delete_cookie("session_token")
    return {"success": True, "message": "Successfully logged out"}


@app.get("/api/auth/me")
def me(request: Request):
    env = os.getenv("ENV", "development")
    admin_password = os.getenv("ADMIN_PASSWORD")
    
    if env != "production" and not admin_password:
        return {"authenticated": True, "username": "admin", "dev_mode": True}
        
    token = request.cookies.get("session_token")
    if is_session_valid(token):
        return {"authenticated": True, "username": "admin"}
        
    raise HTTPException(status_code=401, detail="Not authenticated")


@app.post("/api/agent/run", dependencies=[Depends(verify_session), Depends(verify_csrf), Depends(rate_limiter)])
def run_agent(payload: RunAgentRequest):
    """
    Run the LangGraph Text-to-SQL data agent.
    """
    if not payload.query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
        
    try:
        final_state = run_data_agent(payload.query, payload.sheet_url)
        if final_state.get("error"):
            raw_error = final_state["error"]
            # Preserve user-facing messages; sanitize internal errors
            user_facing_prefixes = ("คำถามของคุณอยู่นอกเหนือ", "Security Block:", "OUT_OF_SCOPE")
            if any(raw_error.startswith(prefix) for prefix in user_facing_prefixes):
                safe_error = raw_error
            else:
                logger.error("Agent workflow error (workflow_id=%s): %s", final_state.get("workflow_id"), raw_error)
                safe_error = "An error occurred during agent processing. Please try again."
            return {
                "success": False,
                "workflow_id": final_state.get("workflow_id"),
                "error": safe_error,
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
        logger.exception("Agent workflow execution failed")
        raise HTTPException(status_code=500, detail="Agent workflow execution failed. Please try again.")


@app.post("/api/agent/approve/{workflow_id}", dependencies=[Depends(verify_session), Depends(verify_csrf), Depends(rate_limiter)])
def approve_workflow(workflow_id: int):
    """
    Approve the drafted notification and trigger the Discord Webhook.
    """
    conn = get_db_connection()
    discord_payload = None
    # timezone already imported at module level
    
    try:
        # Step 1: Check status under FOR UPDATE lock to enforce idempotency
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, task_query, tokens_used, latency_ms, updated_at FROM agent_workflows WHERE id = %s FOR UPDATE;",
                (workflow_id,)
            )
            wf = cur.fetchone()
            if not wf:
                raise HTTPException(status_code=404, detail="Workflow not found")
                
            status, query, tokens, latency, updated_at = wf
            
            if status == "completed":
                return {"message": "Workflow has already been approved and completed"}
                
            # Handle sending state timeout
            if status == "sending":
                now = datetime.now(timezone.utc)
                if updated_at.tzinfo is not None:
                    time_diff = (now - updated_at).total_seconds()
                else:
                    time_diff = (now.replace(tzinfo=None) - updated_at).total_seconds()

                if time_diff <= SENDING_TIMEOUT_SECONDS:
                    raise HTTPException(
                        status_code=400,
                        detail="Workflow approval is already in progress. Please wait."
                    )
                else:
                    print(f"[Approve] Sending timeout expired ({time_diff}s ago). Resetting status and retrying.")
            elif status != "pending_approval":
                raise HTTPException(
                    status_code=400,
                    detail=f"Workflow cannot be approved because its current status is '{status}' (must be 'pending_approval')"
                )
                
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
            except (json.JSONDecodeError, TypeError) as json_err:
                logger.exception("Failed to parse drafted Discord payload for workflow %s", workflow_id)
                raise HTTPException(status_code=500, detail="Failed to parse drafted Discord payload")
                
            # Transition to sending state and commit immediately to release DB lock
            cur.execute(
                "UPDATE agent_workflows SET status = 'sending', updated_at = NOW() WHERE id = %s;",
                (workflow_id,)
            )
            conn.commit()
            
        # Step 2: Call the external webhook outside of the transaction lock (At-least-once delivery)
        success = send_discord_webhook(discord_payload)
        
        # Step 3: Commit the final state (completed or failed)
        with conn.cursor() as cur:
            new_status = "completed" if success else "failed"
            cur.execute(
                "UPDATE agent_workflows SET status = %s, tokens_used = %s, latency_ms = %s, updated_at = NOW() WHERE id = %s;",
                (new_status, tokens, latency, workflow_id)
            )
            conn.commit()
            
        if success:
            return {"success": True, "message": "Notification successfully sent to Discord"}
        else:
            raise HTTPException(status_code=502, detail="Failed to send notification to Discord Webhook")
            
    except HTTPException as he:
        conn.rollback()
        raise he
    except Exception as e:
        conn.rollback()
        logger.exception("Error processing approval for workflow %s", workflow_id)
        raise HTTPException(status_code=500, detail="Error processing approval. Please try again.")
    finally:
        conn.close()


@app.post("/api/agent/reject/{workflow_id}", dependencies=[Depends(verify_session), Depends(verify_csrf), Depends(rate_limiter)])
def reject_workflow(workflow_id: int):
    """
    Reject the drafted notification and cancel the workflow.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # 1. Row locking using FOR UPDATE
            cur.execute(
                "SELECT status, tokens_used, latency_ms FROM agent_workflows WHERE id = %s FOR UPDATE;",
                (workflow_id,)
            )
            wf = cur.fetchone()
            if not wf:
                raise HTTPException(status_code=404, detail="Workflow not found")
                
            status, tokens, latency = wf
            if status == "rejected":
                return {"message": "Workflow has already been rejected"}
                
            if status != "pending_approval":
                raise HTTPException(
                    status_code=400,
                    detail=f"Workflow cannot be rejected because its current status is '{status}' (must be 'pending_approval')"
                )
                
            # 2. Atomic status update on the same connection
            cur.execute(
                "UPDATE agent_workflows SET status = 'rejected', tokens_used = %s, latency_ms = %s, updated_at = NOW() WHERE id = %s;",
                (tokens, latency, workflow_id)
            )
            conn.commit()
            
        return {"success": True, "message": "Workflow successfully rejected"}
    except HTTPException as he:
        conn.rollback()
        raise he
    except Exception as e:
        conn.rollback()
        logger.exception("Error processing rejection for workflow %s", workflow_id)
        raise HTTPException(status_code=500, detail="Error processing rejection. Please try again.")
    finally:
        conn.close()
@app.delete("/api/agent/workflows/{workflow_id}", dependencies=[Depends(verify_session), Depends(verify_csrf)])
def delete_workflow(workflow_id: int):
    """
    Delete a specific workflow and its steps.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM agent_workflows WHERE id = %s RETURNING id;", (workflow_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Workflow not found")
        conn.commit()
        return {"success": True, "message": f"Workflow #{workflow_id} successfully deleted"}
    except HTTPException as he:
        conn.rollback()
        raise he
    except Exception as e:
        conn.rollback()
        logger.exception("Failed to delete workflow %s", workflow_id)
        raise HTTPException(status_code=500, detail="Failed to delete workflow. Please try again.")
    finally:
        conn.close()


@app.delete("/api/agent/workflows", dependencies=[Depends(verify_session), Depends(verify_csrf)])
def clear_all_workflows():
    """
    Delete all workflows.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM agent_workflows;")
        conn.commit()
        return {"success": True, "message": "All workflows successfully deleted"}
    except Exception as e:
        conn.rollback()
        logger.exception("Failed to clear workflows")
        raise HTTPException(status_code=500, detail="Failed to clear workflows. Please try again.")
    finally:
        conn.close()


@app.get("/api/agent/workflows", dependencies=[Depends(verify_session)])
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
        logger.exception("Failed to list workflows")
        raise HTTPException(status_code=500, detail="Failed to list workflows. Please try again.")
    finally:
        conn.close()


@app.get("/api/agent/metrics", dependencies=[Depends(verify_session)])
def get_workflow_metrics():
    """
    Get aggregated performance metrics for agent workflows.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 
                    COUNT(*)::int as total_runs,
                    COALESCE(SUM(tokens_used), 0)::int as total_tokens,
                    COALESCE(AVG(CASE WHEN status NOT IN ('failed', 'rejected') AND latency_ms > 0 THEN latency_ms END), 0)::float as avg_latency_ms,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed_runs,
                    COUNT(CASE WHEN status IN ('pending_approval', 'pending', 'sending') THEN 1 END)::int as pending_runs,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END)::int as failed_runs,
                    COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int as rejected_runs
                FROM agent_workflows;
                """
            )
            row = cur.fetchone()
            if not row:
                return {
                    "total_runs": 0,
                    "total_tokens": 0,
                    "avg_latency_ms": 0.0,
                    "completed_runs": 0,
                    "pending_runs": 0,
                    "failed_runs": 0,
                    "rejected_runs": 0,
                    "success_rate": 100.0
                }
            
            total_runs, total_tokens, avg_latency_ms, completed_runs, pending_runs, failed_runs, rejected_runs = row
            
            divisor = completed_runs + failed_runs + rejected_runs
            success_rate = (completed_runs / divisor * 100.0) if divisor > 0 else 100.0
            
            return {
                "total_runs": total_runs,
                "total_tokens": total_tokens,
                "avg_latency_ms": round(avg_latency_ms, 2),
                "completed_runs": completed_runs,
                "pending_runs": pending_runs,
                "failed_runs": failed_runs,
                "rejected_runs": rejected_runs,
                "success_rate": round(success_rate, 2)
            }
    except Exception as e:
        logger.exception("Failed to fetch agent metrics")
        raise HTTPException(status_code=500, detail="Failed to fetch agent metrics. Please try again.")
    finally:
        conn.close()


@app.get("/api/agent/workflows/{workflow_id}", dependencies=[Depends(verify_session)])
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
        logger.exception("Failed to fetch workflow details for workflow %s", workflow_id)
        raise HTTPException(status_code=500, detail="Failed to fetch workflow details. Please try again.")
    finally:
        conn.close()
