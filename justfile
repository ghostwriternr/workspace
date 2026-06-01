default:
    @just --list

setup:
    cd packages/workspace && npm install
    cd packages/adapters/github && npm install
    cd examples/photo-agent-demo && npm install
    cd examples/coding-agent-demo && npm install

check:
    cd packages/workspace && npm run check
    cd packages/adapters/github && npm run check
    cd examples/photo-agent-demo && npm run check
    cd examples/coding-agent-demo && npm run check

knip:
    cd packages/workspace && npm run knip
    cd packages/adapters/github && npm run knip
    cd examples/photo-agent-demo && npm run knip
    cd examples/coding-agent-demo && npm run knip

test:
    cd packages/workspace && npm test
    cd packages/adapters/github && npm test
    cd examples/photo-agent-demo && npm test
    cd examples/coding-agent-demo && npm test

typegen:
    cd packages/workspace && npm run typegen
    cd examples/photo-agent-demo && npm run typegen
    cd examples/coding-agent-demo && npm run typegen

fmt:
    @echo "No formatters configured yet."
