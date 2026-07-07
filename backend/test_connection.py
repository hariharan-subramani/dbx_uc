#!/usr/bin/env python3
"""
Test script to verify Databricks REST API connection
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

DATABRICKS_HOST = os.getenv("DATABRICKS_HOST", "").rstrip("/")
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN", "")

print("=" * 60)
print("Testing Databricks REST API Connection")
print("=" * 60)
print(f"Host: {DATABRICKS_HOST}")
print(f"Token: {DATABRICKS_TOKEN[:10]}...{DATABRICKS_TOKEN[-10:]}")
print()

# Test 1: Get current user
print("Test 1: Getting current user...")
try:
    headers = {
        "Authorization": f"Bearer {DATABRICKS_TOKEN}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(
        f"{DATABRICKS_HOST}/api/2.0/me",
        headers=headers,
        timeout=10
    )
    
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        user_data = response.json()
        print(f"✅ Success!")
        print(f"User: {user_data.get('userName')}")
        print(f"Display Name: {user_data.get('displayName')}")
    else:
        print(f"❌ Failed with status {response.status_code}")
        print(f"Response: {response.text}")
        
except Exception as e:
    print(f"❌ Error: {e}")

print()
print("=" * 60)