const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
require('dotenv').config();

const execPromise = util.promisify(exec);

console.log('🚀 Starting AuraMail Production Backend...');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Database connection
let db;
async function connectDatabase() {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'auramail',
      password: process.env.DB_PASSWORD || 'AuraMail2024_DB_Pass',
      database: process.env.DB_NAME || 'mailserver',
      charset: 'utf8mb4'
    });
    
    console.log('✅ Connected to MySQL database');
    
    // Create users table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS auramail_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        date_of_birth DATE,
        gender ENUM('Male', 'Female', 'Other'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        maildir_path VARCHAR(255),
        INDEX idx_email (email),
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Create sent emails table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS auramail_sent_emails (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        from_email VARCHAR(100) NOT NULL,
        to_email VARCHAR(100) NOT NULL,
        subject VARCHAR(255),
        body TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sendgrid_id VARCHAR(100),
        status ENUM('sent', 'failed', 'pending') DEFAULT 'sent',
        FOREIGN KEY (user_id) REFERENCES auramail_users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_sent_at (sent_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('✅ Database tables initialized');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

// SendGrid configuration
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('✅ SendGrid configured');
}

// JWT middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'AuraMail2024_SuperSecret_JWT_Key_For_Auth', async (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }
    
    try {
      // Verify user still exists in database
      const [users] = await db.execute('SELECT * FROM auramail_users WHERE id = ? AND is_active = TRUE', [decoded.userId]);
      if (users.length === 0) {
        return res.status(403).json({ success: false, error: 'User not found' });
      }
      
      req.user = users[0];
      next();
    } catch (error) {
      console.error('❌ Token verification error:', error);
      res.status(500).json({ success: false, error: 'Authentication error' });
    }
  });
}

// Helper function to create system email account
async function createSystemEmailAccount(username, password) {
  try {
    const email = `${username}@aurafarming.co`;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create virtual user in postfix database
    await db.execute(`
      INSERT INTO virtual_users (email, password, domain_id) 
      SELECT ?, ?, id FROM virtual_domains WHERE name = 'aurafarming.co'
      ON DUPLICATE KEY UPDATE password = VALUES(password)
    `, [email, hashedPassword]);
    
    // Create maildir directory structure
    const maildirPath = `/var/mail/vhosts/aurafarming.co/${username}`;
    await execPromise(`mkdir -p ${maildirPath}/{new,cur,tmp}`);
    await execPromise(`chown -R vmail:vmail ${maildirPath}`);
    await execPromise(`chmod -R 750 ${maildirPath}`);
    
    console.log(`✅ Created system email account: ${email}`);
    console.log(`✅ Created maildir: ${maildirPath}`);
    
    return maildirPath;
    
  } catch (error) {
    console.error('❌ Failed to create system email account:', error);
    throw error;
  }
}

