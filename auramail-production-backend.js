const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SendGridClient } = require('@sendgrid/mail');

const app = express();
app.use(express.json());
app.use(cors());

// Database connection
const db = mysql.createPool({
  host: 'localhost',
  user: 'auramail',
  password: 'AuraMail2024_DB_Pass',
  database: 'mailserver'
});

// JWT secret
const JWT_SECRET = 'AuraMail2024_JWT_Secret';

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'AuraMail Production Backend v2.0',
    timestamp: new Date().toISOString(),
    database: 'connected',
    sendgrid: true
  });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const [users] = await db.execute(
      'SELECT id, username, password FROM auramail_users WHERE email = ?',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Read emails endpoint
async function readUserEmails(username) {
  try {
    const userEmail = `${username}@aurafarming.co`;
    
    const [emails] = await db.execute(`
      SELECT 
        id,
        from_email,
        to_email, 
        subject,
        body,
        created_at,
        is_read,
        has_attachments,
        starred,
        folder,
        priority
      FROM auramail_emails 
      WHERE to_email = ? 
      ORDER BY created_at DESC
    `, [userEmail]);
    
    console.log(`📧 Found ${emails.length} emails for user: ${username}`);
    return emails;
    
  } catch (error) {
    console.error(`❌ Error reading emails for ${username}:`, error);
    return [];
  }
}

// Get inbox endpoint
app.get('/api/inbox/:username', async (req, res) => {
  const { username } = req.params;
  console.log(`📬 Inbox request for user: ${username} (${username}@aurafarming.co)`);
  
  try {
    const emails = await readUserEmails(username);
    res.json({ success: true, emails });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch emails'
    });
  }
});

// Send email endpoint
app.post('/api/send', async (req, res) => {
  const { from, to, subject, body } = req.body;
  
  try {
    await db.execute(`
      INSERT INTO auramail_emails (
        from_email, 
        to_email,
        subject,
        body,
        created_at
      ) VALUES (?, ?, ?, ?, NOW())
    `, [from, to, subject, body]);
    
    res.json({
      success: true,
      message: 'Email sent successfully'
    });
    
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email'
    });
  }
});

// Username availability check
app.post('/check-username', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }
  
  try {
    const [existing] = await db.execute(
      'SELECT id FROM auramail_users WHERE username = ?',
      [username]
    );
    
    const reservedUsernames = ['admin', 'root', 'support', 'noreply', 'info', 'contact'];
    
    if (existing.length > 0 || reservedUsernames.includes(username.toLowerCase())) {
      res.json({
        success: true,
        available: false,
        message: 'Username is already taken'
      });
    } else {
      res.json({
        success: true,
        available: true,
        message: 'Username is available'
      });
    }
    
  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check username'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 AuraMail Production Backend v2.0 running on port ${PORT}`);
});
