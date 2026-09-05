FROM node:20-alpine

WORKDIR /app

# Chromium for Playwright screenshots (used to verify UI changes actually
# render - see `run` skill usage). Alpine is musl, so Playwright's own
# bundled Chromium download won't execute here; apk's build is musl-native.
# Point Playwright at it with executablePath rather than downloading browsers.
RUN apk add --no-cache chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps && npm cache clean --force

# Copy source code
COPY . .

# Build TypeScript (helpful for validation)
RUN npm run build || true

EXPOSE 5173

# Start development server with polling for file changes
CMD ["npm", "run", "dev"]
