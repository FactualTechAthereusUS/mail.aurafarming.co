#!/bin/bash

# AuraMail Portal - Complete Backend Setup for Separated Frontend/Backend
# Run this on your DigitalOcean server (159.223.103.126)

echo "🚀 Setting up AuraMail Portal Backend..."

# Create backend directory structure
sudo mkdir -p /var/www/auramail-backend
cd /var/www/auramail-backend

# Create package.json for backend
cat << 'EOF' > package.json
{
  "name": "auramail-backend",
  "version": "1.0.0",
  "description": "AuraMail Portal Backend APIs",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "mysql2": "^3.6.0",
    "bcrypt": "^5.1.0",
    "body-parser": "^1.20.0",
    "helmet": "^7.0.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF

# Create main server file
cat << 'EOF' > server.js
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration - Allow multiple origins
const allowedOrigins = [
  'https://portal.aurafarming.co',
  'https://project-portal-amber.vercel.app',
  'https://project-portal-git-main-the-matrixs-projects-593b5248.vercel.app',
  /https:\/\/.*\.vercel\.app$/,
  'http://localhost:3000',
  'http://localhost:3001'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') return allowed === origin;
      if (allowed instanceof RegExp) return allowed.test(origin);
      return false;
    })) {
      return callback(null, true);
    }
    
    // For development, allow localhost
    if (origin.includes('localhost')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const dbConfig = {
  host: 'localhost',
  user: 'mailuser',
  password: 'your_password_here',
  database: 'mailserver'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'AuraMail Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Check username availability
app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || username.length < 2) {
      return res.status(400).json({
        available: false,
        message: 'Username must be at least 2 characters'
      });
    }
    
    // Clean username
    const cleanUsername = username.toLowerCase().trim();
    
    // Check reserved usernames
    const reservedUsernames = ['admin', 'root', 'postmaster', 'abuse', 'support', 'mail', 'email', 'test'];
    if (reservedUsernames.includes(cleanUsername)) {
      return res.json({
        available: false,
        message: 'Username is reserved'
      });
    }
    
    // Check database for existing user
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      'SELECT username FROM virtual_users WHERE username = ?',
      [`${cleanUsername}@aurafarming.co`]
    );
    await connection.end();
    
    const isAvailable = rows.length === 0;
    
    res.json({
      available: isAvailable,
      message: isAvailable ? 'Username is available!' : 'Username is already taken'
    });
    
  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({
      available: false,
      message: 'Error checking username availability'
    });
  }
});

// Register new user
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, username, dateOfBirth, gender, country, password } = req.body;
    
    // Validation
    if (!fullName || !username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    
    const cleanUsername = username.toLowerCase().trim();
    const email = `${cleanUsername}@aurafarming.co`;
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Insert into database
    const connection = await mysql.createConnection(dbConfig);
    
    try {
      // Check if user already exists
      const [existingUsers] = await connection.execute(
        'SELECT id FROM virtual_users WHERE username = ?',
        [email]
      );
      
      if (existingUsers.length > 0) {
        await connection.end();
        return res.status(409).json({
          success: false,
          message: 'Username already exists'
        });
      }
      
      // Get domain ID
      const [domains] = await connection.execute(
        'SELECT id FROM virtual_domains WHERE name = ?',
        ['aurafarming.co']
      );
      
      if (domains.length === 0) {
        // Create domain if it doesn't exist
        await connection.execute(
          'INSERT INTO virtual_domains (name) VALUES (?)',
          ['aurafarming.co']
        );
        
        const [newDomains] = await connection.execute(
          'SELECT id FROM virtual_domains WHERE name = ?',
          ['aurafarming.co']
        );
        domainId = newDomains[0].id;
      } else {
        domainId = domains[0].id;
      }
      
      // Insert user
      const [result] = await connection.execute(
        'INSERT INTO virtual_users (domain_id, username, password, full_name, created_at) VALUES (?, ?, ?, ?, NOW())',
        [domainId, email, hashedPassword, fullName]
      );
      
      // Create user's mailbox directory
      const { spawn } = require('child_process');
      const createMailbox = spawn('sudo', ['mkdir', '-p', `/var/mail/vhosts/aurafarming.co/${cleanUsername}`]);
      createMailbox.on('close', (code) => {
        if (code === 0) {
          // Set proper permissions
          spawn('sudo', ['chown', '-R', 'vmail:vmail', `/var/mail/vhosts/aurafarming.co/${cleanUsername}`]);
          spawn('sudo', ['chmod', '-R', '770', `/var/mail/vhosts/aurafarming.co/${cleanUsername}`]);
        }
      });
      
      await connection.end();
      
      res.json({
        success: true,
        message: 'Account created successfully!',
        email: email,
        userId: result.insertId
      });
      
    } catch (dbError) {
      await connection.end();
      throw dbError;
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create account. Please try again.'
    });
  }
});

