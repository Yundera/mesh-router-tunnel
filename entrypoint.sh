#!/bin/bash

set -e

# SSL Configuration
SSL_CERT_PATH="/etc/nginx/ssl"
SSL_CERT="${SSL_CERT_PATH}/nginx-selfsigned.crt"
SSL_KEY="${SSL_CERT_PATH}/nginx-selfsigned.key"

# Function to generate self-signed certificate
generate_self_signed_cert() {
    mkdir -p ${SSL_CERT_PATH}
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ${SSL_KEY} \
        -out ${SSL_CERT} \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
}

# Check SSL environment variable
if [ "${SSL:-false}" = "true" ]; then
    # Check if certificates exist
    if [ ! -f "${SSL_CERT}" ] || [ ! -f "${SSL_KEY}" ]; then
        echo "SSL certificates not found, generating self-signed certificates..."
        generate_self_signed_cert
    else
        echo "SSL certificates found, using existing ones..."
    fi
fi

#######################
# Start OpenResty/nginx
#######################
if [ -n "${PROVIDER_ANNONCE_DOMAIN+x}" ]; then
    ##########################
    # Provider configuration
    ##########################
    if [ "${SSL:-false}" = "true" ]; then
        cp /etc/nginx/conf.d/provider.ssl.conf.template /etc/nginx/conf.d/provider.conf
    else
        cp /etc/nginx/conf.d/provider.conf.template /etc/nginx/conf.d/provider.conf
    fi
    # Registration API over TLS on its own port, for a provider with no reverse proxy in
    # front (a second gateway host, where the gateway owns 80/443). Only /api/ (register,
    # ping); port 80 keeps serving the tunnels. Self-signed: requesters call it with -k.
    if [ -n "${PROVIDER_API_TLS_PORT:-}" ]; then
        if [ ! -f "${SSL_CERT}" ] || [ ! -f "${SSL_KEY}" ]; then
            generate_self_signed_cert
        fi
        cat > /etc/nginx/conf.d/provider-api.conf <<EOF
server {
    listen ${PROVIDER_API_TLS_PORT} ssl;
    server_name _;
    ssl_certificate ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};
    ssl_protocols TLSv1.2 TLSv1.3;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location / {
        return 404;
    }
}
EOF
        echo "Provider API on TLS port ${PROVIDER_API_TLS_PORT}"
    fi
else
    ##########################
    # Requester configuration
    ##########################
    # Set defaults for routing target
    export ROUTING_TARGET_HOST=${ROUTING_TARGET_HOST:-caddy}
    export ROUTING_TARGET_PORT_HTTP=${ROUTING_TARGET_PORT_HTTP:-80}
    export ROUTING_TARGET_PORT_HTTPS=${ROUTING_TARGET_PORT_HTTPS:-443}

    # Substitute environment variables in the template
    envsubst '${ROUTING_TARGET_HOST} ${ROUTING_TARGET_PORT_HTTP} ${ROUTING_TARGET_PORT_HTTPS}' < /etc/nginx/conf.d/requester.conf.template > /etc/nginx/conf.d/requester.conf
    envsubst '${ROUTING_TARGET_HOST} ${ROUTING_TARGET_PORT_HTTPS}' < /etc/nginx/requester.stream.conf.template > /etc/nginx/conf.d/requester-stream.main
fi

mkdir -p /var/log/nginx/
touch /var/log/nginx/access.log
touch /var/log/nginx/error.log
openresty -g 'daemon off;' &

#######################
# Start Node app with PM2
#######################

# Start PM2 and the Node.js app silently
cd /app/dist
# Start Nginx and Node.js app using PM2
pm2 start "tail -f /var/log/nginx/access.log -f /var/log/nginx/error.log -f" --name nginx --silent
pm2 start /app/dist/index.js --name node-app --no-autorestart --silent

# Keep the container running with minimal logging
pm2 logs --lines 0