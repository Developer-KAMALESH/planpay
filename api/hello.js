// PlanPal Express App for Vercel
const path = require('path');

// Import the built server
const serverHandler = require(path.join(__dirname, '..', 'dist', 'index.cjs'));

module.exports = serverHandler.default || serverHandler;