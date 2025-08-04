# Railway Deployment Guide

## Prerequisites
- Railway account (create at railway.app)
- Railway CLI installed (optional but recommended)

## Deployment Steps

### 1. Using Railway Web Interface

1. Go to [Railway](https://railway.app) and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account and select your repository
5. Railway will automatically detect the Node.js app

### 2. Configure Environment Variables

In Railway dashboard, go to your project's Variables section and add:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
AIRTABLE_API_KEY=your-airtable-api-key
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_PROJECTS_TABLE_ID=your-projects-table-id
AIRTABLE_EMPLOYEES_TABLE_ID=your-employees-table-id
```

**Important**: Replace the values above with your actual credentials.

### 3. Deploy

Railway will automatically deploy when you push to your connected branch.

### 4. Update Slack App Configuration

After deployment, update your Slack app settings:

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Select your app
3. Update the following URLs with your Railway domain:
   - **Socket Mode**: Keep enabled (no URL changes needed)
   - **Slash Commands**: Update URL to `https://your-app.railway.app/slack/events`

## Alternative: Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Deploy
railway up

# Add environment variables
railway variables set SLACK_BOT_TOKEN=xoxb-your-token
railway variables set SLACK_SIGNING_SECRET=your-secret
# ... add other variables
```

## Monitoring

- View logs: `railway logs` or check Railway dashboard
- Monitor health: Railway dashboard shows deployment status
- Socket Mode connection status visible in Slack API dashboard

## Notes

- The bot uses Socket Mode, so it doesn't need a public webhook URL
- Railway provides automatic HTTPS
- Default port is set to 3001 in .env but Railway will override with PORT env var
- The app will auto-restart on crashes (configured in railway.json)