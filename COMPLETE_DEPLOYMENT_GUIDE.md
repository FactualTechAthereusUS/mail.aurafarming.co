# 🚀 AuraMail Portal - Complete Deployment Guide

## 📋 **Architecture Overview**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │────│   Backend       │────│   Database      │
│   (Vercel)      │    │   (DigitalOcean)│    │   (MySQL)       │
│   Next.js 14    │    │   Node.js/Express│   │   Mail Server   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Frontend (Vercel)**: Modern React UI with real-time features  
**Backend (DigitalOcean)**: REST APIs for user management  
**Database**: MySQL with email server integration

---

## 🖥️ **BACKEND SETUP (DigitalOcean Server)**

### **Step 1: Prepare Server**
```bash
# SSH into your DigitalOcean server
ssh root@159.223.103.126

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+ if not already installed
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2
```

### **Step 2: Run Backend Setup Script**
```bash
# Upload and run the backend setup script
chmod +x backend-setup.sh
sudo ./backend-setup.sh
```

### **Step 3: Configure Database Connection**
```bash
# Edit the database configuration in server.js
sudo nano /var/www/auramail-backend/server.js

# Update these lines with your actual database credentials:
const dbConfig = {
  host: 'localhost',
  user: 'mailuser',          # Your MySQL user
  password: 'your_password', # Your MySQL password  
  database: 'mailserver'     # Your database name
};
```

### **Step 4: Restart Backend**
```bash
# Restart the backend with new configuration
cd /var/www/auramail-backend
pm2 restart auramail-backend
pm2 logs auramail-backend
```

### **Step 5: Test Backend APIs**
```bash
# Test health endpoint
curl https://portal.aurafarming.co/health

# Test username check
curl -X POST https://portal.aurafarming.co/api/check-username \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser"}'

# Test registration (optional)
curl -X POST https://portal.aurafarming.co/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"Test User",
    "username":"testuser2",
    "dateOfBirth":"1990-01-01",
    "gender":"Male",
    "country":"United States",
    "password":"password123",
    "confirmPassword":"password123"
  }'
```

---

## 🌐 **FRONTEND SETUP (Vercel)**

### **Step 1: Repository Setup**
Your frontend code is already in GitHub:
- **Repository**: `https://github.com/FactualTechAthereusUS/project-portal-`
- **Branch**: `main`
- **Latest Commit**: Working frontend with real-time features

### **Step 2: Deploy to Vercel**

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Click **"New Project"**

2. **Import GitHub Repository**
   - Connect your GitHub account if needed
   - Search for: `FactualTechAthereusUS/project-portal-`
   - Click **"Import"**

3. **Configure Project**
   - **Framework**: Next.js (auto-detected)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

4. **Set Environment Variables**
   ```
   NEXT_PUBLIC_API_URL=https://portal.aurafarming.co/api
   ```

5. **Deploy**
   - Click **"Deploy"**
   - Wait for build to complete (should work now!)

### **Step 3: Configure Custom Domain (Optional)**

1. **In Vercel Project Settings**
   - Go to **"Domains"** tab
   - Add domain: `portal.aurafarming.co`

2. **Update DNS Records**
   ```
   Type: CNAME
   Name: portal
   Value: cname.vercel-dns.com
   ```

3. **SSL Certificate**
   - Vercel automatically provides SSL
   - No additional configuration needed

---

## ✅ **TESTING THE COMPLETE SYSTEM**

### **Frontend Features to Test**

1. **Real-time Username Checking**
   - Type in username field
   - Should show spinner → green checkmark (available) or red X (taken)
   - Try reserved usernames: `admin`, `test`, `mail`

2. **Password Strength Meter**
   - Type password in password field
   - Should show colored progress bar: Red (weak) → Yellow (fair) → Green (strong)

3. **Password Matching**
   - Type password and confirm password
   - Should show green checkmark when passwords match

4. **Form Validation**
   - Try submitting empty form
   - Try short username (< 3 characters)
   - Try weak password (< 6 characters)

5. **Account Creation**
   - Fill all fields correctly
   - Click "Create Email Account"
   - Should show success message with email address

### **Backend APIs to Test**

```bash
# Health check
curl https://portal.aurafarming.co/health

# Username availability  
curl -X POST https://portal.aurafarming.co/api/check-username \
  -H "Content-Type: application/json" \
  -d '{"username":"myusername"}'

# User registration
curl -X POST https://portal.aurafarming.co/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"John Doe",
    "username":"johndoe",
    "dateOfBirth":"1990-05-15",
    "gender":"Male", 
    "country":"United States",
    "password":"SecurePass123"
  }'
```

---

## 🔧 **TROUBLESHOOTING**

### **Frontend Issues**

**Build Fails on Vercel:**
- Check environment variables are set correctly
- Ensure `NEXT_PUBLIC_API_URL` points to your backend
- Check build logs for specific errors

**Real-time Features Not Working:**
- Open browser dev tools → Network tab
- Check if API calls are being made to correct URL
- Verify CORS headers in response

**UI Not Loading:**
- Hard refresh: `Ctrl+Shift+R` (or `Cmd+Shift+R`)
- Try incognito/private browsing mode
- Check browser console for JavaScript errors

### **Backend Issues**

**API Endpoints Return 500:**
```bash
# Check backend logs
pm2 logs auramail-backend

# Check database connection
mysql -u mailuser -p mailserver -e "SELECT COUNT(*) FROM virtual_users;"
```

**CORS Errors:**
```bash
# Check Apache configuration
sudo apache2ctl configtest

# Restart Apache
sudo systemctl restart apache2

# Check Apache logs
sudo tail -f /var/log/apache2/auramail-backend-error.log
```

**Database Connection Issues:**
- Verify MySQL credentials in `/var/www/auramail-backend/server.js`
- Check if `virtual_users` and `virtual_domains` tables exist
- Test database connection manually

---

## 📊 **MONITORING & MAINTENANCE**

### **Backend Monitoring**
```bash
# Check PM2 processes
pm2 status

# View logs
pm2 logs auramail-backend

# Restart if needed
pm2 restart auramail-backend

# Monitor system resources
htop
```

### **Frontend Monitoring**
- Vercel automatically monitors deployments
- Check **Analytics** tab in Vercel dashboard
- Set up **Error Reporting** in Vercel settings

### **Database Maintenance**
```bash
# Check user creation
mysql -u mailuser -p mailserver -e "SELECT username, full_name, created_at FROM virtual_users ORDER BY created_at DESC LIMIT 10;"

# Backup database
mysqldump -u mailuser -p mailserver > auramail_backup_$(date +%Y%m%d).sql
```

---

## 🎯 **EXPECTED RESULTS**

**✅ Working Frontend:**
- Beautiful dark theme UI loads instantly
- Real-time username checking with 500ms debounce
- Password strength meter with visual feedback
- Form validation with live error messages
- Smooth animations and transitions

**✅ Working Backend:**
- Health endpoint returns status OK
- Username checking works with database
- User registration creates accounts successfully
- CORS configured for Vercel domain
- MySQL integration working properly

**✅ Complete Integration:**
- Frontend calls backend APIs successfully
- No CORS errors in browser console
- Account creation flow works end-to-end
- Users can create `username@aurafarming.co` emails
- Real-time features work without delays

---

## 📞 **SUPPORT**

If you encounter issues:
1. Check the troubleshooting section above
2. Review logs for specific error messages
3. Test individual components separately
4. Verify all environment variables are set correctly

**Your AuraMail portal should now be a world-class email registration system!** 🚀 