.PHONY: help dev migrate seed test up down

help:
	@echo "LifeHub Platform — common commands"
	@echo "  make up       # build & run the whole stack in Docker (dev)"
	@echo "  make down     # stop the stack"
	@echo "  make dev      # run the API in watch mode (needs local Postgres)"
	@echo "  make migrate  # apply DB migrations"
	@echo "  make seed     # seed roles, permissions, super admin"
	@echo "  make test     # run the end-to-end proof suite"

up:
	docker compose up --build

down:
	docker compose down

dev:
	npm --workspace @lifehub/api run dev

migrate:
	npm --workspace @lifehub/api run db:migrate

seed:
	npm --workspace @lifehub/api run seed

test:
	npm --workspace @lifehub/api run test:e2e
