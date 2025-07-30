#!/bin/bash

# Portal Deployment Fix Script
# Fixes MIME type issues and static file serving problems
# Usage: sudo ./fix_portal_deployment.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   error "This script must be run as root. Use: sudo ./fix_portal_deployment.sh"
fi

log "🔧 Fixing Employee Portal deployment..."

PORTAL_DIR="/var/www/employee-portal"

# Stop the current PM2 process
log "Stopping current portal instance..."
pm2 stop auramail-portal || warn "Portal was not running"

# Navigate to portal directory
cd $PORTAL_DIR || error "Portal directory not found at $PORTAL_DIR"

# Copy updated configuration files
log "Updating configuration files..."
if [ -f "/root/employee-portal/next.config.js" ]; then
    cp /root/employee-portal/next.config.js $PORTAL_DIR/
    log "✅ Updated next.config.js"
fi

# Clean and rebuild the application
log "Cleaning previous build..."
rm -rf .next/
rm -rf node_modules/.cache/

log "Rebuilding the application..."
npm run build

# Update Apache configuration
log "Updating Apache virtual host configuration..."
cat > /etc/apache2/sites-available/employee-portal.conf << 'EOF'
<VirtualHost *:80>
    ServerName portal.aurafarming.co
    DocumentRoot /var/www/employee-portal
    
    # Redirect to HTTPS
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName portal.aurafarming.co
    
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/mail.aurafarming.co/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/mail.aurafarming.co/privkey.pem
    
    # Serve static files directly from Apache (faster)
    DocumentRoot /var/www/employee-portal
    
    # Static file handling with correct MIME types
    <LocationMatch "^/_next/static/">
        ExpiresActive On
        ExpiresDefault "access plus 1 year"
        
        # Force correct MIME types
        <Files "*.css">
            ForceType text/css
        </Files>
        <Files "*.js">
            ForceType application/javascript
        </Files>
        <Files "*.woff2">
            ForceType font/woff2
        </Files>
        <Files "*.woff">
            ForceType font/woff
        </Files>
        <Files "*.ttf">
            ForceType font/ttf
        </Files>
    </LocationMatch>
    
    # Handle favicon and other static assets
    <LocationMatch "\.(ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$">
        ExpiresActive On
        ExpiresDefault "access plus 1 month"
    </LocationMatch>
    
    # Proxy everything else to Next.js application
    ProxyPreserveHost On
    ProxyRequests Off
    
    # Don't proxy static files - let Apache serve them
    ProxyPass /_next/static !
    ProxyPass /favicon.ico !
    ProxyPass /static !
    
    # Proxy API routes and pages to Next.js
    ProxyPass /api/ http://localhost:3000/api/
    ProxyPassReverse /api/ http://localhost:3000/api/
    
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # Handle WebSocket connections (for real-time features)
    ProxyPass /socket.io/ ws://localhost:3000/socket.io/
    ProxyPassReverse /socket.io/ ws://localhost:3000/socket.io/
    
    # Security headers
    Header always set X-Content-Type-Options nosniff
    Header always set X-Frame-Options DENY
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
    
    # Logging
    ErrorLog ${APACHE_LOG_DIR}/portal-error.log
    CustomLog ${APACHE_LOG_DIR}/portal-access.log combined
</VirtualHost>
EOF

# Enable required Apache modules
log "Enabling Apache modules..."
a2enmod proxy
a2enmod proxy_http
a2enmod proxy_wstunnel
a2enmod headers
a2enmod expires
a2enmod rewrite

# Create symbolic links for static files (if needed)
log "Creating static file links..."
if [ -d ".next/static" ]; then
    rm -rf _next
    ln -sf .next _next
    log "✅ Created _next symbolic link"
fi

# Set correct permissions
log "Setting file permissions..."
chown -R www-data:www-data $PORTAL_DIR
chmod -R 755 $PORTAL_DIR

# Reload Apache configuration
log "Reloading Apache configuration..."
systemctl reload apache2

# Start the portal with PM2
log "Starting the employee portal..."
pm2 start auramail-portal
pm2 save

# Wait a moment for startup
sleep 5

# Test the portal
log "Testing portal health..."
if curl -s http://localhost:3000/api/health > /dev/null; then
    log "✅ Portal is responding"
else
    warn "Portal may not be fully ready yet"
fi

log "🎉 Portal deployment fix completed!"
echo ""
echo "=============================================="
echo "PORTAL DEPLOYMENT FIX COMPLETE"
echo "=============================================="
echo "Portal URL: https://portal.aurafarming.co"
echo "Local URL: http://localhost:3000"
echo ""
echo "Check status: pm2 status"
echo "View logs: pm2 logs auramail-portal"
echo "=============================================="

info "🎯 The portal should now load properly with correct static file serving!" 