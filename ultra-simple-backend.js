const express = require('express');
const sgMail = require('@sendgrid/mail');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// FIXED: In-memory storage for sent emails and users (in production, use database)
let sentEmailsStorage = [];
let registeredUsers = [
  {
    id: 1,
    email: 'alladin@aurafarming.co',
    password: 'test123',
    fullName: 'Alladin',
    username: 'alladin',
    created_at: new Date().toISOString()
  }
];

console.log('🚀 Starting ultra-simple backend...');

const app = express();
const PORT = 4000;

// Configure SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('📧 SendGrid configured with API key');
}

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Function to read real emails from Maildir
async function readRealEmails(username) {
  try {
    const maildirPath = `/var/mail/vhosts/aurafarming.co/${username}`;
    const newEmailsPath = path.join(maildirPath, 'new');
    const curEmailsPath = path.join(maildirPath, 'cur');
    
    console.log(`📬 Reading emails from: ${maildirPath}`);
    
    const emails = [];
    
    // Read new (unread) emails
    try {
      const newFiles = await fs.readdir(newEmailsPath);
      for (const file of newFiles) {
        try {
          const filePath = path.join(newEmailsPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          const email = parseEmail(content, file, false); // false = unread
          if (email) emails.push(email);
        } catch (err) {
          console.error(`Error reading email ${file}:`, err.message);
        }
      }
    } catch (err) {
      console.log('No new emails directory or empty');
    }
    
    // Read current (read) emails
    try {
      const curFiles = await fs.readdir(curEmailsPath);
      for (const file of curFiles) {
        try {
          const filePath = path.join(curEmailsPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          const email = parseEmail(content, file, true); // true = read
          if (email) emails.push(email);
        } catch (err) {
          console.error(`Error reading email ${file}:`, err.message);
        }
      }
    } catch (err) {
      console.log('No cur emails directory or empty');
    }
    
    // Sort by date (newest first)
    emails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    console.log(`📧 Found ${emails.length} real emails for ${username}`);
    return emails;
    
  } catch (error) {
    console.error('Error reading emails:', error);
    return [];
  }
}

// FIXED: Advanced email parser that handles MIME properly
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
    let currentContentType = '';
    
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
        // FIXED: Parse body content with separate HTML and plain text handling
        if (isMultipart && boundary) {
          // Handle multipart MIME
          if (line.includes(`--${boundary}`)) {
            inTextPart = false;
            inHtmlPart = false;
            currentContentType = '';
            continue;
          }
          
          if (line.toLowerCase().includes('content-type: text/plain')) {
            inTextPart = true;
            inHtmlPart = false;
            currentContentType = 'plain';
            continue;
          }
          
          if (line.toLowerCase().includes('content-type: text/html')) {
            inTextPart = false;
            inHtmlPart = true;
            currentContentType = 'html';
            continue;
          }
          
          if (line.startsWith('Content-') || line.trim() === '') {
            continue; // Skip other headers and empty lines in MIME parts
          }
          
          if (inTextPart && !line.startsWith('--')) {
            plainBody += line + '\n';
          } else if (inHtmlPart && !line.startsWith('--')) {
            htmlBody += line + '\n';
          }
        } else {
          // Simple email, just add all body content
          if (!line.startsWith('Content-') && !line.includes('--0000000000')) {
            body += line + '\n';
          }
        }
      }
    }
    
    // FIXED: Choose the best body content (prefer plain text, fallback to HTML)
    if (plainBody.trim()) {
      body = plainBody.trim();
    } else if (htmlBody.trim()) {
      body = htmlBody.trim();
    } else {
      body = body.trim();
    }
    
    // ENHANCED DECODING: Handle base64, quoted-printable, and other encodings
    // First check if content looks like base64
    if (body.match(/^[A-Za-z0-9+/]+={0,2}$/m) && body.length > 50) {
      try {
        const decodedBase64 = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
        if (decodedBase64.length > body.length / 2) { // Sanity check
          body = decodedBase64;
          console.log('✅ Successfully decoded base64 content');
        }
      } catch (e) {
        console.log('❌ Base64 decode failed, keeping original');
      }
    }
    
    // Decode quoted-printable if needed
    body = body.replace(/=([0-9A-F]{2})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    
    // Remove any remaining MIME artifacts
    body = body.replace(/--[0-9a-f]+--?\s*/g, '');
    body = body.replace(/Content-Type:.*$/gm, '');
    body = body.replace(/Content-Transfer-Encoding:.*$/gm, '');
    body = body.replace(/^\s*$/gm, ''); // Remove empty lines
    body = body.trim();
    
    // FIXED: More aggressive content extraction for HTML emails
    if (body.includes('html') || body.includes('<') || body.length < 10) {
      // Log the raw content for debugging
      console.log(`🔍 Parsing email with body length: ${body.length}, first 200 chars:`, body.substring(0, 200));
      
      const cleaningPatterns = [
        // Google verification patterns FIRST (highest priority)
        /verify your email address|verification link|click.*verify|confirm(?:ing)?\s+email/i,
        /https?:\/\/[^\s<>"]+verify[^\s<>"]*|https?:\/\/accounts\.google\.com[^\s<>"]+/i,
        /To complete.*verification|complete.*setup|finish.*verification/i,
        /click.*link|follow.*link|visit.*link/i,
        // TikTok specific patterns - try multiple variations
        /(\d{6})\s*is\s*your\s*TikTok\s*code/i,
        /TikTok\s*code[\s\S]*?(\d{6})/i,
        /your\s*code[\s\S]*?(\d{6})/i,
        /verification[\s\S]*?(\d{6})/i,
        // More specific TikTok patterns
        /\b\d{6}\b.*?TikTok/i,
        /TikTok.*?\b\d{6}\b/i,
        // Just find any 6-digit code in TikTok emails
        /\b\d{6}\b/,
        // General patterns  
        /soon we gonna takeover gmail/i,
        /we are making it happen/i,
        /soon billionaire/i,
        // Broader text extraction
        /[a-zA-Z0-9\s.,!?]{10,}/
      ];
      
      for (const pattern of cleaningPatterns) {
        const match = body.match(pattern);
        if (match) {
          console.log(`✅ Pattern matched: ${pattern}, result: ${match[0]}`);
          body = match[0].trim();
          break;
        }
      }
      
      // Special handling for Google emails - try to extract verification info
      if ((subject.toLowerCase().includes('verify') && from.toLowerCase().includes('google')) || 
          from.toLowerCase().includes('noreply@google.com')) {
        console.log('🔍 Processing Google verification email');
        
        // Try to find verification code first (6 digits for Google)
        const fullContent = htmlBody + plainBody + body;
        const googleCodeMatch = fullContent.match(/\b(\d{6})\b/);
        
        if (googleCodeMatch) {
          body = `🔐 GOOGLE EMAIL VERIFICATION CODE\n\nYour Google verification code is: ${googleCodeMatch[1]}\n\nThis code was sent to verify your email address: alladin@aurafarming.co\n\n(This is an automated verification email from Google)`;
          console.log(`🎯 Extracted Google verification code: ${googleCodeMatch[1]}`);
        } else {
          // Try to find verification URL
          const verifyUrlMatch = fullContent.match(/(https?:\/\/[^\s<>"]+verify[^\s<>"]*)/i);
          const googleUrlMatch = fullContent.match(/(https?:\/\/accounts\.google\.com[^\s<>"]+)/i);
          
          if (verifyUrlMatch || googleUrlMatch) {
            const verificationUrl = verifyUrlMatch ? verifyUrlMatch[1] : googleUrlMatch[1];
            body = `🔐 GOOGLE EMAIL VERIFICATION\n\nTo verify your email address, please click the link below:\n\n${verificationUrl}\n\n(This is an automated verification email from Google)`;
            console.log(`🎯 Extracted Google verification URL: ${verificationUrl}`);
          } else {
            // Look for general verification instructions
            const instructionMatch = fullContent.match(/.{0,300}(verify|confirm|click|complete).{0,300}/i);
            if (instructionMatch) {
              body = `🔐 GOOGLE EMAIL VERIFICATION\n\n${instructionMatch[0].trim()}\n\n(This is an automated verification email from Google)`;
              console.log(`🎯 Extracted Google instructions`);
            } else {
              body = '🔐 Google email verification - please check your email for the verification link.';
            }
          }
        }
      }
      
      // Special handling for TikTok emails - try to find ANY 6-digit number
      else if ((subject.toLowerCase().includes('tiktok') || from.toLowerCase().includes('tiktok'))) {
        const sixDigitMatch = (htmlBody + plainBody + body).match(/\b\d{6}\b/);
        if (sixDigitMatch) {
          body = `🔐 TikTok Code: ${sixDigitMatch[0]}`;
          console.log(`🎯 Extracted TikTok code: ${sixDigitMatch[0]}`);
        } else {
          body = 'TikTok verification email - please check original for code';
        }
      }
      
      // If still no good content, provide a helpful message
      if (body.length < 10 || body.includes('html class')) {
        body = 'HTML email content detected - parsing in progress.';
      }
    }
    
    // Extract email from "Name <email>" format
    const extractEmail = (str) => {
      const match = str.match(/<([^>]+)>/);
      return match ? match[1] : str.trim();
    };
    
    // Decode subject if needed (UTF-8 encoded)
    subject = subject.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (match, encoded) => {
      try {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } catch (e) {
        return match;
      }
    });
    
    // Generate unique ID from filename
    const id = parseInt(filename.split('.')[0]) || Date.now();
    
    return {
      id: id,
      from_email: extractEmail(from),
      to_email: extractEmail(to),
      subject: subject || '(No Subject)',
      body: body || '(Empty message)',
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

// Simple routes without parameters
app.get('/api/health', (req, res) => {
  console.log('Health check requested');
  res.json({ 
    success: true, 
    message: 'Ultra-simple AuraMail Backend is working!',
    timestamp: new Date().toISOString(),
    sendgrid: process.env.SENDGRID_API_KEY ? 'configured' : 'not configured'
  });
});

// USER REGISTRATION ENDPOINT FOR PORTAL
app.post('/api/register', async (req, res) => {
  console.log('🔐 Registration requested:', req.body);
  
  const { fullName, username, dateOfBirth, gender, password, confirmPassword } = req.body;
  
  // Basic validation
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
  
  // FIXED: Check if username is available against stored users
  const reservedUsernames = ['alladin', 'admin', 'root', 'support', 'noreply', 'info', 'contact'];
  const existingUser = registeredUsers.find(user => user.username.toLowerCase() === username.toLowerCase());
  
  if (reservedUsernames.includes(username.toLowerCase()) || existingUser) {
    return res.status(400).json({
      success: false,
      error: 'Username already taken'
    });
  }
  
  try {
    // FIXED: Actually save the user to storage
    const newUser = {
      id: Date.now(),
      email: `${username}@aurafarming.co`,
      password: password, // In production, hash this!
      fullName: fullName,
      username: username,
      dateOfBirth: dateOfBirth,
      gender: gender,
      created_at: new Date().toISOString()
    };
    
    // Add to registered users storage
    registeredUsers.push(newUser);
    
    console.log('✅ User registered and saved:', newUser.email);
    console.log(`📊 Total registered users: ${registeredUsers.length}`);
    
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName
      },
      token: `token-${newUser.id}`
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account'
    });
  }
});

// USERNAME AVAILABILITY CHECK ENDPOINT
app.post('/api/check-username', (req, res) => {
  console.log('👤 Username availability check:', req.body);
  
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }
  
  // Check against reserved usernames
  const reservedUsernames = ['alladin', 'admin', 'root', 'support', 'noreply', 'info', 'contact'];
  
  if (reservedUsernames.includes(username.toLowerCase())) {
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
});

// PORTAL FRONTEND COMPATIBILITY ROUTES (without /api prefix)
app.post('/check-username', (req, res) => {
  console.log('👤 Portal username check:', req.body);
  
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }
  
  // FIXED: Check against reserved usernames and existing users
  const reservedUsernames = ['alladin', 'admin', 'root', 'support', 'noreply', 'info', 'contact'];
  const existingUser = registeredUsers.find(user => user.username.toLowerCase() === username.toLowerCase());
  
  if (reservedUsernames.includes(username.toLowerCase()) || existingUser) {
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
});

app.post('/register', async (req, res) => {
  console.log('🔐 Portal registration requested:', req.body);
  
  const { fullName, username, dateOfBirth, gender, password, confirmPassword } = req.body;
  
  // Basic validation
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
  
  // FIXED: Check if username is available against stored users  
  const reservedUsernames = ['alladin', 'admin', 'root', 'support', 'noreply', 'info', 'contact'];
  const existingUser = registeredUsers.find(user => user.username.toLowerCase() === username.toLowerCase());
  
  if (reservedUsernames.includes(username.toLowerCase()) || existingUser) {
    return res.status(400).json({
      success: false,
      error: 'Username already taken'
    });
  }
  
  try {
    // FIXED: Actually save the portal user to storage
    const newUser = {
      id: Date.now(),
      email: `${username}@aurafarming.co`,
      password: password, // In production, hash this!
      fullName: fullName,
      username: username,
      dateOfBirth: dateOfBirth,
      gender: gender,
      created_at: new Date().toISOString()
    };
    
    // Add to registered users storage
    registeredUsers.push(newUser);
    
    console.log('✅ Portal user registered and saved:', newUser.email);
    console.log(`📊 Total registered users: ${registeredUsers.length}`);
    
    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName
      },
      token: `token-${newUser.id}`
    });
    
  } catch (error) {
    console.error('❌ Portal registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account'
    });
  }
});

