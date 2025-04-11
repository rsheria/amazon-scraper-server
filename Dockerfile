FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Set environment variable for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose the port the app runs on
ENV PORT=10000
EXPOSE 10000

# Start the app
CMD ["node", "amazon-scraper.js"]
