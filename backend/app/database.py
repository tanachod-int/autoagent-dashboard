import os
import psycopg2
from contextlib import contextmanager
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


@contextmanager
def get_db():
    """
    Context manager for database connections.
    Automatically commits on success, rolls back on error, and closes the connection.

    Usage:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    """
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
