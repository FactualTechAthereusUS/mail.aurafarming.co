const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const jwt = require('jsonwebtoken');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'AuraMail2024_SuperSecret_JWT_Key_For_Auth';

// SendGrid configuration
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || 'YOUR_SENDGRID_API_KEY_HERE';
const USE_SENDGRID = process.env.USE_SENDGRID === 'true';

if (USE_SENDGRID && SENDGRID_API_KEY !== 'YOUR_SENDGRID_API_KEY_HERE') {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('📧 SendGrid configured for email delivery');
  console.log(`🔑 API Key: SG.${SENDGRID_API_KEY.split('.')[1]?.substring(0, 8)}...`);
} else {
  console.log('📧 Using local SMTP server for email delivery');
}

// Enhanced security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.aurafarming.co", "https://mail.aurafarming.co", "wss:", "ws:"]
    }
  }
}));

// Enhanced CORS configuration for webmail
app.use(cors({
  origin: [
    'https://portal.aurafarming.co',
    'https://mail.aurafarming.co', 
    'https://admin.aurafarming.co',
    'https://fullaurafarm.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enhanced file upload configuration
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    // Allow most file types but block executables
    const allowedTypes = /\.(jpg|jpeg|png|gif|pdf|doc|docx|txt|xlsx|pptx|zip|mp4|mp3)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

// Database configuration - optimized for production
const dbConfig = {
  host: 'localhost',
  user: 'auramail',
  password: 'AuraMail2024!',
  database: 'mailserver',
  waitForConnections: true,
  connectionLimit: 50, // Increased for better performance
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
};

const pool = mysql.createPool(dbConfig);

// Enhanced nodemailer configuration (fallback)
const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 587,
  secure: false,
  auth: {
    user: 'noreply@aurafarming.co',
    pass: 'AuraMail2024!'
  },
  tls: {
    rejectUnauthorized: false
  },
  pool: true, // Use connection pooling
  maxConnections: 10,
  maxMessages: 100
});

// Enhanced email sending function with SendGrid support
const sendEmail = async (mailOptions) => {
  if (USE_SENDGRID && SENDGRID_API_KEY !== 'YOUR_SENDGRID_API_KEY_HERE') {
    try {
      // SendGrid format
      const msg = {
        to: mailOptions.to,
        from: mailOptions.from,
        subject: mailOptions.subject,
        html: mailOptions.html,
        attachments: mailOptions.attachments ? mailOptions.attachments.map(att => ({
          content: require('fs').readFileSync(att.path).toString('base64'),
          filename: att.filename,
          type: att.mimetype || 'application/octet-stream'
        })) : []
      };
      
      await sgMail.send(msg);
      console.log('✅ Email sent via SendGrid to:', mailOptions.to);
      return { success: true, provider: 'SendGrid' };
    } catch (error) {
      console.warn('❌ SendGrid failed, falling back to SMTP:', error.message);
      // Fall back to SMTP
      await transporter.sendMail(mailOptions);
      return { success: true, provider: 'SMTP-Fallback' };
    }
  } else {
    // Use SMTP directly
    await transporter.sendMail(mailOptions);
    console.log('✅ Email sent via SMTP to:', mailOptions.to);
    return { success: true, provider: 'SMTP' };
  }
};

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ===== ENHANCED AUTHENTICATION ENDPOINTS =====

// Health check with detailed status
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await pool.execute('SELECT 1');
    
    // Test email connection
    let emailStatus = 'unknown';
    if (USE_SENDGRID && SENDGRID_API_KEY !== 'YOUR_SENDGRID_API_KEY_HERE') {
      emailStatus = 'SendGrid configured';
    } else {
      try {
        await transporter.verify();
        emailStatus = 'SMTP connected';
      } catch (error) {
        emailStatus = 'SMTP error';
      }
    }
    
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AuraMail Complete Backend System',
    port: PORT,
      version: '3.0.0',
      database: 'connected',
      smtp: emailStatus,
      sendgrid: USE_SENDGRID ? 'enabled' : 'disabled',
      features: ['authentication', 'email_management', 'file_uploads', 'real_time', 'sendgrid_support']
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced login with JWT tokens
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }

    // Get user with enhanced data
    const [users] = await pool.execute(
      `SELECT u.id, u.email, u.password, p.full_name, p.date_of_birth, p.gender, p.country, p.created_at
       FROM virtual_users u 
       LEFT JOIN user_profiles p ON u.id = p.user_id 
       WHERE u.email = ?`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    const user = users[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        full_name: user.full_name 
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Update last login
    await pool.execute(
      'UPDATE virtual_users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    res.json({ 
      success: true, 
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        profile: {
          full_name: user.full_name,
          date_of_birth: user.date_of_birth,
          gender: user.gender,
          country: user.country,
          created_at: user.created_at
        }
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during login' 
    });
  }
});

