import os
import time
import json
from datetime import datetime
from typing import TypedDict, List, Dict, Any, Optional
import google.generativeai as genai
from langgraph.graph import StateGraph, END
from dotenv import load_dotenv

from app.database import get_db_connection
from app.google_sheets import append_critical_products

# Load environment variables from absolute path
base_dir = os.path.dirname(os.path.dirname(__file__))
dotenv_path = os.path.join(base_dir, ".env")
load_dotenv(dotenv_path=dotenv_path)

# Configure Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)



class AgentState(TypedDict):
    query: str
    sheet_url: str
    sql: str
    query_results: List[Dict[str, Any]]
    discord_payload: Dict[str, Any]
    workflow_id: int
    total_latency_ms: int
    total_tokens: int
    error: str


def db_insert_workflow(query: str) -> int:
    """Insert initial workflow record and return ID."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_workflows (task_query, status)
                VALUES (%s, 'pending')
                RETURNING id;
                """,
                (query,)
            )
            workflow_id = cur.fetchone()[0]
        conn.commit()
        return workflow_id
    except Exception as e:
        print(f"[ERROR] Failed to insert workflow: {e}")
        return 0
    finally:
        conn.close()


def db_update_workflow(workflow_id: int, status: str, tokens: int, latency: int):
    """Update workflow record with metrics and status."""
    if not workflow_id:
        return
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE agent_workflows
                SET status = %s, tokens_used = %s, latency_ms = %s
                WHERE id = %s;
                """,
                (status, tokens, latency, workflow_id)
            )
        conn.commit()
    except Exception as e:
        print(f"[ERROR] Failed to update workflow metrics: {e}")
    finally:
        conn.close()


def db_insert_step(workflow_id: int, step_name: str, sql_generated: Optional[str], execution_result: Optional[str], is_success: bool):
    """Log individual workflow step in database."""
    if not workflow_id:
        return
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO workflow_steps (workflow_id, step_name, sql_generated, execution_result, is_success)
                VALUES (%s, %s, %s, %s, %s);
                """,
                (workflow_id, step_name, sql_generated, execution_result, is_success)
            )
        conn.commit()
    except Exception as e:
        print(f"[ERROR] Failed to log workflow step: {e}")
    finally:
        conn.close()


# Nodes for LangGraph

def generate_sql_node(state: AgentState) -> AgentState:
    """Translate Thai query into SQL query via Gemini."""
    if state.get("error"):
        return state

    print(f"[Agent] Generating SQL for query: {state['query']}")
    start_time = time.perf_counter()

    prompt = f"""คุณคือ Data Agent ผู้เชี่ยวชาญด้าน PostgreSQL
หน้าที่ของคุณคือแปลงคำสั่งภาษาไทยของผู้ใช้ให้เป็นคำสั่ง SQL ที่ถูกต้องสำหรับระบบ PostgreSQL

นี่คือโครงสร้างตารางข้อมูลในระบบ:
1. ตารางสินค้า `products`
   - `id` BIGINT (Primary Key)
   - `name` TEXT (ชื่อสินค้า)
   - `stock_quantity` INT (จำนวนสินค้าในสต็อก)
   - `price` NUMERIC(10, 2) (ราคาสินค้า)
   - `created_at` TIMESTAMPTZ

2. ตารางประวัติการขาย `sales_records`
   - `id` BIGINT (Primary Key)
   - `product_id` BIGINT (Foreign Key อ้างอิง products.id)
   - `amount` NUMERIC(10, 2) (ยอดขายรวมของรายการนี้)
   - `sale_date` TIMESTAMPTZ

กฎการทำงาน:
- ให้ตอบกลับเฉพาะคำสั่ง SQL เท่านั้น ห้ามใส่คำอธิบาย ห้ามใช้ markdown code block (เช่น ```sql ... ```)
- คำสั่ง SQL ต้องทำงานได้จริงบน PostgreSQL
- เมื่อผู้ใช้พูดถึง "สินค้าวิกฤต", "สินค้าสต็อกต่ำ", "ของเหลือน้อย", ให้หาตัวที่ stock_quantity < 10

คำสั่งผู้ใช้: {state['query']}
SQL:"""

    try:
        model = genai.GenerativeModel("gemini-3.1-flash-lite")
        response = model.generate_content(prompt)
        
        end_time = time.perf_counter()
        latency = int((end_time - start_time) * 1000)
        
        # Extrapolate tokens used
        tokens = 0
        if response.usage_metadata:
            tokens = response.usage_metadata.total_token_count
            
        sql_code = response.text.strip()
        # Clean potential markdown wrappers
        if sql_code.startswith("```"):
            sql_code = sql_code.replace("```sql", "").replace("```", "").strip()
            
        state["sql"] = sql_code
        state["total_latency_ms"] += latency
        state["total_tokens"] += tokens
        
        db_insert_step(state["workflow_id"], "generate_sql", sql_code, "SQL successfully generated", True)
        
    except Exception as e:
        error_msg = f"SQL Generation Failed: {str(e)}"
        print(f"[Agent Error] {error_msg}")
        state["error"] = error_msg
        db_insert_step(state["workflow_id"], "generate_sql", None, error_msg, False)
        
    return state


