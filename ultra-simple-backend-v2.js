const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS middleware
app.use(cors({
  origin: true,
  credentials: true
}));

// Body parser middleware with increased limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// SendGrid configuration
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('✅ SendGrid configured');
} else {
  console.warn('⚠️ SendGrid API key not found');
}

// In-memory storage for sent emails
let sentEmailsStorage = [];

// IMPROVED EMAIL PARSING FUNCTION FOR GOOGLE & OTHER SERVICES
function parseEmail(rawEmail) {
  try {
    const lines = rawEmail.split('\n');
    
    // Extract headers
    const headers = {};
    let headerSection = true;
    let bodyStartIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (headerSection && line.trim() === '') {
        headerSection = false;
        bodyStartIndex = i + 1;
        break;
      }
      
      if (headerSection) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          headers[key] = value;
        }
      }
    }
    
    // Get body content
    const bodyLines = lines.slice(bodyStartIndex);
    let bodyContent = bodyLines.join('\n');
    
    // ENHANCED MULTIPART HANDLING
    const contentType = headers['content-type'] || '';
    let finalContent = '';
    
    if (contentType.includes('multipart/')) {
      // Extract boundary
      const boundaryMatch = contentType.match(/boundary=([^;]+)/);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1].replace(/['"]/g, '');
        console.log('📧 Found multipart boundary:', boundary);
        
        // Split by boundary
        const parts = bodyContent.split(`--${boundary}`);
        
        for (const part of parts) {
          if (part.trim() === '' || part.includes('--')) continue;
          
          // Parse each part
          const partLines = part.split('\n');
          let partHeaders = {};
          let partBodyStart = 0;
          
          // Extract part headers
          for (let i = 0; i < partLines.length; i++) {
            const line = partLines[i];
            if (line.trim() === '') {
              partBodyStart = i + 1;
              break;
            }
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
              const key = line.substring(0, colonIndex).toLowerCase().trim();
              const value = line.substring(colonIndex + 1).trim();
              partHeaders[key] = value;
            }
          }
          
          const partBody = partLines.slice(partBodyStart).join('\n');
          const partContentType = partHeaders['content-type'] || '';
          const partEncoding = partHeaders['content-transfer-encoding'] || '';
          
          console.log('📧 Part content-type:', partContentType);
          console.log('📧 Part encoding:', partEncoding);
          
          // PRIORITY: text/plain first, then text/html
          if (partContentType.includes('text/plain') && !finalContent) {
            finalContent = decodeContent(partBody, partEncoding);
            console.log('✅ Using text/plain content');
          } else if (partContentType.includes('text/html') && !finalContent) {
            finalContent = decodeContent(partBody, partEncoding);
            // Strip HTML tags for better readability
            finalContent = finalContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            console.log('✅ Using text/html content (stripped)');
          }
        }
      }
    } else {
      // Single part email
      const encoding = headers['content-transfer-encoding'] || '';
      finalContent = decodeContent(bodyContent, encoding);
    }
    
    // ENHANCED CONTENT CLEANING
    finalContent = cleanEmailContent(finalContent);
    
    // Extract key information for verification emails
    const extractedInfo = extractVerificationInfo(finalContent);
    if (extractedInfo) {
      finalContent = extractedInfo;
    }
    
    // If still no readable content, provide fallback
    if (!finalContent || finalContent.length < 10) {
      finalContent = 'Email received but content could not be parsed properly. Please check the original email.';
    }
    
    return {
      from_email: headers['from'] || 'Unknown',
      to_email: headers['to'] || 'alladin@aurafarming.co',
      subject: headers['subject'] || 'No Subject',
      body: finalContent,
      date: headers['date'] || new Date().toISOString(),
      message_id: headers['message-id'] || Math.random().toString()
    };
    
  } catch (error) {
    console.error('❌ Email parsing error:', error);
    return {
      from_email: 'Unknown',
      to_email: 'alladin@aurafarming.co',
      subject: 'Parsing Error',
      body: 'Error parsing email content: ' + error.message,
      date: new Date().toISOString(),
      message_id: Math.random().toString()
    };
  }
}

