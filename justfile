default:
    @just --list

setup:
    cd packages/workspace && npm install
    cd examples/photo-agent-demo && npm install

check:
    cd packages/workspace && npm run check
    cd examples/photo-agent-demo && npm run check

test:
    cd packages/workspace && npm test
    cd examples/photo-agent-demo && npm test

typegen:
    cd packages/workspace && npm run typegen
    cd examples/photo-agent-demo && npm run typegen

fmt:
    @echo "No formatters configured yet."
