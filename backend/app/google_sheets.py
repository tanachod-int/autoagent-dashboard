import os
from datetime import datetime
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
            # Try to share it publicly as reader so user can access it
            try:
                spreadsheet.share('', perm_type='anyone', role='reader')
            except Exception as share_error:
                print(f"[WARNING] Failed to share spreadsheet publicly: {share_error}")
                
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
            
    # Overwrite Mode: clear sheet and append fresh headers
    sheet.clear()
    sheet.append_row(headers)
            
    # Prepare rows
    logged_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows_to_append = []
    
    for item in data:
        row = []
        for k in keys:
            val = item.get(k, "")
            # format type representation
            if isinstance(val, float):
                row.append(float(val))
            elif isinstance(val, int) and not isinstance(val, bool):
                row.append(int(val))
            else:
                row.append(str(val))
        row.append(logged_at)
        rows_to_append.append(row)
        
    # Append rows if data is not empty
    if rows_to_append:
        sheet.append_rows(rows_to_append)
        
    return spreadsheet.url