// CONTENT DECODING FUNCTION
function decodeContent(content, encoding) {
  try {
    if (encoding.toLowerCase() === 'quoted-printable') {
      // Decode quoted-printable
      return content
        .replace(/=\r?\n/g, '') // Remove soft line breaks
        .replace(/=([A-F0-9]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    } else if (encoding.toLowerCase() === 'base64') {
      // Decode base64
      return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8');
    } else {
      return content;
    }
  } catch (error) {
    console.error('❌ Content decoding error:', error);
    return content;
  }
}

// ENHANCED CONTENT CLEANING
function cleanEmailContent(content) {
  if (!content) return '';
  
  return content
    // Remove MIME artifacts
    .replace(/Content-Type:.*?\n/gi, '')
    .replace(/Content-Transfer-Encoding:.*?\n/gi, '')
    .replace(/MIME-Version:.*?\n/gi, '')
    .replace(/boundary=.*?\n/gi, '')
    // Remove excessive whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/\r/g, '')
    // Remove base64-like strings longer than 50 chars
    .replace(/[A-Za-z0-9+/]{50,}={0,2}/g, '[encoded content]')
    .trim();
}

// EXTRACT VERIFICATION INFO (Google, TikTok, etc.)
function extractVerificationInfo(content) {
  if (!content) return null;
  
  // Google verification patterns
  const googleVerifyMatch = content.match(/verify your email address|verification link|click.*verify|confirm.*email/i);
  if (googleVerifyMatch) {
    // Extract verification URL
    const urlMatch = content.match(/(https?:\/\/[^\s<>"]+verify[^\s<>"]*)/i);
    if (urlMatch) {
      return `🔐 GOOGLE EMAIL VERIFICATION\n\nTo verify your email address, please click the link below:\n\n${urlMatch[1]}\n\n(This is an automated verification email from Google)`;
    }
    
    // Look for verification instructions
    const instructionMatch = content.match(/.{0,200}(verify|confirm|click).{0,200}/i);
    if (instructionMatch) {
      return `🔐 GOOGLE EMAIL VERIFICATION\n\n${instructionMatch[0].trim()}\n\n(This is an automated verification email from Google)`;
    }
  }
  
  // TikTok verification code pattern
  const tiktokMatch = content.match(/(\d{6})\s+is your TikTok code/i);
  if (tiktokMatch) {
    return `🔐 TIKTOK VERIFICATION CODE\n\nYour TikTok verification code is: ${tiktokMatch[1]}\n\n(Valid for a limited time)`;
  }
  
  // General verification code pattern
  const codeMatch = content.match(/(?:code|verification|otp).*?(\d{4,8})/i);
  if (codeMatch) {
    return `🔐 VERIFICATION CODE\n\nYour verification code is: ${codeMatch[1]}\n\n${content.substring(0, 200)}...`;
  }
  
  return null;
}

// Read real emails from Maildir
function readRealEmails() {
  const emails = [];
  const maildirPaths = [
    '/var/mail/vhosts/aurafarming.co/alladin/new/',
    '/var/mail/vhosts/aurafarming.co/alladin/cur/'
  ];

  console.log('📬 Reading real emails from Maildir...');

  for (const maildirPath of maildirPaths) {
    try {
      if (fs.existsSync(maildirPath)) {
        const files = fs.readdirSync(maildirPath);
        console.log(`📁 Found ${files.length} files in ${maildirPath}`);

        for (const file of files) {
          try {
            const filePath = path.join(maildirPath, file);
            const rawEmail = fs.readFileSync(filePath, 'utf8');
            
            console.log(`📧 Parsing email file: ${file}`);
            const parsedEmail = parseEmail(rawEmail);
            
            // Only include received emails (not sent by alladin)
            if (!parsedEmail.from_email.includes('alladin@aurafarming.co')) {
              emails.push({
                id: Date.now() + Math.random(),
                from_email: parsedEmail.from_email,
                to_email: parsedEmail.to_email,
                subject: parsedEmail.subject,
                body: parsedEmail.body,
                is_read: false,
                has_attachments: false,
                created_at: parsedEmail.date,
                starred: false,
                folder: 'inbox'
              });
              console.log(`✅ Added email from: ${parsedEmail.from_email}`);
            }
          } catch (fileError) {
            console.error(`❌ Error parsing email file ${file}:`, fileError);
          }
        }
      } else {
        console.log(`📁 Directory not found: ${maildirPath}`);
      }
    } catch (dirError) {
      console.error(`❌ Error reading directory ${maildirPath}:`, dirError);
    }
  }

  console.log(`📬 Total emails loaded: ${emails.length}`);
  return emails.reverse(); // Most recent first
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'AuraMail Ultra Simple Backend v2 - Enhanced Email Parsing',
    timestamp: new Date().toISOString(),
    sendgrid: !!process.env.SENDGRID_API_KEY
  });
});

