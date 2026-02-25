// Vercel Serverless Function entry
// Express app is exported from server.js (no app.listen in serverless)

const app = require('../server');

module.exports = app;
