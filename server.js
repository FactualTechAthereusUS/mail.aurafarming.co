const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['https://portal.aurafarming.co', 'https://matrixneo.vercel.app', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Database configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'd6Q~(Gb?FckCrAC',
  database: 'mailserver',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create MySQL connection pool
const pool = mysql.createPool(dbConfig);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AuraMail Backend API'
  });
});

// Check username availability
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
      message: isAvailable ? 'Username is available' : 'Username is already taken'
    });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      available: false, 
      error: 'Server error checking username' 
    });
  }
});

// Register new user
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
    const [existingUsers] = await pool.execute(
      'SELECT COUNT(*) as count FROM virtual_users WHERE email = ?',
      [email]
    );

    if (existingUsers[0].count > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'Username already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert new user
    const [result] = await pool.execute(
      'INSERT INTO virtual_users (domain_id, email, password) VALUES (?, ?, ?)',
      [1, email, hashedPassword] // domain_id = 1 for aurafarming.co
    );

    console.log('New user registered:', { 
      id: result.insertId, 
      email: email,
      fullName: fullName 
    });

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

// Get user info (for testing)
app.get('/api/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const [rows] = await pool.execute(
      'SELECT id, email, domain_id FROM virtual_users WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: rows[0] });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AuraMail Backend API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end();
  process.exit(0);
}); 