import os

HOST = os.environ.get("APP_HOST", "127.0.0.1")
PORT = int(os.environ.get("APP_PORT", "8421"))
DEBUG = os.environ.get("APP_DEBUG") == "1"
