FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
COPY prisma/ ./prisma/
RUN npm run build

FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY src/frontend/ ./src/frontend/
COPY prisma/ ./prisma/
COPY docs/ ./docs/
COPY AGENTS.md README.md ./

EXPOSE 8000

CMD ["node", "dist/index.js"]
