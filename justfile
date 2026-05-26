# Repo-level task placeholders.
# Add real commands only when the corresponding project pieces exist.

default:
    @just --list

setup:
    cd services/control-plane && npm install
    cd services/photo-agent-demo && npm install

check:
    cd services/control-plane && npm run check
    cd services/photo-agent-demo && npm run check

test:
    cd services/control-plane && npm test
    cd services/photo-agent-demo && npm test
    cd services/photo-agent-demo && npm run test:workspace

typegen:
    cd services/control-plane && npm run typegen
    cd services/photo-agent-demo && npm run typegen

fmt:
    @echo "No formatters configured yet."