// Mock login endpoint
app.post('/api/login', (req, res) => {
  console.log('🔐 Login attempt:', req.body);
  
  const { email, password } = req.body;
  
  // Simple mock authentication
  if (email && password) {
    res.json({
      success: true,
      user: {
        id: 1,
        email: email,
        name: email.split('@')[0]
      },
      token: 'mock-jwt-token-' + Date.now()
    });
  } else {
    res.status(400).json({
      success: false,
      error: 'Email and password required'
    });
  }
});

// Get inbox emails
app.get('/api/emails/inbox/1', (req, res) => {
  console.log('📬 Inbox request received');
  
  try {
    const emails = readRealEmails();
    
    res.json({
      success: true,
      emails: emails,
      total: emails.length
    });
  } catch (error) {
    console.error('❌ Error fetching inbox:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch emails'
    });
  }
});

// Get sent emails
app.get('/api/emails/sent/1', (req, res) => {
  console.log('📤 Sent emails request received');
  
  res.json({
    success: true,
    emails: sentEmailsStorage,
    total: sentEmailsStorage.length
  });
});

// Send email
app.post('/api/emails/send', async (req, res) => {
  console.log('📧 Send email requested:', req.body);
  
  const { to, subject, body, priority, from_user } = req.body;
  
  if (!to || !subject || !body) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: to, subject, body' 
    });
  }
  
  const senderEmail = from_user || 'noreply@aurafarming.co';
  
  try {
    const msg = {
      to: to,
      from: senderEmail,
      subject: subject,
      html: body,
      text: body
    };
    
    console.log('🚀 Sending email via SendGrid to:', to);
    
    const response = await sgMail.send(msg);
    
    console.log('✅ Email sent successfully via SendGrid!');
    console.log('SendGrid response:', response[0].statusCode);
    
    // Store sent email
    const sentEmail = {
      id: Date.now(),
      from_email: senderEmail,
      to_email: to,
      subject: subject,
      body: body,
      is_read: true,
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

// Email actions (star, read, move)
app.post('/api/emails/star', (req, res) => {
  console.log('⭐ Star email:', req.body);
  res.json({ success: true, message: 'Email starred' });
});

app.post('/api/emails/read', (req, res) => {
  console.log('👁️ Mark as read:', req.body);
  res.json({ success: true, message: 'Email marked as read' });
});

app.post('/api/emails/move', (req, res) => {
  console.log('📁 Move email:', req.body);
  res.json({ success: true, message: 'Email moved' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AuraMail Ultra Simple Backend v2 running on port ${PORT}`);
  console.log(`📧 Enhanced email parsing for Google, TikTok, and other services`);
  console.log(`🔐 SendGrid configured: ${!!process.env.SENDGRID_API_KEY}`);
}); 