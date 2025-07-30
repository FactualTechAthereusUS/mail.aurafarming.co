const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

console.log('🚀 Starting Production AuraMail Backend...');

const app = express();
const PORT = 4000;

// Database configuration
const dbConfig = {
  host: 'localhost',
  user: 'auramail',
  password: 'AuraMail2024!',
  database: 'auramail_db',
  charset: 'utf8mb4'
};

// Create database pool
let pool;
try {
  pool = mysql.createPool(dbConfig);
  console.log('📊 Database pool created');
} catch (error) {
  console.error('❌ Database pool creation failed:', error.message);
}

// Basic middleware
app.use(express.json());

// Health check
app.get('/api/health', async (req, res) => {
  console.log('Health check requested');
  
  try {
    // Test database connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Production AuraMail Backend is healthy!',
      timestamp: new Date().toISOString(),
      database: 'connected',
      sendgrid: process.env.SENDGRID_API_KEY ? 'configured' : 'not configured'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Backend unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Login with real database authentication
app.post('/api/login', async (req, res) => {
  console.log('Login attempt:', req.body.email);
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }
  
  try {
    // Query user from database
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.created_at 
       FROM users u 
       WHERE u.email = ? AND u.active = 1`,
      [email]
    );
    
    if (rows.length === 0) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    const user = rows[0];
    console.log('✅ User found:', user.email);
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      console.log('❌ Invalid password for:', email);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    console.log('🎉 Login successful:', email);
    
    // Return user data (JWT will be added later)
    res.json({
      success: true,
      token: `temp-token-${user.id}-${Date.now()}`, // Temporary token
      user: {
        id: user.id,
        email: user.email,
        profile: {
          full_name: user.full_name
        }
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Get user emails (basic version)
app.get('/api/emails/inbox/:userId', async (req, res) => {
  console.log('Emails requested for user:', req.params.userId);
  
  try {
    const { userId } = req.params;
    
    // Get user's emails
    const [emails] = await pool.execute(
      `SELECT id, from_email, to_email, subject, body, is_read, created_at, starred, has_attachments
       FROM emails 
       WHERE to_user_id = ? AND deleted = 0 AND folder = 'inbox'
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    res.json({
      success: true,
      emails: emails
    });
    
  } catch (error) {
    console.error('Get emails error:', error);
    res.status(500).json({ success: false, error: 'Failed to get emails' });
  }
});

// Catch all 404
app.use('*', (req, res) => {
  console.log('404:', req.originalUrl);
  res.status(404).json({ 
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎉 Production AuraMail Backend running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`🔐 Database: auramail_db`);
  console.log(`📬 SendGrid: ${process.env.SENDGRID_API_KEY ? 'CONFIGURED' : 'MISSING'}`);
});

console.log('✅ Production backend loaded successfully!'); 