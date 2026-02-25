# syntax=docker/dockerfile:1
FROM node:20-bullseye-slim

WORKDIR /app

# native modules (better-sqlite3, sqlite3) need build tools in case prebuild isn't available
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["npm","start"]