// ===== ENHANCED EMAIL MANAGEMENT ENDPOINTS =====

// Get user's emails with advanced filtering
app.get('/api/emails/:folder/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId, folder } = req.params;
    const { page = 1, limit = 50, search = '', unread_only = false } = req.query;
    const offset = (page - 1) * limit;

    // Verify user owns the request or is admin
    if (req.user.id !== parseInt(userId) && req.user.email !== 'admin@aurafarming.co') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let whereClause = 'WHERE e.deleted = 0';
    let params = [];

    // Folder filtering
    if (folder === 'inbox') {
      whereClause += ' AND e.to_user_id = ? AND e.folder = "inbox"';
      params.push(userId);
    } else if (folder === 'sent') {
      whereClause += ' AND e.from_user_id = ? AND e.folder = "sent"';
      params.push(userId);
    } else if (folder === 'drafts') {
      whereClause += ' AND e.from_user_id = ? AND e.folder = "drafts"';
      params.push(userId);
    } else if (folder === 'trash') {
      whereClause += ' AND (e.to_user_id = ? OR e.from_user_id = ?) AND e.deleted = 1';
      params.push(userId, userId);
    } else if (folder === 'starred') {
      whereClause += ' AND (e.to_user_id = ? OR e.from_user_id = ?) AND e.starred = 1';
      params.push(userId, userId);
    } else {
      whereClause += ' AND (e.to_user_id = ? OR e.from_user_id = ?)';
      params.push(userId, userId);
    }

    // Search filtering
    if (search) {
      whereClause += ' AND (e.subject LIKE ? OR e.body LIKE ? OR e.from_email LIKE ? OR e.to_email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Unread filtering
    if (unread_only === 'true') {
      whereClause += ' AND e.is_read = 0';
    }

    const [emails] = await pool.execute(
      `SELECT e.id, e.from_email, e.to_email, e.subject, e.body, e.is_read, 
              e.has_attachments, e.created_at, e.priority, e.starred, e.folder,
              e.thread_id, e.reply_to_id
       FROM emails e 
       ${whereClause}
       ORDER BY e.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    // Get total count
    const [count] = await pool.execute(
      `SELECT COUNT(*) as total FROM emails e ${whereClause}`,
      params
    );

    // Get unread count
    const [unreadCount] = await pool.execute(
      `SELECT COUNT(*) as unread FROM emails e 
       WHERE e.to_user_id = ? AND e.is_read = 0 AND e.deleted = 0 AND e.folder = 'inbox'`,
      [userId]
    );

    res.json({
      success: true,
      emails: emails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count[0].total,
        pages: Math.ceil(count[0].total / limit)
      },
      stats: {
        unread: unreadCount[0].unread,
        total: count[0].total
      }
    });

  } catch (error) {
    console.error('Fetch emails error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch emails' 
    });
  }
});

// Enhanced email sending with SendGrid and threading support
app.post('/api/emails/send', authenticateToken, upload.array('attachments', 10), async (req, res) => {
  try {
    const { to, subject, body, priority = 'normal', reply_to_id = null } = req.body;
    const attachments = req.files || [];
    const fromUserId = req.user.id;
    const fromEmail = req.user.email;

    if (!to || !subject) {
      return res.status(400).json({ 
        success: false, 
        error: 'To and subject are required' 
      });
    }

    // Handle multiple recipients
    const recipients = to.split(',').map(email => email.trim());
    const sentEmails = [];

    for (const recipientEmail of recipients) {
      // Get recipient ID (if internal user)
      const [recipientInfo] = await pool.execute(
        'SELECT id FROM virtual_users WHERE email = ?',
        [recipientEmail]
      );

      const toUserId = recipientInfo.length > 0 ? recipientInfo[0].id : null;

      // Determine thread ID
      let threadId = null;
      if (reply_to_id) {
        const [originalEmail] = await pool.execute(
          'SELECT thread_id FROM emails WHERE id = ?',
          [reply_to_id]
        );
        threadId = originalEmail[0]?.thread_id || reply_to_id;
      }

      // Save email to database
      const [emailResult] = await pool.execute(
        `INSERT INTO emails (from_user_id, to_user_id, from_email, to_email, subject, body, 
                            folder, priority, has_attachments, thread_id, reply_to_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, 'inbox', ?, ?, ?, ?, NOW())`,
        [fromUserId, toUserId, fromEmail, recipientEmail, subject, body, priority, attachments.length > 0, threadId, reply_to_id]
      );

      // Also save to sender's sent folder
      await pool.execute(
        `INSERT INTO emails (from_user_id, to_user_id, from_email, to_email, subject, body, 
                            folder, priority, has_attachments, thread_id, reply_to_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, NOW())`,
        [fromUserId, toUserId, fromEmail, recipientEmail, subject, body, priority, attachments.length > 0, threadId, reply_to_id]
      );

      // Handle attachments
      if (attachments.length > 0) {
        for (const file of attachments) {
          await pool.execute(
            `INSERT INTO email_attachments (email_id, filename, original_name, file_path, file_size, mime_type) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [emailResult.insertId, file.filename, file.originalname, file.path, file.size, file.mimetype]
          );
        }
      }

      // Send via enhanced email system (SendGrid or SMTP)
      try {
        const mailOptions = {
          from: `"${req.user.full_name || fromEmail}" <${fromEmail}>`,
          to: recipientEmail,
          subject: subject,
          html: body,
          attachments: attachments.map(file => ({
            filename: file.originalname,
            path: file.path,
            mimetype: file.mimetype
          }))
        };

        const result = await sendEmail(mailOptions);
        sentEmails.push({ 
          email: recipientEmail, 
          status: 'sent', 
          provider: result.provider 
        });
      } catch (emailError) {
        console.warn('Email send failed:', emailError);
        sentEmails.push({ 
          email: recipientEmail, 
          status: 'failed', 
          error: emailError.message 
        });
      }
    }

    res.json({ 
      success: true, 
      message: 'Email processing completed',
      results: sentEmails,
      total_recipients: recipients.length,
      sendgrid_enabled: USE_SENDGRID
    });

  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send email' 
    });
  }
});

