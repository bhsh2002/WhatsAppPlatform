FROM node:22.23.5-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node

EXPOSE 3031

CMD ["npm", "start"]
