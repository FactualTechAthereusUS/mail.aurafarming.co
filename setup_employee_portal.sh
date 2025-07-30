#!/bin/bash

# Employee Portal Setup Script for AuraMail
# Deploys the Next.js employee registration portal on the email server
# Usage: sudo ./setup_employee_portal.sh

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
   error "This script must be run as root. Use: sudo ./setup_employee_portal.sh"
fi

log "🚀 Setting up AuraMail Employee Portal..."

# Install Node.js and npm if not already installed
log "Installing Node.js and npm..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
log "✅ Node.js $NODE_VERSION installed"
log "✅ npm $NPM_VERSION installed"

# Create directory for the employee portal
PORTAL_DIR="/var/www/employee-portal"
log "Creating portal directory: $PORTAL_DIR"
mkdir -p $PORTAL_DIR
cd $PORTAL_DIR

# Copy employee portal files (assuming they're uploaded)
log "Setting up employee portal files..."
cp -r /root/employee-portal/* $PORTAL_DIR/ 2>/dev/null || {
    error "Employee portal files not found in /root/employee-portal/. Please upload the files first."
}

# Install dependencies
log "Installing Node.js dependencies..."
npm install

# Build the Next.js application
log "Building the application..."
npm run build

# Install PM2 for process management
log "Installing PM2 process manager..."
npm install -g pm2

# Create PM2 ecosystem file
log "Creating PM2 configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'auramail-portal',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/employee-portal',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/auramail-portal-error.log',
    out_file: '/var/log/pm2/auramail-portal-out.log',
    log_file: '/var/log/pm2/auramail-portal.log',
    time: true
  }]
}
EOF

# Create log directory
mkdir -p /var/log/pm2

# Start the application with PM2
log "Starting the employee portal with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Configure Apache virtual host for the employee portal
log "Configuring Apache virtual host..."
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
    
    # Proxy to Next.js application
    ProxyPreserveHost On
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

# Enable the portal site
a2ensite employee-portal
systemctl reload apache2

# Set correct permissions
log "Setting file permissions..."
chown -R www-data:www-data $PORTAL_DIR
chmod -R 755 $PORTAL_DIR

# Create systemd service for PM2 (backup)
log "Creating systemd service..."
cat > /etc/systemd/system/auramail-portal.service << 'EOF'
[Unit]
Description=AuraMail Employee Portal
After=network.target mysql.service

[Service]
Type=forking
User=www-data
WorkingDirectory=/var/www/employee-portal
ExecStart=/usr/bin/pm2 start ecosystem.config.js --no-daemon
ExecReload=/usr/bin/pm2 reload ecosystem.config.js
ExecStop=/usr/bin/pm2 stop ecosystem.config.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable auramail-portal

# Update UFW firewall for port 3000 (internal)
log "Updating firewall rules..."
ufw allow from 127.0.0.1 to any port 3000

# Get SSL certificate for portal subdomain (if needed)
log "Setting up SSL certificate for portal.aurafarming.co..."
certbot certonly --apache --agree-tos --no-eff-email --email admin@aurafarming.co -d portal.aurafarming.co || {
    warn "SSL certificate setup failed. You may need to configure DNS for portal.aurafarming.co first."
}

# Create a simple health check endpoint
log "Creating health check script..."
cat > /usr/local/bin/portal-health-check << 'EOF'
#!/bin/bash
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null)
if [ "$response" = "200" ]; then
    echo "Portal is healthy"
    exit 0
else
    echo "Portal is unhealthy (HTTP $response)"
    exit 1
fi
EOF

chmod +x /usr/local/bin/portal-health-check

# Add to crontab for monitoring
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/portal-health-check || /usr/bin/pm2 restart auramail-portal") | crontab -

log "🎉 Employee Portal setup completed successfully!"
echo ""
echo "=============================================="
echo "EMPLOYEE PORTAL DEPLOYMENT COMPLETE"
echo "=============================================="
echo "Portal URL: https://portal.aurafarming.co"
echo "Local URL: http://localhost:3000"
echo ""
echo "Management Commands:"
echo "  View logs: pm2 logs auramail-portal"
echo "  Restart:   pm2 restart auramail-portal"
echo "  Status:    pm2 status"
echo "  Monitor:   pm2 monit"
echo ""
echo "Health Check: /usr/local/bin/portal-health-check"
echo "=============================================="

info "🎯 Next Steps:"
info "1. Configure DNS for portal.aurafarming.co (A record → 159.223.103.126)"
info "2. Test the portal: https://portal.aurafarming.co"
info "3. Employees can now create their own email accounts!"
info "4. Monitor with: pm2 logs auramail-portal" 