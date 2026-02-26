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