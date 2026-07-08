# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine

# Install curl for health checks and process management
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Create data directory with proper permissions and assign to the built-in node user
RUN mkdir -p /app/data && chown -R node:node /app && chmod 755 /app/data

# Switch to non-root user
USER node

# Copy package files
COPY --chown=node:node package.json package-lock.json ./

# Install dependencies
RUN npm install --omit=dev && npm cache clean --force

# Copy application files (including webserver directory)
COPY --chown=node:node . .

# Expose both the OAuth port and web server port
EXPOSE 3000 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8081/health || exit 1

# Start both the bot and web server
CMD ["node", "start.js"]
