FROM node:25@sha256:78839ac448c23517f8eab2e8f7943d9b4f73979eb7f8bed2c73dbf72ff869e7b

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node

EXPOSE 3031

CMD ["npm", "start"]
