# Repo-level task placeholders.
# Add real commands only when the corresponding project pieces exist.

default:
    @just --list

setup:
    cd services/control-plane && npm install

check:
    cd services/control-plane && npm run check

test:
    cd services/control-plane && npm test

typegen:
    cd services/control-plane && npm run typegen

fmt:
    @echo "No formatters configured yet."