def execute_sql_node(state: AgentState) -> AgentState:
    """Execute generated SQL against Supabase database."""
    if state.get("error"):
        return state

    print(f"[Agent] Executing SQL: {state['sql']}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(state["sql"])
            
            # If it's a SELECT query, fetch results
            if cur.description:
                columns = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                results = [dict(zip(columns, row)) for row in rows]
            else:
                results = [{"status": "success", "rowcount": cur.rowcount}]
                
        state["query_results"] = results
        db_insert_step(
            state["workflow_id"], 
            "execute_sql", 
            state["sql"], 
            f"Successfully executed. Found {len(results)} rows.", 
            True
        )
    except Exception as e:
        error_msg = f"SQL Execution Failed: {str(e)}"
        print(f"[Agent Error] {error_msg}")
        state["error"] = error_msg
        db_insert_step(state["workflow_id"], "execute_sql", state["sql"], error_msg, False)
    finally:
        conn.close()
        
    return state


def write_sheets_node(state: AgentState) -> AgentState:
    """Write critical products to Google Sheets."""
    if state.get("error"):
        return state

    # If no results to write, skip sheets write but log it
    if not state["query_results"]:
        db_insert_step(state["workflow_id"], "write_sheets", None, "No products to write", True)
        return state

    print(f"[Agent] Writing results to Google Sheets: {state['sheet_url']}")
    try:
        # Filter for products from the query results (expecting lists of products)
        products_to_log = []
        for row in state["query_results"]:
            if "name" in row:
                products_to_log.append({
                    "id": row.get("id", "N/A"),
                    "name": row.get("name"),
                    "stock_quantity": row.get("stock_quantity", 0),
                    "price": float(row.get("price", 0.0))
                })
        
        if products_to_log:
            final_sheet_url = append_critical_products(state["sheet_url"], products_to_log)
            state["sheet_url"] = final_sheet_url
            db_insert_step(
                state["workflow_id"], 
                "write_sheets", 
                None, 
                f"Successfully appended {len(products_to_log)} rows to Google Sheet: {final_sheet_url}", 
                True
            )
        else:
            db_insert_step(state["workflow_id"], "write_sheets", None, "No valid product structures in result set to write to sheet", True)
            
    except Exception as e:
        error_msg = f"Google Sheets Write Failed: {str(e)}"
        print(f"[Agent Error] {error_msg}")
        state["error"] = error_msg
        db_insert_step(state["workflow_id"], "write_sheets", None, error_msg, False)
        
    return state


def draft_discord_node(state: AgentState) -> AgentState:
    """Draft a Discord Webhook embed using Gemini."""
    if state.get("error"):
        db_update_workflow(state["workflow_id"], "failed", state["total_tokens"], state["total_latency_ms"])
        return state

    print("[Agent] Drafting Discord Embed notification card...")
    start_time = time.perf_counter()

    products_list_str = "\n".join([
        f"- {p.get('name')}: คงเหลือ {p.get('stock_quantity')} ชิ้น (ราคา: {p.get('price')} บาท)"
        for p in state["query_results"] if "name" in p
    ])

    prompt = f"""คุณคือ Discord Agent ผู้เชี่ยวชาญด้านการจัดฟอร์แมตรายงาน
หน้าที่ของคุณคือสรุปข้อมูลสินค้าวิกฤตที่ตรวจพบเพื่อเตรียมส่งไปแสดงผลบน Discord Embed

นี่คือรายการสินค้าวิกฤตที่ตรวจพบ:
{products_list_str}

นี่คือลิงก์ Google Sheets ที่บันทึกรายงานไว้: {state['sheet_url']}

กฎการทำงาน:
- ให้สรุปข้อความภาษาไทยให้สั้นกระชับ ชัดเจน น่าสนใจ และเรียบร้อย
- ตอบกลับเฉพาะข้อความสรุปที่จะใช้เป็น Description ใน Discord Embed เท่านั้น ห้ามเขียนคำพูดเกริ่นนำ หรือทักทายใดๆ เด็ดขาด
- หากมีสินค้าจำนวนมาก ให้บอกสรุปภาพรวม
"""

    try:
        model = genai.GenerativeModel("gemini-3.1-flash-lite")
        response = model.generate_content(prompt)
        
        end_time = time.perf_counter()
        latency = int((end_time - start_time) * 1000)
        
        tokens = 0
        if response.usage_metadata:
            tokens = response.usage_metadata.total_token_count
            
        summary_desc = response.text.strip()
        
        # Build Discord payload
        embed_payload = {
            "embeds": [
                {
                    "title": "🚨 รายงานสินค้าคงคลังวิกฤต (Low Stock Report)",
                    "description": summary_desc,
                    "color": 15158332, # Red Hex code in decimal
                    "fields": [
                        {
                            "name": "📊 Google Sheets Link",
                            "value": f"[คลิกเพื่อเข้าชมไฟล์ Google Sheets รายงาน]({state['sheet_url']})"
                        }
                    ],
                    "footer": {
                        "text": "AutoAgent-Dashboard System"
                    },
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }
            ]
        }
        
        state["discord_payload"] = embed_payload
        state["total_latency_ms"] += latency
        state["total_tokens"] += tokens
        
        # Save to DB
        db_insert_step(state["workflow_id"], "draft_discord", None, json.dumps(embed_payload), True)
        
        # Update parent workflow to pending_approval state
        db_update_workflow(state["workflow_id"], "pending_approval", state["total_tokens"], state["total_latency_ms"])
        
    except Exception as e:
        error_msg = f"Discord Draft Generation Failed: {str(e)}"
        print(f"[Agent Error] {error_msg}")
        state["error"] = error_msg
        db_insert_step(state["workflow_id"], "draft_discord", None, error_msg, False)
        db_update_workflow(state["workflow_id"], "failed", state["total_tokens"], state["total_latency_ms"])
        
    return state


# Build the LangGraph State Machine

def run_data_agent(query: str, custom_sheet_url: Optional[str] = None) -> Dict[str, Any]:
    """Execute the multi-agent Text-to-SQL and reporting graph."""
    
    # 1. Initialize DB Workflow record
    workflow_id = db_insert_workflow(query)
    
    # 2. Get default sheet URL if none provided
    sheet_url = custom_sheet_url or os.getenv("DEFAULT_GOOGLE_SHEET_URL")
    if not sheet_url:
        sheet_url = "AutoAgent-Dashboard-Report" # Fallback to title
        
    initial_state = AgentState(
        query=query,
        sheet_url=sheet_url,
        sql="",
        query_results=[],
        discord_payload={},
        workflow_id=workflow_id,
        total_latency_ms=0,
        total_tokens=0,
        error=""
    )
    
    # Define state graph
    builder = StateGraph(AgentState)
    
    # Add nodes
    builder.add_node("generate_sql", generate_sql_node)
    builder.add_node("execute_sql", execute_sql_node)
    builder.add_node("write_sheets", write_sheets_node)
    builder.add_node("draft_discord", draft_discord_node)
    
    # Define execution pipeline
    builder.set_entry_point("generate_sql")
    builder.add_edge("generate_sql", "execute_sql")
    builder.add_edge("execute_sql", "write_sheets")
    builder.add_edge("write_sheets", "draft_discord")
    builder.add_edge("draft_discord", END)
    
    # Compile
    graph = builder.compile()
    
    # Run graph
    print(f"[Workflow] Launching agent graph for Workflow ID: {workflow_id}...")
    final_state = graph.invoke(initial_state)
    
    return final_state
