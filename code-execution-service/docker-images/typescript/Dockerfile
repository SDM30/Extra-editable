FROM node:20-slim

RUN npm install -g ts-node typescript && useradd -m runner

WORKDIR /home/runner

USER runner

CMD ["sh", "-c", "while true; do sleep 3600; done"]
