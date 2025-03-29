# API Key Pool System

This feature allows you to use multiple API keys for services like Google Gemini to avoid hitting rate limits. The system automatically rotates through available API keys on each API call.

## How It Works

1. The system maintains a pool of API keys for each service (e.g., "keygemini" for Google Gemini).
2. On each API call, the system selects the next API key in the pool.
3. This rotation helps distribute API calls across multiple keys, avoiding rate limits on any single key.

## Commands

### Add an API Key
```
/addkey [service] [apikey]
```
For example:
```
/addkey keygemini YOUR_GEMINI_API_KEY_HERE
```

### Remove an API Key
```
/removekey [service] [apikey]
```
For example:
```
/removekey keygemini YOUR_GEMINI_API_KEY_HERE
```

### List Available API Keys
```
/listkeys
```
This shows a summary of how many API keys are available for each service.

## Setup Guide

1. Get multiple API keys from the service you want to use (e.g., [Google AI Studio](https://aistudio.google.com/app/apikey) for Gemini API keys)
2. Add each key using the `/addkey` command
3. The system will automatically rotate through all available keys

## File Structure

- `key.json`: Stores your API keys in arrays
- `lib/apiKeyPool.js`: Manages the API key pool and rotation logic

## Example key.json Format

```json
{
  "keygemini": [
    "API_KEY_1",
    "API_KEY_2",
    "API_KEY_3"
  ],
  "donasi": "BLANK"
}
```

## Benefits

- Distribute API calls across multiple keys
- Avoid rate limit errors
- Increase overall throughput
- Seamless fallback if one key has reached its limit

If you need to handle a high volume of requests, simply add more API keys to the pool using the `/addkey` command. 