// ===== ADDITIONAL ENHANCED ENDPOINTS =====

// Mark email as read/unread
app.put('/api/emails/:emailId/read', authenticateToken, async (req, res) => {
  try {
    const { emailId } = req.params;
    const { is_read = true } = req.body;

    await pool.execute(
      'UPDATE emails SET is_read = ? WHERE id = ? AND (to_user_id = ? OR from_user_id = ?)',
      [is_read ? 1 : 0, emailId, req.user.id, req.user.id]
    );

    res.json({ 
      success: true, 
      message: `Email marked as ${is_read ? 'read' : 'unread'}` 
    });

  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update email status' 
    });
  }
});

// Star/unstar email
app.put('/api/emails/:emailId/star', authenticateToken, async (req, res) => {
  try {
    const { emailId } = req.params;
    const { starred = true } = req.body;

    await pool.execute(
      'UPDATE emails SET starred = ? WHERE id = ? AND (to_user_id = ? OR from_user_id = ?)',
      [starred ? 1 : 0, emailId, req.user.id, req.user.id]
    );

    res.json({ 
      success: true, 
      message: `Email ${starred ? 'starred' : 'unstarred'}` 
    });

  } catch (error) {
    console.error('Star email error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to star email' 
    });
  }
});

// Move email to folder (archive, trash, etc.)
app.put('/api/emails/:emailId/move', authenticateToken, async (req, res) => {
  try {
    const { emailId } = req.params;
    const { folder } = req.body;

    const validFolders = ['inbox', 'sent', 'drafts', 'trash', 'archive'];
    if (!validFolders.includes(folder)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid folder' 
      });
    }

    if (folder === 'trash') {
      await pool.execute(
        'UPDATE emails SET deleted = 1, folder = ? WHERE id = ? AND (to_user_id = ? OR from_user_id = ?)',
        [folder, emailId, req.user.id, req.user.id]
      );
    } else {
      await pool.execute(
        'UPDATE emails SET folder = ?, deleted = 0 WHERE id = ? AND (to_user_id = ? OR from_user_id = ?)',
        [folder, emailId, req.user.id, req.user.id]
      );
    }

    res.json({ 
      success: true, 
      message: `Email moved to ${folder}` 
    });

  } catch (error) {
    console.error('Move email error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to move email' 
    });
  }
});

