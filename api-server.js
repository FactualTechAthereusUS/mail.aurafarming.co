const http = require('http');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const url = require('url');

const PORT = 3000;

// Database configuration
const dbConfig = {
  host: 'localhost',
  user: 'auramail',
  password: 'AuraMail2024!',
  database: 'mailserver',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// CORS headers
const setCORSHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
};

// Parse JSON body
const parseJSON = (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
  });
};

const server = http.createServer(async (req, res) => {
  setCORSHeaders(res);
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  
  res.setHeader('Content-Type', 'application/json');

  try {
    // Health check
    if (path === '/api/health' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'AuraMail Backend API',
        port: PORT
      }));
      return;
    }

    // Check username availability
    if (path === '/api/check-username' && req.method === 'POST') {
      const body = await parseJSON(req);
      const { username } = body;
      
      if (!username) {
        res.writeHead(400);
        res.end(JSON.stringify({ available: false, error: 'Username required' }));
        return;
      }

      const email = username + '@aurafarming.co';
      const [rows] = await pool.execute(
        'SELECT COUNT(*) as count FROM virtual_users WHERE email = ?',
        [email]
      );

      const isAvailable = rows[0].count === 0;
      
      res.writeHead(200);
      res.end(JSON.stringify({ 
        available: isAvailable,
        username: username,
        message: isAvailable ? 'Username is available' : 'Username is already taken'
      }));
      return;
    }

    // Register user
    if (path === '/api/register' && req.method === 'POST') {
      const body = await parseJSON(req);
      const { fullName, username, dateOfBirth, gender, country, password } = body;

      if (!fullName || !username || !password) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Missing required fields' }));
        return;
      }

      const email = username + '@aurafarming.co';
      
      // Check if username exists
      const [existing] = await pool.execute(
        'SELECT COUNT(*) as count FROM virtual_users WHERE email = ?',
        [email]
      );

      if (existing[0].count > 0) {
        res.writeHead(409);
        res.end(JSON.stringify({ success: false, error: 'Username already exists' }));
        return;
      }

      // Hash password and insert user
      const hashedPassword = await bcrypt.hash(password, 12);
      const [result] = await pool.execute(
        'INSERT INTO virtual_users (domain_id, email, password) VALUES (?, ?, ?)',
        [1, email, hashedPassword]
      );

      console.log('New user registered:', { id: result.insertId, email: email });

      res.writeHead(201);
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Account created successfully',
        email: email,
        userId: result.insertId
      }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'API endpoint not found' }));

  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log('🚀 AuraMail API Server running on port ' + PORT);
  console.log('📊 Health: http://localhost:' + PORT + '/api/health');
}); 