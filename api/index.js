const path = require('path');

// Import the built server
module.exports = require(path.join(__dirname, '..', 'dist', 'index.cjs'));