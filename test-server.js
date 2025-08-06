// Minimal test server for Railway
const express = require('express');
const app = express();

// MUST use process.env.PORT
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
  console.log('Health check request received');
  res.send('Test server is running!');
});

app.get('/health', (req, res) => {
  console.log('Health endpoint hit');
  res.status(200).send('OK');
});

app.get('/env', (req, res) => {
  res.json({
    port: PORT,
    node_env: process.env.NODE_ENV,
    has_slack_token: !!process.env.SLACK_BOT_TOKEN
  });
});

// Bind to 0.0.0.0 for Railway
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server listening on 0.0.0.0:${PORT}`);
  console.log('Server is ready to accept connections');
});

// Keep alive
setInterval(() => {
  console.log('Server still alive at', new Date().toISOString());
}, 30000);

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});