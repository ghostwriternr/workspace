default:
    @just --list

setup:
    cd packages/workspace && npm install
    cd packages/adapters/dynamic-worker && npm install
    cd packages/adapters/sandbox && npm install
    cd packages/sources/github && npm install
    cd examples/photo-agent-demo && npm install
    cd examples/coding-agent-demo && npm install

check:
    cd packages/workspace && npm run check
    cd packages/adapters/dynamic-worker && npm run check
    cd packages/adapters/sandbox && npm run check
    cd packages/sources/github && npm run check
    cd examples/photo-agent-demo && npm run check
    cd examples/coding-agent-demo && npm run check

knip:
    cd packages/workspace && npm run knip
    cd packages/adapters/dynamic-worker && npm run knip
    cd packages/adapters/sandbox && npm run knip
    cd packages/sources/github && npm run knip
    cd examples/photo-agent-demo && npm run knip
    cd examples/coding-agent-demo && npm run knip

test:
    node --test tools/*.test.mjs
    cd packages/workspace && npm test
    cd packages/adapters/dynamic-worker && npm test
    cd packages/adapters/sandbox && npm test
    cd packages/sources/github && npm test
    cd examples/photo-agent-demo && npm test
    cd examples/coding-agent-demo && npm test

typegen:
    cd packages/workspace && npm run typegen
    cd examples/photo-agent-demo && npm run typegen
    cd examples/coding-agent-demo && npm run typegen

build-sandbox-base:
    bash -lc 'tmp=$(mktemp); trap "rm -f $tmp" EXIT; if [ -f "$HOME/.config/cloudflare/zero_trust_cert.pem" ]; then cp "$HOME/.config/cloudflare/zero_trust_cert.pem" "$tmp"; fi; docker build --platform linux/amd64 --secret id=cloudflare_ca,src="$tmp" -t workspace-sandbox-base:local -f packages/adapters/sandbox/container/Dockerfile .'

install-fuse-workerd:
    node tools/install-fuse-workerd.mjs

dev-photo-fuse: install-fuse-workerd build-sandbox-base
    cd examples/photo-agent-demo && MINIFLARE_WORKERD_PATH="$PWD/../../.cache/workerd-fuse/workerd" WORKERD_LOCAL_DOCKER_ENABLE_FUSE=1 npm run dev

dev-coding-fuse: install-fuse-workerd build-sandbox-base
    cd examples/coding-agent-demo && MINIFLARE_WORKERD_PATH="$PWD/../../.cache/workerd-fuse/workerd" WORKERD_LOCAL_DOCKER_ENABLE_FUSE=1 npm run dev

fmt:
    @echo "No formatters configured yet."
