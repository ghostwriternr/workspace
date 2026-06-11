# syntax=docker/dockerfile:1

FROM golang:1.24 AS artifact-fs-build

ARG ARTIFACT_FS_REF=083e55e

RUN --mount=type=secret,id=cloudflare_ca,required=false \
  apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && if [ -f /run/secrets/cloudflare_ca ]; then \
       cp /run/secrets/cloudflare_ca /usr/local/share/ca-certificates/artifact-fs-extra-ca.crt; \
     fi \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone https://github.com/cloudflare/artifact-fs.git . \
  && git checkout "$ARTIFACT_FS_REF" \
  && go build -o /artifact-fs ./cmd/artifact-fs

FROM docker.io/cloudflare/sandbox:0.10.3

RUN --mount=type=secret,id=cloudflare_ca,required=false \
  apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    fuse3 \
    git \
    openssh-client \
  && if [ -f /run/secrets/cloudflare_ca ]; then \
       cp /run/secrets/cloudflare_ca /usr/local/share/ca-certificates/artifact-fs-extra-ca.crt; \
     fi \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=artifact-fs-build /artifact-fs /usr/local/bin/artifact-fs
COPY packages/adapters/sandbox/container/workspace-mount /usr/local/bin/workspace-mount
COPY packages/adapters/sandbox/container/workspace-capture /usr/local/bin/workspace-capture

RUN chmod +x /usr/local/bin/artifact-fs /usr/local/bin/workspace-mount /usr/local/bin/workspace-capture

ENV ARTIFACT_FS_ROOT=/tmp/artifact-fs

EXPOSE 8080
