import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("[WARNING] DATABASE_URL is not set in the environment variables.")


def get_db_connection():
    """
    Establish a connection to the Supabase PostgreSQL database.
    Returns:
        psycopg2 connection object.
    """
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is not configured in the environment variables.")
    
    # Establish connection
    conn = psycopg2.connect(DATABASE_URL)
    return conn
