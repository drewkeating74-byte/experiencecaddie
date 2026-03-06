# Single-stage build for reliability
FROM node:20-alpine

WORKDIR /app

# Copy package files and install (dev for build)
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm install --include=dev

# Copy source and build
COPY apps/api/ ./
RUN npm run build

# Remove dev deps for smaller image
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Use exec form so node is PID 1
CMD ["node", "dist/index.js"]
