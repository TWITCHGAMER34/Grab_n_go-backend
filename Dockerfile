FROM node:22.7.0-alpine AS builder

WORKDIR /

COPY ./package.json ./package.json

RUN npm install

COPY ./ /

CMD ["node", "index.js"]