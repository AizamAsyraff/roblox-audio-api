FROM node:20-alpine

# Install yt-dlp via apk (Alpine package manager)
RUN apk add --no-cache yt-dlp ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm dependencies
RUN npm install

# Copy all files
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
