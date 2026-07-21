# OpenReplay local development.
#
# Runs the full OpenReplay stack locally with one command, using the prebuilt
# release images (no per-service source build). See scripts/dev/dev.sh.

DEV := ./scripts/dev/dev.sh

.PHONY: dev dev-down dev-clean dev-logs dev-ps dev-urls dev-trust dev-frontend help

## dev: bring up the full stack at https://localhost
dev:
	@$(DEV) up

## dev-down: stop the stack (keeps data volumes)
dev-down:
	@$(DEV) down

## dev-clean: stop and remove containers + data volumes
dev-clean:
	@$(DEV) clean

## dev-logs: tail logs (optionally: make dev-logs S=chalice)
dev-logs:
	@$(DEV) logs $(S)

## dev-ps: show running services
dev-ps:
	@$(DEV) ps

## dev-urls: print local URLs
dev-urls:
	@$(DEV) urls

## dev-trust: trust the local Caddy CA so https://localhost has no cert errors
dev-trust:
	@./scripts/dev/trust-ca.sh

## dev-frontend: rebuild the dashboard SPA from source and reload the frontend container
dev-frontend:
	@./scripts/dev/build-frontend.sh

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
