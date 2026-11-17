# Candidate build only. Pin the reviewed Node22 LTS base; compile native SQLite
# from the npm-integrity-pinned source with the base image's Node headers.
FROM node:22.23.5-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm_config_build_from_source=true npm_config_nodedir=/usr/local npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 3031
CMD ["npm", "start"]
