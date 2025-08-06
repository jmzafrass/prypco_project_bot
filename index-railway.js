// Railway-optimized version with explicit Express server
require('dotenv').config();
const { App } = require('@slack/bolt');
const express = require('express');
const fetch = require('node-fetch');

// Create Express app first
const expressApp = express();
const PORT = process.env.PORT || 8080;

// Add health check endpoints
expressApp.get('/', (req, res) => {
  res.status(200).send('Slack bot is running!');
});

expressApp.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Attach to existing Express app
  receiver: {
    app: expressApp,
    router: expressApp
  }
});

// Add Slack routes
expressApp.use('/slack/events', app.receiver.router);
expressApp.use('/slack/commands', app.receiver.router);

// Airtable configuration
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const PROJECTS_TABLE_ID = process.env.AIRTABLE_PROJECTS_TABLE_ID;
const EMPLOYEES_TABLE_ID = process.env.AIRTABLE_EMPLOYEES_TABLE_ID;

// Copy all your slash command handlers and other functions here...
// (I'm keeping this short for testing)

app.command('/project', async ({ command, ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text: 'Bot is working! Use /project help for commands.'
  });
});

// Start server
const server = expressApp.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});