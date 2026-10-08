# Use Node.js 22 Alpine for smaller image size
FROM node:26-alpine

# Install curl for health checks and process management
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Create data directory with proper permissions
RUN mkdir -p /app/data && chmod 755 /app/data

# Copy package files
COPY package.json ./
COPY package-lock.json ./

# Install dependencies
RUN npm install --omit=dev && npm cache clean --force

# Copy application files (including webserver directory)
COPY . .

# Create a non-root user
# RUN addgroup -g 1001 -S nodejs && \
#   adduser -S botuser -u 1001 -G nodejs

# Set ownership of the app directory
# RUN chown -R botuser:nodejs /app

# Switch to non-root user
# USER botuser

# Expose both the OAuth port and web server port
EXPOSE 3000 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8081/health || exit 1

# Start both the bot and web server
CMD ["node", "start.js"]
