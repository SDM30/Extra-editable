FROM gcc:13

RUN useradd -m runner

WORKDIR /home/runner

USER runner

CMD ["sh", "-c", "while true; do sleep 3600; done"]