// Helper function to read user-specific emails
async function readUserEmails(username) {
  try {
    const maildirPath = `/var/mail/vhosts/aurafarming.co/${username}`;
    const newPath = path.join(maildirPath, 'new');
    const curPath = path.join(maildirPath, 'cur');
    
    const emails = [];
    
    // Read new emails
    try {
      const newFiles = await fs.readdir(newPath);
      for (const file of newFiles) {
        try {
          const filePath = path.join(newPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          const email = parseEmail(content, file, false);
          if (email) emails.push(email);
        } catch (err) {
          console.error(`Error reading email ${file}:`, err.message);
        }
      }
    } catch (err) {
      console.log(`No new emails directory for ${username} or empty`);
    }
    
    // Read current emails
    try {
      const curFiles = await fs.readdir(curPath);
      for (const file of curFiles) {
        try {
          const filePath = path.join(curPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          const email = parseEmail(content, file, true);
          if (email) emails.push(email);
        } catch (err) {
          console.error(`Error reading email ${file}:`, err.message);
        }
      }
    } catch (err) {
      console.log(`No cur emails directory for ${username} or empty`);
    }
    
    // Sort by date (newest first)
    emails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    console.log(`📧 Found ${emails.length} emails for user: ${username}`);
    return emails;
    
  } catch (error) {
    console.error(`❌ Error reading emails for ${username}:`, error);
    return [];
  }
}

// Enhanced email parsing function
function parseEmail(content, filename, isRead) {
  try {
    const lines = content.split('\n');
    let from = '';
    let to = '';
    let subject = '';
    let date = '';
    let body = '';
    let htmlBody = '';
    let plainBody = '';
    let inHeaders = true;
    let isMultipart = false;
    let boundary = '';
    let inTextPart = false;
    let inHtmlPart = false;
    
    // Parse headers and body
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (inHeaders) {
        if (line.trim() === '') {
          inHeaders = false;
          continue;
        }
        
        if (line.startsWith('From: ')) {
          from = line.substring(6).trim();
        } else if (line.startsWith('To: ')) {
          to = line.substring(4).trim();
        } else if (line.startsWith('Subject: ')) {
          subject = line.substring(9).trim();
        } else if (line.startsWith('Date: ')) {
          date = line.substring(6).trim();
        } else if (line.toLowerCase().includes('content-type: multipart')) {
          isMultipart = true;
          const boundaryMatch = line.match(/boundary[=:]\s*"?([^";\s]+)"?/i);
          if (boundaryMatch) {
            boundary = boundaryMatch[1];
          }
        }
      } else {
        // Parse body content
        if (isMultipart && boundary) {
          if (line.includes(`--${boundary}`)) {
            inTextPart = false;
            inHtmlPart = false;
            continue;
          }
          
          if (line.toLowerCase().includes('content-type: text/plain')) {
            inTextPart = true;
            inHtmlPart = false;
            continue;
          }
          
          if (line.toLowerCase().includes('content-type: text/html')) {
            inTextPart = false;
            inHtmlPart = true;
            continue;
          }
          
          if (line.startsWith('Content-') || line.trim() === '') {
            continue;
          }
          
          if (inTextPart && !line.startsWith('--')) {
            plainBody += line + '\n';
          } else if (inHtmlPart && !line.startsWith('--')) {
            htmlBody += line + '\n';
          }
        } else {
          if (!line.startsWith('Content-') && !line.includes('--0000000000')) {
            body += line + '\n';
          }
        }
      }
    }
    
    // Preserve both HTML and plain text content
    let finalBody = '';
    let isHtml = false;
    
    if (htmlBody.trim()) {
      // Use HTML content with full formatting preserved
      finalBody = htmlBody.trim();
      isHtml = true;
    } else if (plainBody.trim()) {
      // Use plain text content
      finalBody = plainBody.trim();
    } else {
      // Fallback to basic body
      finalBody = body.trim();
    }
    
    body = finalBody;
    
    // Enhanced content decoding
    if (body.match(/^[A-Za-z0-9+/]+={0,2}$/m) && body.length > 50) {
      try {
        const decodedBase64 = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
        if (decodedBase64.length > body.length / 2) {
          body = decodedBase64;
          console.log('✅ Successfully decoded base64 content');
        }
      } catch (e) {
        console.log('❌ Base64 decode failed, keeping original');
      }
    }
    
    // Enhanced quoted-printable decoding for HTML emails
    body = body.replace(/=\r?\n/g, ''); // Remove soft line breaks
    body = body.replace(/=([0-9A-F]{2})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    
    // Also apply to HTML body
    if (htmlBody) {
      htmlBody = htmlBody.replace(/=\r?\n/g, ''); // Remove soft line breaks
      htmlBody = htmlBody.replace(/=([0-9A-F]{2})/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
      });
    }
    
    // Clean up content - Enhanced cleanup for HTML emails
    body = body
      .replace(/Content-Type:.*$/gm, '')
      .replace(/Content-Transfer-Encoding:.*$/gm, '')
      .replace(/--[0-9a-f]+--?\s*/g, '')
      .replace(/^\s*$/gm, '')
      // Remove CSS media queries and style blocks that show as text
      .replace(/@media[^{]*\{[^{}]*\{[^{}]*\}[^{}]*\}/g, '')
      .replace(/@media[^{]*\{[^{}]*\}/g, '')
      // Remove HTML conditional comments like <!--[if mso | IE]> and <=[-[if mso | IE]>
      .replace(/<=?\[-?\[if\s+[^\]]*\]>?/g, '')
      .replace(/<!-?\[-?\[if\s+[^\]]*\]-?>?/g, '')
      .replace(/<!\[endif\]-?>/g, '')
      // Remove style tags and their content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // Remove script tags and their content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      // Clean up extra whitespace and empty lines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
    
    // Also clean up HTML body if it exists
    if (htmlBody) {
      htmlBody = htmlBody
        .replace(/@media[^{]*\{[^{}]*\{[^{}]*\}[^{}]*\}/g, '')
        .replace(/@media[^{]*\{[^{}]*\}/g, '')
        .replace(/<=?\[-?\[if\s+[^\]]*\]>?/g, '')
        .replace(/<!-?\[-?\[if\s+[^\]]*\]-?>?/g, '')
        .replace(/<!\[endif\]-?>/g, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
    }
    
    // Special handling for verification emails
    if ((subject.toLowerCase().includes('verify') && from.toLowerCase().includes('google')) || 
        from.toLowerCase().includes('noreply@google.com')) {
      const fullContent = htmlBody + plainBody + body;
      const googleCodeMatch = fullContent.match(/\b(\d{6})\b/);
      
      if (googleCodeMatch) {
        body = `🔐 GOOGLE EMAIL VERIFICATION CODE\n\nYour Google verification code is: ${googleCodeMatch[1]}\n\nThis code was sent to verify your email address.\n\n(This is an automated verification email from Google)`;
      }
    }
    
    // TikTok verification
    if (subject.toLowerCase().includes('tiktok') || from.toLowerCase().includes('tiktok')) {
      const sixDigitMatch = (htmlBody + plainBody + body).match(/\b\d{6}\b/);
      if (sixDigitMatch) {
        body = `🔐 TIKTOK VERIFICATION CODE\n\nYour TikTok verification code is: ${sixDigitMatch[0]}\n\n(Valid for a limited time)`;
      }
    }
    
    // Extract email from "Name <email>" format
    const extractEmail = (str) => {
      const match = str.match(/<([^>]+)>/);
      return match ? match[1] : str.trim();
    };
    
    // Decode subject if needed
    subject = subject.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (match, encoded) => {
      try {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } catch (e) {
        return match;
      }
    });
    
    const id = parseInt(filename.split('.')[0]) || Date.now();
    
    return {
      id: id,
      from_email: extractEmail(from),
      to_email: extractEmail(to),
      subject: subject || '(No Subject)',
      body: body || '(Empty message)',
      htmlBody: htmlBody.trim() || null, // Include HTML version for rich formatting
      plainBody: plainBody.trim() || null, // Include plain text version
      isHtml: htmlBody.trim().length > 0, // Flag if HTML content exists
      is_read: isRead,
      has_attachments: false,
      created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
      priority: 'normal',
      starred: false,
      folder: 'inbox'
    };
    
  } catch (error) {
    console.error('Error parsing email:', error);
    return null;
  }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'AuraMail Production Backend v2.0',
    timestamp: new Date().toISOString(),
    database: db ? 'connected' : 'disconnected',
    sendgrid: !!process.env.SENDGRID_API_KEY
  });
});

// User registration
app.post('/api/register', async (req, res) => {
  console.log('🔐 Registration requested:', req.body);
  
  const { fullName, username, dateOfBirth, gender, password, confirmPassword } = req.body;
  
  if (!fullName || !username || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields'
    });
  }
  
  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'Passwords do not match'
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters'
    });
  }
  
  try {
    // Check if username/email already exists
    const email = `${username}@aurafarming.co`;
    const [existing] = await db.execute(
      'SELECT id FROM auramail_users WHERE username = ? OR email = ?',
      [username, email]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Username or email already exists'
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create system email account first
    const maildirPath = await createSystemEmailAccount(username, password);
    
    // Insert user into database
    const [result] = await db.execute(`
      INSERT INTO auramail_users (username, email, password_hash, full_name, date_of_birth, gender, maildir_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [username, email, passwordHash, fullName, dateOfBirth, gender, maildirPath]);
    
    const userId = result.insertId;
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: userId, email: email, username: username },
      process.env.JWT_SECRET || 'AuraMail2024_SuperSecret_JWT_Key_For_Auth',
      { expiresIn: '24h' }
    );
    
    console.log(`✅ User registered successfully: ${email}`);
    console.log(`✅ System email account created with maildir: ${maildirPath}`);
    
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: userId,
        email: email,
        fullName: fullName,
        username: username
      },
      token: token
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account'
    });
  }
});

// Portal registration (without /api prefix)
app.post('/register', async (req, res) => {
  console.log('🔐 Portal registration requested:', req.body);
  
  const { fullName, username, dateOfBirth, gender, password, confirmPassword } = req.body;
  
  if (!fullName || !username || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields'
    });
  }
  
  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'Passwords do not match'
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters'
    });
  }
  
  try {
    // Check if username/email already exists
    const email = `${username}@aurafarming.co`;
    const [existing] = await db.execute(
      'SELECT id FROM auramail_users WHERE username = ? OR email = ?',
      [username, email]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Username or email already exists'
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create system email account first
    const maildirPath = await createSystemEmailAccount(username, password);
    
    // Insert user into database
    const [result] = await db.execute(`
      INSERT INTO auramail_users (username, email, password_hash, full_name, date_of_birth, gender, maildir_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [username, email, passwordHash, fullName, dateOfBirth, gender, maildirPath]);
    
    const userId = result.insertId;
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: userId, email: email, username: username },
      process.env.JWT_SECRET || 'AuraMail2024_SuperSecret_JWT_Key_For_Auth',
      { expiresIn: '24h' }
    );
    
    console.log(`✅ Portal user registered successfully: ${email}`);
    console.log(`✅ System email account created with maildir: ${maildirPath}`);
    
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: userId,
        email: email,
        fullName: fullName,
        username: username
      },
      token: token
    });
    
  } catch (error) {
    console.error('❌ Portal registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account'
    });
  }
});

