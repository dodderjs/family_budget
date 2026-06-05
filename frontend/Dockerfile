FROM node:20-alpine

WORKDIR /app

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
