// SIMPLE PORTAL ENDPOINT FIX - APPEND TO BACKEND
// Portal username check (without /api prefix)
app.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ 
        success: false,
        available: false, 
        error: 'Username is required' 
      });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM auramail_users WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
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
    console.error('Portal username check error:', error);
    res.status(500).json({ 
      success: false,
      available: false, 
      error: 'Server error checking username' 
    });
  }
});