app.post('/api/login', (req, res) => {
  console.log('🔐 Login requested:', req.body);
  const { email, password } = req.body;
  
  // FIXED: Check against stored users
  const user = registeredUsers.find(u => u.email === email && u.password === password);
  
  if (user) {
    console.log('✅ Login successful for:', user.email);
    res.json({
      success: true,
      token: `token-${user.id}`,
      user: { 
        id: user.id, 
        email: user.email, 
        profile: { full_name: user.fullName }
      }
    });
  } else {
    console.log('❌ Login failed for:', email);
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// FIXED: Real SendGrid email sending
app.post('/api/emails/send', async (req, res) => {
  console.log('📧 Send email requested:', req.body);
  
  const { to, subject, body, priority, from_user } = req.body;
  
  if (!to || !subject || !body) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: to, subject, body' 
    });
  }
  
  // Determine sender - use actual user email if provided, fallback to noreply
  const senderEmail = from_user || 'noreply@aurafarming.co';
  
          try {
          // FIXED: Send clean emails without branding template
          const msg = {
            to: to,
            from: senderEmail, // Use actual user's email or noreply fallback
            subject: subject,
            html: body, // Just send the actual content
            text: body  // Plain text version
          };
    
    console.log('🚀 Sending email via SendGrid to:', to);
    
    // Send via SendGrid
    const response = await sgMail.send(msg);
    
              console.log('✅ Email sent successfully via SendGrid!');
          console.log('SendGrid response:', response[0].statusCode);
          
          // FIXED: Store sent email for "Sent" folder
          const sentEmail = {
            id: Date.now(),
            from_email: senderEmail,
            to_email: to,
            subject: subject,
            body: body,
            is_read: true, // Sent emails are always "read"
            has_attachments: false,
            created_at: new Date().toISOString(),
            priority: priority || 'normal',
            starred: false,
            folder: 'sent'
          };
          
          sentEmailsStorage.push(sentEmail);
          console.log(`📤 Stored sent email in memory: ${sentEmail.id}`);
          
          res.json({
            success: true,
            message: 'Email sent successfully via SendGrid!',
            email_id: sentEmail.id,
            sendgrid_status: response[0].statusCode
          });
    
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    
    if (error.response) {
      console.error('SendGrid response body:', error.response.body);
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to send email',
      details: error.message
    });
  }
});

