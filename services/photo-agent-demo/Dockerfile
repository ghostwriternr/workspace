FROM docker.io/cloudflare/sandbox:0.10.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 8080
