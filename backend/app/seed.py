import os
from datetime import datetime, timedelta
import random
from database import get_db_connection
from dotenv import load_dotenv

# Load env variables
load_dotenv()


def run_init_sql(cursor):
    """Read init.sql and execute it to create tables."""
    init_sql_path = os.path.join(os.path.dirname(__file__), "init.sql")
    if not os.path.exists(init_sql_path):
        raise FileNotFoundError(f"Schema file not found at: {init_sql_path}")
        
    print(f"Reading schema from {init_sql_path}...")
    with open(init_sql_path, "r", encoding="utf-8") as f:
        sql = f.read()
        
    print("Initializing tables and indexes in Supabase...")
    cursor.execute(sql)
    print("Schema initialized successfully.")


def seed_data():
    """Seed mock data for products and sales_records."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # 1. Initialize schema
            run_init_sql(cur)
            
            # 2. Clear existing records to ensure clean state
            print("Clearing existing data...")
            cur.execute("TRUNCATE TABLE products CASCADE;")
            
            # 3. Seed products
            mock_products = [
                ("Smartphone X", 50, 15900.00),
                ("Premium Laptop Pro", 5, 45000.00),
                ("Ultra-wide Monitor 34\"", 12, 14900.00),
                ("Tablet Air 10\"", 3, 12500.00),
                ("Bluetooth Earbuds", 8, 1990.00),
                ("High-capacity Power Bank", 120, 890.00),
                ("Smart Fitness Watch", 2, 5900.00),
                ("Mechanical Keyboard", 15, 3200.00),
                ("USB-C Hub Multiport", 9, 1290.00),
                ("Wireless Mouse", 25, 990.00)
            ]
            
            print("Inserting products...")
            inserted_products = []
            for name, stock, price in mock_products:
                cur.execute(
                    """
                    INSERT INTO products (name, stock_quantity, price) 
                    VALUES (%s, %s, %s) 
                    RETURNING id, name, stock_quantity, price;
                    """,
                    (name, stock, price)
                )
                inserted_products.append(cur.fetchone())
                
            print(f"Inserted {len(inserted_products)} products.")
            
            # 4. Seed sales records
            print("Inserting mock sales records...")
            sales_count = 0
            
            # Generate random sales for each product over the last 14 days
            for prod in inserted_products:
                prod_id, name, stock, price = prod
                
                # Number of sales for this product
                num_sales = random.randint(3, 10)
                
                for _ in range(num_sales):
                    # Random date in the last 14 days
                    days_ago = random.randint(0, 14)
                    hours_ago = random.randint(0, 23)
                    minutes_ago = random.randint(0, 59)
                    seconds_ago = random.randint(0, 59)
                    sale_date = datetime.now() - timedelta(
                        days=days_ago,
                        hours=hours_ago,
                        minutes=minutes_ago,
                        seconds=seconds_ago
                    )
                    
                    # Random purchase amount (usually quantity * price, e.g. 1-3 items)
                    quantity = random.randint(1, 3)
                    amount = price * quantity
                    
                    cur.execute(
                        """
                        INSERT INTO sales_records (product_id, amount, sale_date)
                        VALUES (%s, %s, %s);
                        """,
                        (prod_id, amount, sale_date)
                    )
                    sales_count += 1
                    
            print(f"Inserted {sales_count} sales records.")
            
        # Commit transaction
        conn.commit()
        print("Database seeding completed successfully.")
        
    except Exception as e:
        conn.rollback()
        print(f"Error during seeding: {e}")
        raise e
    finally:
        conn.close()


if __name__ == "__main__":
    seed_data()