// Get user info (for testing)
app.get('/api/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const email = username.includes('@') ? username : `${username}@aurafarming.co`;
    
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      'SELECT id, username, full_name, created_at FROM virtual_users WHERE username = ?',
      [email]
    );
    await connection.end();
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: rows[0]
    });
    
  } catch (error) {
    console.error('User lookup error:', error);
    res.status(500).json({
      success: false,
      message: 'Error looking up user'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 AuraMail Backend Server running on http://127.0.0.1:${PORT}`);
  console.log(`📡 API endpoints available at http://127.0.0.1:${PORT}/api/`);
  console.log(`❤️  Health check: http://127.0.0.1:${PORT}/health`);
});
EOF

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create PM2 ecosystem file
cat << 'EOF' > ecosystem.config.js
module.exports = {
  apps: [{
    name: 'auramail-backend',
    script: 'server.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/auramail-backend-error.log',
    out_file: '/var/log/auramail-backend-out.log',
    log_file: '/var/log/auramail-backend.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

# Update Apache configuration
echo "⚙️ Updating Apache configuration..."
sudo cp /etc/apache2/sites-available/employee-portal.conf /etc/apache2/sites-available/employee-portal.conf.backup

cat << 'EOF' | sudo tee /etc/apache2/sites-available/employee-portal.conf
<VirtualHost *:80>
    ServerName portal.aurafarming.co
    DocumentRoot /var/www/auramail-backend
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName portal.aurafarming.co
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/portal.aurafarming.co/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/portal.aurafarming.co/privkey.pem
    
    DocumentRoot /var/www/auramail-backend
    
    # CORS Headers for separated frontend (Vercel)
    Header always set Access-Control-Allow-Origin "*"
    Header always set Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE"
    Header always set Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With, Accept, Origin"
    Header always set Access-Control-Max-Age "3600"
    
    # Handle preflight OPTIONS requests
    RewriteEngine On
    RewriteCond %{REQUEST_METHOD} OPTIONS
    RewriteRule ^(.*)$ $1 [R=200,L]
    
    # Security headers
    Header always set X-Content-Type-Options nosniff
    Header always set X-Frame-Options SAMEORIGIN
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    
    # API endpoints - proxy to Node.js backend
    ProxyPreserveHost On
    ProxyRequests Off
    
    ProxyPass /api/ http://127.0.0.1:3000/api/
    ProxyPassReverse /api/ http://127.0.0.1:3000/api/
    
    ProxyPass /health http://127.0.0.1:3000/health
    ProxyPassReverse /health http://127.0.0.1:3000/health
    
    # Root endpoint for health check
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # Logging
    ErrorLog ${APACHE_LOG_DIR}/auramail-backend-error.log
    CustomLog ${APACHE_LOG_DIR}/auramail-backend-access.log combined
    LogLevel warn
</VirtualHost>
EOF

# Enable required Apache modules
echo "🔧 Enabling Apache modules..."
sudo a2enmod headers
sudo a2enmod rewrite
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod ssl

# Test Apache configuration
echo "🧪 Testing Apache configuration..."
sudo apache2ctl configtest

if [ $? -eq 0 ]; then
    echo "✅ Apache configuration is valid"
    
    # Reload Apache
    echo "🔄 Reloading Apache..."
    sudo systemctl reload apache2
    
    # Start backend with PM2
    echo "🚀 Starting backend server..."
    pm2 delete auramail-backend 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup
    
    echo "✅ Backend setup complete!"
    echo ""
    echo "📋 Backend Status:"
    echo "🌐 API Base URL: https://portal.aurafarming.co"
    echo "❤️  Health Check: https://portal.aurafarming.co/health"
    echo "👤 Username Check: https://portal.aurafarming.co/api/check-username"
    echo "📝 Register: https://portal.aurafarming.co/api/register"
    echo ""
    echo "📋 Frontend Setup:"
    echo "1. Repository: https://github.com/FactualTechAthereusUS/project-portal-"
    echo "2. Environment: NEXT_PUBLIC_API_URL=https://portal.aurafarming.co/api"  
    echo "3. Deploy to Vercel with custom domain"
    echo ""
    echo "🔧 Test Commands:"
    echo "curl https://portal.aurafarming.co/health"
    echo "curl -X POST https://portal.aurafarming.co/api/check-username -H 'Content-Type: application/json' -d '{\"username\":\"test\"}'"
    
else
    echo "❌ Apache configuration error. Please check the syntax."
    exit 1
fi 