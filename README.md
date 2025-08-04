# Prypco Project Bot

A Slack bot for managing projects stored in Airtable. This bot provides an intuitive interface for viewing, editing, and managing project data directly from Slack.

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
     - `app_mentions:read`
     - `chat:write`
     - `commands`
     - `users:read`
   - Install the app to your workspace
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)

4. In **Slash Commands**:
   - Create a new command: `/project`
   - Request URL: `https://your-domain.com/slack/events`
   - Description: "Manage projects"
   - Usage hint: `[list|edit|delete] [search term]`

5. In **Basic Information**:
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
     - Owner(s) (Link to Employee Table)
     - KPIs / Success Metrics (Long text)
     - Risks & Mitigations (Long text)
     - Last update (Date)
   - **Employee Table** with fields:
     - Name (Single line text)

3. Get your Airtable credentials:
   - Base ID (found in API documentation for your base)
   - API Key (create from https://airtable.com/account)
   - Table IDs for both Projects and Employees tables

### 3. Environment Configuration

1. Copy the `.env` file and update with your credentials:

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # Only if using Socket Mode

# Airtable Configuration
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_API_KEY=your-api-key
AIRTABLE_PROJECTS_TABLE_ID=your-projects-table-id
AIRTABLE_EMPLOYEES_TABLE_ID=your-employees-table-id

# Server Configuration
PORT=3000
```

### 4. Installation & Running

1. Install dependencies:
```bash
npm install
```

2. Start the application:
```bash
npm start
```

Or for development with auto-restart:
```bash
npm run dev
```

3. For production deployment, consider using PM2:
```bash
npm install -g pm2
pm2 start index.js --name "prypco-project-bot"
```

### 5. Slack App URLs Configuration

Update your Slack app's Request URLs to point to your deployed application:
- Events Request URL: `https://your-domain.com/slack/events`
- Slash Commands Request URL: `https://your-domain.com/slack/events`

## Usage

### Commands

- `/project` - Open the project filter modal
- `/project list` - Same as above
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

### Common Issues

1. **"Command not found"**: Ensure your Slack app is installed and the slash command is configured
2. **"Connection failed"**: Check your environment variables and network connectivity
3. **"Permission denied"**: Verify your Slack bot has the required OAuth scopes
4. **"Airtable error"**: Confirm your API key, base ID, and table IDs are correct

### Logs

The application logs important events to the console. Check your server logs for detailed error information.

## Support

For issues or questions, please check:
1. Environment variable configuration
2. Slack app permissions and settings
3. Airtable base structure and permissions
4. Network connectivity between your server and both Slack and Airtable APIs

## License

ISC