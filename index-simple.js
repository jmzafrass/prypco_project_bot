// Simple test server to verify Railway connectivity
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('Simple server is running!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: port });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Simple server listening on 0.0.0.0:${port}`);
});

// Keep process alive
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});