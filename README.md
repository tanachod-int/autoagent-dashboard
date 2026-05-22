# AutoAgent Dashboard

AutoAgent Dashboard is an AI-powered operations dashboard that turns natural-language Thai commands into PostgreSQL queries, runs them against a Supabase database, logs critical product results to Google Sheets, drafts a Discord notification, and waits for human approval before sending the final Discord webhook.

The main demo workflow is a low-stock monitoring pipeline for products with `stock_quantity < 10`.

## Features

- Thai natural-language command input
- Gemini-powered Text-to-SQL generation
- Supabase PostgreSQL query execution
- Google Sheets reporting for critical stock items
- Discord Embed notification drafting
- Human approval gate before sending Discord messages
- Workflow history and step-by-step execution logs
- Token usage, latency, success rate, and run status metrics
- Next.js dashboard with an interactive sandbox and observability panel

## Architecture

```text
User
  -> Next.js Dashboard
  -> FastAPI Backend
  -> LangGraph Agent Workflow
       1. Generate SQL with Gemini
       2. Execute SQL on Supabase PostgreSQL
       3. Append results to Google Sheets
       4. Draft Discord Embed with Gemini
  -> Human Approval
  -> Discord Webhook
```

## Tech Stack

### Backend

- Python
- FastAPI
- LangGraph
- Gemini API via `google-generativeai`
- PostgreSQL/Supabase via `psycopg2`
- Google Sheets via `gspread`
- Discord Webhook via `requests`

### Frontend

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- lucide-react

### External Services

- Google Gemini API
- Supabase PostgreSQL
- Google Sheets API
- Discord Webhook

## Project Structure

```text
autoagent-dashboard/
  backend/
    requirements.txt
    .env.example
    app/
      main.py              # FastAPI app and API endpoints
      agent.py             # LangGraph workflow and AI agent logic
      database.py          # PostgreSQL/Supabase connection
      google_sheets.py     # Google Sheets integration
      discord_client.py    # Discord webhook integration
      init.sql             # Database schema
      seed.py              # Demo schema/data seeding script
  frontend/
    package.json
    .env.example
    src/app/
      page.tsx             # Main dashboard UI
      layout.tsx           # App layout and metadata
      globals.css          # Tailwind/global styles
```

## Backend Setup

Create a virtual environment and install dependencies:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` from `backend/.env.example`:

```env
PORT=8000

GEMINI_API_KEY=your_gemini_api_key_here

SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
DATABASE_URL=postgresql://postgres.your_supabase_id:your_password@your-host/postgres?sslmode=require

GOOGLE_APPLICATION_CREDENTIALS=path/to/google-service-account.json

DISCORD_WEBHOOK_URL=your_discord_webhook_url_here

DEFAULT_GOOGLE_SHEET_URL=your_default_google_sheet_url_here
```

Run the backend:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

The API should be available at:

```text
http://localhost:8000
```

Health check:

```text
http://localhost:8000/health
```

## Database Setup

The schema is defined in:

```text
backend/app/init.sql
```

To initialize the schema and seed demo data:

```bash
cd backend/app
python seed.py
```

The seed script creates demo products and sales records. Some products intentionally have stock below 10 so the low-stock agent workflow has data to find.

## Frontend Setup

Install dependencies:

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Run the frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:3000
```

## Main API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/` | Basic API status |
| `GET` | `/health` | Backend health check |
| `POST` | `/api/agent/run` | Run the Text-to-SQL agent workflow |
| `POST` | `/api/agent/approve/{workflow_id}` | Approve a drafted Discord notification and send it |
| `GET` | `/api/agent/workflows` | List recent workflows |
| `GET` | `/api/agent/workflows/{workflow_id}` | Get workflow details and step logs |
| `GET` | `/api/agent/metrics` | Get aggregate workflow metrics |

Example run request:

```json
{
  "query": "หาสินค้าที่เหลือน้อยกว่า 10 ชิ้นแล้วบันทึกลง Google Sheets",
  "sheet_url": "https://docs.google.com/spreadsheets/d/your-sheet-id"
}
```

## Workflow Statuses

- `pending`: workflow has been created
- `pending_approval`: Discord payload has been drafted and is waiting for approval
- `completed`: user approved and Discord notification was sent
- `failed`: workflow failed during execution or notification delivery

## Notes

- This project can run without Docker as long as Python, Node.js, environment variables, and external service credentials are configured on the machine.
- Docker is not required, but adding Docker/Docker Compose would make the project easier to run consistently on other machines.
- Do not commit real `.env` files, database URLs, Gemini keys, Discord webhooks, or Google service account JSON files.
- The current Text-to-SQL flow executes model-generated SQL. For production use, add SQL validation and restrict execution to safe read-only statements unless write access is explicitly required.

## Development Commands

Backend:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

Seed database:

```bash
cd backend/app
python seed.py
```

## License

No license has been specified yet.
