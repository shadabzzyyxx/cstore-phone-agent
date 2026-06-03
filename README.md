# Fifth St Food Mart - AI Phone Agent

## How It Works
Customer calls → VAPI answers → asks for product → server searches CStorePro live → speaks price back

## Deploy to Render

1. Go to render.com → New → Web Service
2. Connect your GitHub repo (upload these files first)
3. Set environment variables:
   - CSTORE_USERNAME = fifthstreet
   - CSTORE_PASSWORD = your_password
4. Deploy!
5. Copy your Render URL (e.g. https://cstore-phone-agent.onrender.com)

## Setup VAPI Assistant

1. Go to dashboard.vapi.ai
2. Create New Assistant
3. Set system prompt:

"""
You are a friendly phone assistant for Fifth St Food Mart. 
When a customer asks for a product price, use the get_price tool to look it up.
Always greet with: "Thank you for calling Fifth St Food Mart! How can I help you today?"
Keep responses short and friendly.
If multiple products found, list up to 3 and ask which one they want.
"""

4. Add Tool:
   - Name: get_price
   - URL: https://YOUR-RENDER-URL/vapi-tool
   - Method: POST
   - Parameter: product_name (string) - "The product the customer wants the price for"

5. Connect your Twilio number to this assistant

## Test
Call your Twilio number and say "What's the price of Bud Light?"
