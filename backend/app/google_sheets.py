import os
from datetime import datetime, timezone
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]


def get_sheets_client() -> gspread.Client:
    """
    Authenticate and return a gspread client.
    Loads credentials from:
    1. GOOGLE_SERVICE_ACCOUNT_JSON (JSON string value, preferred for cloud deployments)
    2. GOOGLE_APPLICATION_CREDENTIALS (file path, fallback for local development)
    """
    import json
    
    creds_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if creds_json:
        try:
            creds_info = json.loads(creds_json)
            creds = Credentials.from_service_account_info(creds_info, scopes=SCOPES)
        except Exception as e:
            raise ValueError(f"Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON environment variable: {str(e)}")
    else:
        creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not creds_path:
            raise ValueError("Neither GOOGLE_SERVICE_ACCOUNT_JSON nor GOOGLE_APPLICATION_CREDENTIALS environment variable is configured.")
            
        if not os.path.exists(creds_path):
            raise FileNotFoundError(f"Google credentials file not found at: {creds_path}")
            
        creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
        
    client = gspread.authorize(creds)
    return client


def append_data_to_sheet(sheet_identifier: str, data: list[dict]) -> str:
    """
    Append list of query results dynamically to a Google Sheet.
    If the sheet does not exist (and identifier is a title), creates a new one.
    
    Args:
        sheet_identifier: The title of the sheet or its full URL.
        data: A list of dicts, where each dict has keys representing the columns.
        
    Returns:
        The URL of the spreadsheet.
    """
    client = get_sheets_client()
    
    # Load spreadsheet by URL or title
    if sheet_identifier.startswith("https://"):
        spreadsheet = client.open_by_url(sheet_identifier)
    else:
        try:
            spreadsheet = client.open(sheet_identifier)
        except gspread.exceptions.SpreadsheetNotFound:
            # Create a new spreadsheet if not found by title
            spreadsheet = client.create(sheet_identifier)
            # Share only with specified email addresses in ALLOWED_SHARE_EMAILS env variable
            share_emails = os.getenv("ALLOWED_SHARE_EMAILS")
            if share_emails:
                for email in share_emails.split(","):
                    email = email.strip()
                    if email:
                        try:
                            spreadsheet.share(email, perm_type='user', role='reader')
                            print(f"[INFO] Shared spreadsheet with {email}")
                        except Exception as share_error:
                            print(f"[WARNING] Failed to share spreadsheet with {email}: {share_error}")
                
    if not data:
        return spreadsheet.url

    # Get keys/columns from the first item
    keys = list(data[0].keys())
    # Format headers: e.g., "stock_quantity" -> "Stock Quantity"
    headers = [k.replace("_", " ").title() for k in keys] + ["Logged At"]
    
    # Determine the target tab category based on data structure
    keys_lower = [k.lower() for k in keys]
    if len(keys) == 1 and keys[0].lower() in ["message", "status", "execution_result", "text"]:
        tab_title = "คำชี้แจง"
    elif any(k in keys_lower for k in ["amount", "total_sales", "sale_date", "sales", "total_amount"]):
        tab_title = "ยอดขาย"
    else:
        tab_title = "คลังสินค้า"
        
    # Get all current worksheets in the spreadsheet
    worksheets = spreadsheet.worksheets()
    first_ws = worksheets[0]
    
    # If there is only one default sheet, rename it to the target category
    # \u0e41\u0e1c\u0e48\u0e191 is 'แผ่น1', \u0e0a\u0e35\u0e151 is 'ชีต1'
    default_names = ["sheet1", "sheet 1", "\u0e41\u0e1c\u0e48\u0e191", "\u0e41\u0e1c\u0e48\u0e19 1", "\u0e0a\u0e35\u0e151", "\u0e0a\u0e35\u0e15 1"]
    if len(worksheets) == 1 and first_ws.title.lower() in default_names:
        try:
            first_ws.update_title(tab_title)
            sheet = first_ws
        except Exception:
            sheet = first_ws
    else:
        # Open existing category worksheet or create a new one
        try:
            sheet = spreadsheet.worksheet(tab_title)
        except gspread.exceptions.WorksheetNotFound:
            sheet = spreadsheet.add_worksheet(title=tab_title, rows="1000", cols="20")
            
    # Append Mode with schema reconciliation:
    # 1. Retrieve existing headers from the sheet (strip whitespaces)
    existing_headers = [h.strip() for h in sheet.row_values(1) if h.strip()]
    
    if not existing_headers:
        # If empty, initialize sheet headers with query headers
        existing_headers = headers
        sheet.append_row(existing_headers)
    else:
        # Identify headers in the incoming query that are not in the sheet's existing schema
        new_headers = [h for h in headers if h not in existing_headers]
        if new_headers:
            # We want to add new headers before "Logged At" if it exists, otherwise at the end
            if "Logged At" in existing_headers:
                existing_headers.remove("Logged At")
            existing_headers.extend([h for h in new_headers if h != "Logged At"])
            existing_headers.append("Logged At")
            
            # Update the headers row in the sheet
            sheet.update("A1", [existing_headers])
            
    # Prepare rows matching the order of existing_headers
    logged_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    rows_to_append = []
    
    for item in data:
        row = []
        for header in existing_headers:
            if header == "Logged At":
                row.append(logged_at)
                continue
                
            # Map the header title back to the query dict key (e.g. "Stock Quantity" -> "stock_quantity")
            matched_key = None
            for k in keys:
                if k.replace("_", " ").title() == header:
                    matched_key = k
                    break
                    
            val = item.get(matched_key, "") if matched_key else ""
            if isinstance(val, float):
                row.append(float(val))
            elif isinstance(val, int) and not isinstance(val, bool):
                row.append(int(val))
            else:
                row.append(str(val))
        rows_to_append.append(row)
        
    # Append rows if data is not empty
    if rows_to_append:
        sheet.append_rows(rows_to_append)
        
    return spreadsheet.url

