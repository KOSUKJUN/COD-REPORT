FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
RUN apk add --no-cache chromium font-noto-cjk
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PORT=19080
ENV CHROME_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist

USER node
EXPOSE 19080
CMD ["node", "server.js", "--production"]
