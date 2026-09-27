FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (including dev dependencies for vite)
RUN npm install

# Copy source code (will be overridden by volume mount in dev)
COPY . .

EXPOSE 5173

# Run Vite dev server with host flag to accept connections from outside container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
