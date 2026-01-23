# Stage 1: Build Node.js application with pnpm
FROM node:lts AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install corepack and enable it
RUN npm install -g corepack@latest && corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc /app/

# Install the exact pnpm version specified in package.json
RUN corepack install

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY ./src ./src
COPY ./tsconfig.json ./
RUN pnpm run build

# Stage 2: OpenResty with Node.js runtime
FROM openresty/openresty:alpine

# Install runtime dependencies
RUN apk add --no-cache \
    gettext \
    openssl \
    curl \
    wget \
    wireguard-tools \
    iproute2 \
    iptables \
    iputils \
    nodejs \
    npm

# Install PM2 for process management
RUN npm install -g pm2

# Install lua-resty-http
COPY ./nginx/lua-resty-http/* /usr/local/openresty/lualib/resty/

WORKDIR /app

# Copy built application and dependencies from build stages
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

# Copy the default Nginx configuration files
COPY nginx/nginx.conf /etc/nginx/nginx.conf
RUN rm -f /etc/nginx/conf.d/default.conf

# Provider code
COPY nginx/provider/provider.template.conf /etc/nginx/conf.d/provider.conf.template
COPY nginx/provider/provider.ssl.template.conf /etc/nginx/conf.d/provider.ssl.conf.template
COPY nginx/provider/compute_ip.lua /etc/nginx/lua/compute_ip.lua
COPY nginx/provider/config.lua /etc/nginx/lua/config.lua
COPY nginx/provider/root/ /usr/share/nginx/html-provider/

# Requester code
COPY nginx/requester/requester.template.conf /etc/nginx/conf.d/requester.conf.template
COPY nginx/requester/root/ /usr/share/nginx/html-requester/

# Entrypoint script to run Certbot and start Nginx
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Declare the build argument
ARG BUILD_VERSION
ENV BUILD_VERSION=${BUILD_VERSION}

RUN mkdir -p /tmp/nginx/client_temp && \
    chmod 700 /tmp/nginx/client_temp

ENTRYPOINT ["/entrypoint.sh"]
