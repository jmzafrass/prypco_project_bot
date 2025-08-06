# Prypco Project Management Slack Bot

A Slack bot that integrates with Airtable to manage projects with advanced filtering, pagination, and real-time updates.

## Features

- **Project Listing**: View all projects with advanced filtering options
- **Project Editing**: Edit project details through interactive Slack modals
- **Project Deletion**: Remove projects with confirmation dialogs
- **Search & Filter**: Search by initiative/description and filter by status, priority, business unit, OKR, and owner
- **Rich Formatting**: Projects display with emojis and formatted information

## Prerequisites

- Node.js 16+ installed
- A Slack workspace with admin permissions
- An Airtable account with a project management base

## Setup Instructions

### 1. Slack App Configuration

1. Go to [Slack API](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and select your workspace
3. In **OAuth & Permissions**:
   - Add the following Bot Token Scopes:
     - `commands`
     - `chat:write`
     - `chat:write.public`
   - Install the app to your workspace
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)

4. In **Slash Commands**:
   - Create a new command: `/project`
   - Request URL: `https://YOUR-RAILWAY-URL/slack/commands`
   - Description: "Manage projects"
   - Usage hint: `[list|edit|delete|create|help] [search term]`

5. In **Event Subscriptions**:
   - Enable Events
   - Request URL: `https://YOUR-RAILWAY-URL/slack/events`
   - Subscribe to bot events: `app_mention`

6. In **Interactivity & Shortcuts**:
   - Turn on Interactivity
   - Request URL: `https://YOUR-RAILWAY-URL/slack/events`

7. In **Basic Information**:
   - Copy the "Signing Secret"

### 2. Airtable Configuration

1. Create or access your Airtable base
2. Ensure you have two tables:
   - **Projects Table** with fields:
     - Initiative (Single line text)
     - Description (Long text)
     - Status (Single select: "Not started", "In progress", "Delivered")
     - Priority (Single select: "Highest - ETD next 30 days", "High - ETD EoQ3", "Medium - ETD EoQ4", "Low - ETD TBD (possible spill over)")
     - Related BU (Multiple select: P1, Exclusives, Mortgage, GV, Company level, Blocks, Mint)
     - Related OKR (Multiple select: various OKR options)
     - Project Owners (Link to Employees Table) - Note: Linked record field
     - Owner(s) (Formula field that displays names from Project Owners)
     - KPIs (how to measure success?) (Long text)
     - Risks/Blockers (Long text)
     - Last updated (Date)
     - Target date (Date)
   - **Employees Table** with fields:
     - Name (Single line text)

3. Get your Airtable credentials:
   - Base ID (found in API documentation for your base)
   - API Key (create from https://airtable.com/account)
   - Table IDs for both Projects and Employees tables

### 3. Deployment on Railway

#### Environment Variables

Set these in Railway:

```bash
# Slack Configuration (HTTP Mode)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
# Note: SLACK_APP_TOKEN is NOT needed for Railway deployment

# Airtable Configuration
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_API_KEY=your-api-key
AIRTABLE_PROJECTS_TABLE_ID=your-projects-table-id
AIRTABLE_EMPLOYEES_TABLE_ID=your-employees-table-id

# Railway sets PORT automatically
```

#### Important Notes:
- The bot runs in HTTP mode on Railway (Socket Mode is disabled)
- Railway provides the PORT environment variable automatically
- Health checks are available at `/` and `/health` endpoints

### 4. Local Development

For local development with Socket Mode:
1. Add `SLACK_APP_TOKEN` to your `.env`
2. Change `socketMode: false` to `socketMode: true` in index.js
3. Install dependencies: `npm install`
4. Run: `npm run dev`

### 5. Deployment Steps

1. Push your code to GitHub
2. Connect your GitHub repo to Railway
3. Add all environment variables in Railway dashboard
4. Deploy the service
5. Copy your Railway URL
6. Update Slack app URLs with your Railway URL

## Usage

### Commands

- `/project` or `/project list` - Open the project filter modal
- `/project create` or `/project new` - Create a new project
- `/project edit [search]` - List projects for editing (optional search term)
- `/project delete [search]` - List projects for deletion (optional search term)
- `/project help` - Show help information

### Features

1. **Advanced Filtering**: Use the filter modal to search by multiple criteria
2. **Interactive Editing**: Click "Edit" buttons to modify project details
3. **Safe Deletion**: Delete buttons include confirmation dialogs
4. **Real-time Updates**: All changes are immediately reflected in Airtable

## Project Structure

```
prypco-project-bot/
├── index.js          # Main application file
├── package.json      # Dependencies and scripts
├── .env             # Environment variables (not in git)
├── .gitignore       # Git ignore rules
└── README.md        # This file
```

## Troubleshooting

### Railway Deployment Issues

If health checks fail:
1. Ensure all environment variables are set correctly in Railway
2. Check that the bot token starts with `xoxb-`
3. Verify the signing secret matches your Slack app
4. Check Railway logs for specific error messages
5. Make sure you're NOT setting `SLACK_APP_TOKEN` (only needed for Socket Mode)

### Common Issues

1. **"Command not found"**: Ensure your Slack app is installed and URLs are updated
2. **"Invalid token"**: Check your SLACK_BOT_TOKEN in environment variables
3. **"Request signature verification failed"**: Verify SLACK_SIGNING_SECRET is correct
4. **"Airtable error"**: Confirm your API key, base ID, and table IDs are correct

## Support

For issues or questions, please check:
1. Environment variable configuration
2. Slack app permissions and settings
3. Airtable base structure and permissions
4. Network connectivity between your server and both Slack and Airtable APIs

## License

ISC