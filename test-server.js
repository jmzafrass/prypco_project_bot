// Minimal test server for Railway
const express = require('express');
const app = express();

// MUST use process.env.PORT
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('Test server is running!');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/env', (req, res) => {
  res.json({
    port: PORT,
    node_env: process.env.NODE_ENV,
    has_slack_token: !!process.env.SLACK_BOT_TOKEN
  });
});

const server = app.listen(PORT, () => {
  console.log(`Test server listening on port ${PORT}`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});