// FIXED: Email endpoints using query parameters instead of route parameters
app.get('/api/emails', (req, res) => {
  console.log('Emails requested with query:', req.query);
  
  // Sample emails for testing
  const sampleEmails = [
    {
      id: 1,
      from_email: 'team@aurafarming.co',
      to_email: 'alladin@aurafarming.co',
      subject: '🎉 Welcome to AuraMail!',
      body: 'Welcome to your new email system. AuraMail is now working perfectly!',
      is_read: false,
      has_attachments: false,
      created_at: new Date().toISOString(),
      priority: 'normal',
      starred: false,
      folder: 'inbox'
    },
    {
      id: 2,
      from_email: 'noreply@aurafarming.co',
      to_email: 'alladin@aurafarming.co',
      subject: '✅ Backend Connected Successfully',
      body: 'Your AuraMail backend is now connected and working perfectly with SendGrid integration.',
      is_read: false,
      has_attachments: false,
      created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      priority: 'high',
      starred: true,
      folder: 'inbox'
    },
    {
      id: 3,
      from_email: 'support@aurafarming.co',
      to_email: 'alladin@aurafarming.co',
      subject: '🚀 Your Webmail is Live',
      body: 'Congratulations! Your AuraMail webmail interface is now fully operational.',
      is_read: true,
      has_attachments: false,
      created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      priority: 'normal',
      starred: false,
      folder: 'inbox'
    }
  ];
  
  res.json({
    success: true,
    emails: sampleEmails
  });
});

