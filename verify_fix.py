
import os
import sys

# Set a mock DATABASE_URL for testing if not set
# Use the one from the comment in models.py which triggered the error
test_url = "postgresql+psycopg2://postgres:edd0ef31fdc784f9309438a325b64d0aba4c59649d2f4be1de036d7f669880e9@db.htpevovdkkvgjamnguuf.supabase.co:5432/postgres"
os.environ["DATABASE_URL"] = test_url

try:
    from db.models import engine
    print("Successfully imported db.models")
    print(f"Engine URL: {engine.url}")
    print(f"Connect Args: {engine.dialect.connect_args}")
    
    # Access the connect_args passed to create_engine
    # create_engine saves them in engine.pool._creator or similar, but we can check the process output for the print statement we added
    
except Exception as e:
    print(f"an error occurred: {e}")
