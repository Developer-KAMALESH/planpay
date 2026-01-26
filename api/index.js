// Simple test to see if basic function works
module.exports = async (req, res) => {
  try {
    res.status(200).json({ 
      message: 'Basic function works!', 
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Function error', 
      message: error.message 
    });
  }
};