// FIXED: Get real INBOX emails (received only)
app.get('/api/emails/inbox/1', async (req, res) => {
  console.log('📬 Real INBOX emails requested for user 1 (alladin)');
  
  try {
    // Read real emails from alladin's mailbox
    const allEmails = await readRealEmails('alladin');
    
    // FIXED: Filter to show only RECEIVED emails (not sent by alladin)
    const inboxEmails = allEmails.filter(email => 
      !email.from_email.includes('alladin@aurafarming.co')
    );
    
    res.json({
      success: true,
      emails: inboxEmails,
      count: inboxEmails.length,
      message: inboxEmails.length > 0 ? 'Inbox emails loaded!' : 'No received emails found'
    });
  } catch (error) {
    console.error('Error fetching inbox emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load inbox emails',
      emails: []
    });
  }
});

// FIXED: Get real SENT emails (sent only)
app.get('/api/emails/sent/1', async (req, res) => {
  console.log('📤 Real SENT emails requested for user 1 (alladin)');
  
  try {
    // FIXED: Return sent emails from storage
    const userSentEmails = sentEmailsStorage.filter(email => 
      email.from_email === 'alladin@aurafarming.co'
    );
    
    res.json({
      success: true,
      emails: userSentEmails,
      count: userSentEmails.length,
      message: userSentEmails.length > 0 ? 'Sent emails loaded!' : 'No sent emails found'
    });
  } catch (error) {
    console.error('Error fetching sent emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load sent emails',
      emails: []
    });
  }
});

// Other endpoints without parameters
app.put('/api/emails/star', (req, res) => {
  console.log('Star email requested:', req.body);
  res.json({ success: true });
});

app.put('/api/emails/read', (req, res) => {
  console.log('Mark as read requested:', req.body);
  res.json({ success: true });
});

app.put('/api/emails/move', (req, res) => {
  console.log('Move email requested:', req.body);
  res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎉 Ultra-simple backend running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'CONFIGURED & READY' : 'NOT CONFIGURED'}`);
  console.log(`✉️ Real email sending enabled!`);
});

console.log('Backend script loaded successfully!'); 