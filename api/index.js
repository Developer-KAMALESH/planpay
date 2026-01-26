// Simple test to see if basic function works
module.exports = async (req, res) => {
  try {
    // Set proper headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    
    const response = { 
      message: 'Basic function works!', 
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers
    };
    
    res.status(200).json(response);
  } catch (error) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      error: 'Function error', 
      message: error.message,
      stack: error.stack
    });
  }
};