// Username availability check
app.post('/api/check-username', async (req, res) => {
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
    console.error('❌ Username check error:', error);
    res.status(500).json({
      success: false,
      error: 'Database error'
    });
  }
});

// Portal username check (without /api prefix)
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
    console.error('❌ Portal username check error:', error);
    res.status(500).json({
      success: false,
      error: 'Database error'
    });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  console.log('🔐 Login requested:', req.body);
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required'
    });
  }
  
  try {
    const [users] = await db.execute(
      'SELECT * FROM auramail_users WHERE email = ? AND is_active = TRUE',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET || 'AuraMail2024_SuperSecret_JWT_Key_For_Auth',
      { expiresIn: '24h' }
    );
    
    console.log(`✅ Login successful for: ${user.email}`);
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        profile: { full_name: user.full_name },
        username: user.username
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Database error'
    });
  }
});

// Get user's inbox emails
app.get('/api/emails/inbox/:userId', authenticateToken, async (req, res) => {
  console.log(`📬 Inbox request for user: ${req.user.username} (${req.user.email})`);
  
  try {
    const emails = await readUserEmails(req.user.username);
    
    res.json({
      success: true,
      emails: emails,
      count: emails.length,
      message: emails.length > 0 ? `Found ${emails.length} emails` : 'No emails found',
      user: req.user.username
    });
    
  } catch (error) {
    console.error('❌ Error fetching inbox:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch emails'
    });
  }
});

