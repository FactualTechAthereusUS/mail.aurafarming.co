const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Basic middleware
app.use(cors({
  origin: [
    'https://portal.aurafarming.co',
    'https://mail.aurafarming.co',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use(express.json());

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'AuraMail Backend is running!',
    timestamp: new Date().toISOString(),
    sendgrid: process.env.SENDGRID_API_KEY ? 'configured' : 'not configured'
  });
});

// Simple login endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  if (email === 'alladin@aurafarming.co' && password === 'test123') {
    res.json({
      success: true,
      token: 'test-token-123',
      user: { id: 1, email: 'alladin@aurafarming.co', profile: { full_name: 'Alladin' } }
    });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Catch all 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Simple AuraMail Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔐 SendGrid: ${process.env.SENDGRID_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
}); 