import os
import requests
from dotenv import load_dotenv

load_dotenv()

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")


def send_discord_webhook(payload: dict) -> bool:
    """
    Send a payload to the configured Discord Webhook.
    """
    if not DISCORD_WEBHOOK_URL:
        print("[WARNING] DISCORD_WEBHOOK_URL is not set.")
        return False
        
    try:
        response = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        # 204 No Content is the standard success response for Discord Webhook
        if response.status_code in [200, 204]:
            return True
        else:
            print(f"[ERROR] Discord returned status code {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print(f"[ERROR] Failed to send Discord Webhook: {e}")
        return False