// Get user's sent emails
app.get('/api/emails/sent/:userId', authenticateToken, async (req, res) => {
  console.log(`📤 Sent emails request for user: ${req.user.username}`);
  
  try {
    const [sentEmails] = await db.execute(
      'SELECT * FROM auramail_sent_emails WHERE user_id = ? ORDER BY sent_at DESC',
      [req.user.id]
    );
    
    const formattedEmails = sentEmails.map(email => ({
      id: email.id,
      from_email: email.from_email,
      to_email: email.to_email,
      subject: email.subject,
      body: email.body,
      is_read: true,
      has_attachments: false,
      created_at: email.sent_at,
      priority: 'normal',
      starred: false,
      folder: 'sent'
    }));
    
    res.json({
      success: true,
      emails: formattedEmails,
      count: formattedEmails.length,
      message: `Found ${formattedEmails.length} sent emails`
    });
    
  } catch (error) {
    console.error('❌ Error fetching sent emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sent emails'
    });
  }
});

// Send email
app.post('/api/emails/send', authenticateToken, async (req, res) => {
  console.log(`📧 Send email request from: ${req.user.email}`, req.body);
  
  const { to, subject, body, priority } = req.body;
  
  if (!to || !subject || !body) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: to, subject, body'
    });
  }
  
  try {
    // Users should send from their own email addresses in a webmail system
    const msg = {
      to: to,
      from: req.user.email,
      subject: subject,
      html: body,
      text: body
    };
    
    console.log(`🚀 Sending email via SendGrid from ${req.user.email} to ${to}`);
    
    const response = await sgMail.send(msg);
    
    // Store sent email in database
    await db.execute(`
      INSERT INTO auramail_sent_emails (user_id, from_email, to_email, subject, body, sendgrid_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'sent')
    `, [req.user.id, req.user.email, to, subject, body, response[0].headers['x-message-id'] || null]);
    
    console.log(`✅ Email sent successfully from ${req.user.email} to ${to}`);
    
    res.json({
      success: true,
      message: 'Email sent successfully!',
      sendgrid_status: response[0].statusCode
    });
    
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    
    // Store failed email
    try {
      await db.execute(`
        INSERT INTO auramail_sent_emails (user_id, from_email, to_email, subject, body, status)
        VALUES (?, ?, ?, ?, ?, 'failed')
      `, [req.user.id, req.user.email, to, subject, body]);
    } catch (dbError) {
      console.error('❌ Failed to store failed email:', dbError);
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to send email',
      details: error.message
    });
  }
});

// Email actions
app.post('/api/emails/star', authenticateToken, (req, res) => {
  console.log('⭐ Star email:', req.body);
  res.json({ success: true, message: 'Email starred' });
});

app.post('/api/emails/read', authenticateToken, (req, res) => {
  console.log('👁️ Mark as read:', req.body);
  res.json({ success: true, message: 'Email marked as read' });
});

app.post('/api/emails/move', authenticateToken, (req, res) => {
  console.log('📁 Move email:', req.body);
  res.json({ success: true, message: 'Email moved' });
});

// Initialize database and start server
async function startServer() {
  await connectDatabase();
  
  app.listen(PORT, () => {
    console.log(`🚀 AuraMail Production Backend v2.0 running on port ${PORT}`);
    console.log(`✅ Features: MySQL, JWT Auth, Individual Mailboxes, SendGrid`);
    console.log(`🔐 Database: Connected and ready`);
    console.log(`📧 SendGrid: ${!!process.env.SENDGRID_API_KEY ? 'Configured' : 'Not configured'}`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}); 