// Get email statistics for dashboard
app.get('/api/emails/stats/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.id !== parseInt(userId) && req.user.email !== 'admin@aurafarming.co') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const [stats] = await pool.execute(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN is_read = 0 AND folder = 'inbox' AND deleted = 0 THEN 1 ELSE 0 END) as unread,
         SUM(CASE WHEN folder = 'sent' THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) as deleted,
         SUM(CASE WHEN starred = 1 AND deleted = 0 THEN 1 ELSE 0 END) as starred,
         SUM(CASE WHEN folder = 'drafts' THEN 1 ELSE 0 END) as drafts
       FROM emails 
       WHERE to_user_id = ? OR from_user_id = ?`,
      [userId, userId]
    );

    res.json({ 
      success: true, 
      stats: stats[0] 
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch statistics' 
    });
  }
});

// ===== KEEP EXISTING ENDPOINTS =====

// Check username availability (keep for registration portal)
app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ 
        available: false, 
        error: 'Username is required' 
      });
    }

    const email = `${username}@aurafarming.co`;
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as count FROM virtual_users WHERE email = ?',
      [email]
    );

    const isAvailable = rows[0].count === 0;
    
    res.json({ 
      available: isAvailable,
      username: username,
      email: email,
      message: isAvailable ? 'Username is available' : 'Username is already taken'
    });

  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({ 
      available: false, 
      error: 'Server error checking username' 
    });
  }
});

// Register new user (keep for registration portal)
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, username, dateOfBirth, gender, country, password } = req.body;

    // Validate required fields
    if (!fullName || !username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    const email = `${username}@aurafarming.co`;
    
    // Check if username already exists
    const [existing] = await pool.execute(
      'SELECT COUNT(*) as count FROM virtual_users WHERE email = ?',
      [email]
    );

    if (existing[0].count > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'Username already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert user
    const [result] = await pool.execute(
      'INSERT INTO virtual_users (domain_id, email, password) VALUES (?, ?, ?)',
      [1, email, hashedPassword]
    );

    // Create user profile
    await pool.execute(
      `INSERT INTO user_profiles (user_id, full_name, date_of_birth, gender, country, created_at) 
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [result.insertId, fullName, dateOfBirth, gender, country]
    );

    console.log('New user registered:', { 
      id: result.insertId, 
      email: email,
      fullName: fullName 
    });

    // Send welcome email with enhanced email system
    try {
      const mailOptions = {
        from: '"AuraMail Team" <noreply@aurafarming.co>',
        to: email,
        subject: 'Welcome to AuraMail! 🎉',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
            <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding: 30px; border-radius: 12px; text-align: center; margin-bottom: 20px;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to AuraMail! 🎉</h1>
            </div>
            <div style="background: white; padding: 30px; border-radius: 12px; border: 1px solid #e5e7eb;">
              <h2 style="color: #1f2937; margin-top: 0;">Hi ${fullName}!</h2>
              <p style="color: #4b5563; line-height: 1.6;">Your professional email account <strong>${email}</strong> has been created successfully.</p>
              <p style="color: #4b5563; line-height: 1.6;">You can now access your inbox at:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://mail.aurafarming.co" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Open AuraMail</a>
              </div>
              <p style="color: #4b5563; line-height: 1.6;">Best regards,<br><strong>The AuraMail Team</strong></p>
            </div>
          </div>
        `
      };

      await sendEmail(mailOptions);
      console.log('✅ Welcome email sent to:', email);
    } catch (emailError) {
      console.warn('Welcome email failed:', emailError);
    }

    res.status(201).json({ 
      success: true, 
      message: 'Account created successfully',
      email: email,
      userId: result.insertId
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during registration' 
    });
  }
});

// Get all users (for admin)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    // Only admin can access this
    if (req.user.email !== 'admin@aurafarming.co') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const [users] = await pool.execute(
      `SELECT u.id, u.email, p.full_name, p.created_at, u.last_login,
              COUNT(e.id) as email_count
       FROM virtual_users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       LEFT JOIN emails e ON u.id = e.to_user_id
       GROUP BY u.id, u.email, p.full_name, p.created_at, u.last_login
       ORDER BY p.created_at DESC`
    );

    res.json({ 
      success: true, 
      users: users 
    });

  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch users' 
    });
  }
});

// Search emails
app.get('/api/emails/search/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { q, folder = 'inbox' } = req.query;

    if (req.user.id !== parseInt(userId) && req.user.email !== 'admin@aurafarming.co') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!q) {
      return res.status(400).json({ 
        success: false, 
        error: 'Search query is required' 
      });
    }

    const [emails] = await pool.execute(
      `SELECT e.id, e.from_email, e.to_email, e.subject, e.body, e.is_read, 
              e.has_attachments, e.created_at, e.priority, e.starred, e.folder
       FROM emails e 
       WHERE (e.to_user_id = ? OR e.from_user_id = ?) 
         AND e.folder = ? 
         AND e.deleted = 0
         AND (e.subject LIKE ? OR e.body LIKE ? OR e.from_email LIKE ?)
       ORDER BY e.created_at DESC 
       LIMIT 50`,
      [userId, userId, folder, `%${q}%`, `%${q}%`, `%${q}%`]
    );

    res.json({
      success: true,
      emails: emails,
      query: q
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Search failed' 
    });
  }
});

// Get email attachments
app.get('/api/emails/:emailId/attachments', authenticateToken, async (req, res) => {
  try {
    const { emailId } = req.params;

    // Verify user has access to this email
    const [emailCheck] = await pool.execute(
      'SELECT id FROM emails WHERE id = ? AND (to_user_id = ? OR from_user_id = ?)',
      [emailId, req.user.id, req.user.id]
    );

    if (emailCheck.length === 0) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const [attachments] = await pool.execute(
      'SELECT id, filename, original_name, file_size, mime_type FROM email_attachments WHERE email_id = ?',
      [emailId]
    );

    res.json({
      success: true,
      attachments: attachments
    });

  } catch (error) {
    console.error('Attachments fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch attachments' 
    });
  }
});

// Download attachment
app.get('/api/emails/attachment/:attachmentId', authenticateToken, async (req, res) => {
  try {
    const { attachmentId } = req.params;

    const [attachment] = await pool.execute(
      `SELECT a.*, e.to_user_id, e.from_user_id 
       FROM email_attachments a 
       JOIN emails e ON a.email_id = e.id 
       WHERE a.id = ?`,
      [attachmentId]
    );

    if (attachment.length === 0 || 
        (attachment[0].to_user_id !== req.user.id && attachment[0].from_user_id !== req.user.id)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const file = attachment[0];
    res.download(file.file_path, file.original_name);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to download attachment' 
    });
  }
});

// SendGrid webhook endpoint for email events
app.post('/api/sendgrid/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const events = JSON.parse(req.body.toString());
    
    for (const event of events) {
      console.log('📧 SendGrid Event:', {
        event: event.event,
        email: event.email,
        timestamp: event.timestamp,
        reason: event.reason
      });
      
      // You can store these events in database for analytics
      // await pool.execute('INSERT INTO email_events ...');
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('SendGrid webhook error:', error);
    res.status(400).send('Bad Request');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AuraMail Enhanced Backend System running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📧 Enhanced email system with JWT auth ready!`);
  console.log(`🔐 JWT Authentication enabled`);
  console.log(`⚡ Real-time features ready`);
  if (USE_SENDGRID) {
    console.log(`📬 SendGrid integration: ${SENDGRID_API_KEY !== 'YOUR_SENDGRID_API_KEY_HERE' ? 'ACTIVE' : 'PENDING API KEY'}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end();
  process.exit(0);
}); 