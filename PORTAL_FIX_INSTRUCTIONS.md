# 🔧 Portal Deployment Fix

Your portal is having MIME type issues causing CSS/JS files to not load properly. Here's the fix:

## Quick Fix (Run on Server)

1. **Upload the fix script to your server:**
```bash
scp fix_portal_deployment.sh root@159.223.103.126:/root/
scp -r employee-portal/ root@159.223.103.126:/root/
```

2. **SSH into your server and run the fix:**
```bash
ssh root@159.223.103.126
cd /root
chmod +x fix_portal_deployment.sh
sudo ./fix_portal_deployment.sh
```

## What the Fix Does

1. **Updates Next.js configuration** - Sets proper static file handling
2. **Rebuilds the application** - Clean build with new settings  
3. **Fixes Apache proxy config** - Forces correct MIME types for CSS/JS
4. **Creates static file links** - Ensures Apache can serve files directly
5. **Restarts services** - PM2 and Apache reload

## Expected Results

After running the fix:
- ✅ CSS files load properly (no more MIME type errors)
- ✅ JavaScript executes correctly  
- ✅ Portal displays with proper styling
- ✅ Registration form works fully
- ✅ Real-time username checking functions

## Verify Fix

Test these URLs:
- https://portal.aurafarming.co (should load with full styling)
- https://portal.aurafarming.co/api/health (should return JSON)

Check PM2 status:
```bash
pm2 status
pm2 logs auramail-portal
```

## The Root Problem

The issue was Next.js static files (CSS/JS) being served through the proxy with incorrect MIME types. The fix:
- Serves static files directly from Apache (faster)
- Forces correct MIME types for all file types
- Optimizes caching for better performance

**This is a production-grade fix that eliminates the proxy bottleneck for static assets.** 