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
    Loads credentials from the file path specified in GOOGLE_APPLICATION_CREDENTIALS.
    """
    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds_path:
        raise ValueError("GOOGLE_APPLICATION_CREDENTIALS environment variable is not configured.")
        
    if not os.path.exists(creds_path):
        raise FileNotFoundError(f"Google credentials file not found at: {creds_path}")
        
    creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    client = gspread.authorize(creds)
    return client


def append_critical_products(sheet_identifier: str, products: list[dict]) -> str:
    """
    Append list of critical (low stock) products to a Google Sheet.
    If the sheet does not exist (and identifier is a title), creates a new one.
    
    Args:
        sheet_identifier: The title of the sheet or its full URL.
        products: A list of dicts, where each dict has keys like 'id', 'name', 'stock_quantity', 'price'.
        
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
                
    sheet = spreadsheet.get_worksheet(0)
    
    # Initialize sheet with headers if empty or missing
    headers = ["Product ID", "Product Name", "Current Stock", "Price", "Logged At"]
    values = sheet.get_all_values()
    if not values:
        sheet.append_row(headers)
    elif values[0] != headers:
        sheet.insert_row(headers, 1)
        
    # Prepare rows
    logged_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows_to_append = []
    
    for p in products:
        rows_to_append.append([
            p.get("id", "N/A"),
            p.get("name", "N/A"),
            p.get("stock_quantity", 0),
            float(p.get("price", 0.0)),
            logged_at
        ])
        
    # Append rows if products list is not empty
    if rows_to_append:
        sheet.append_rows(rows_to_append)
        
    return spreadsheet.url
