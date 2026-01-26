// Ultra simple test function
module.exports = (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'working',
    message: 'Hello from Vercel!',
    timestamp: new Date().toISOString()
  }));
};