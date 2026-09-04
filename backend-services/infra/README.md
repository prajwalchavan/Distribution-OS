# infra/docker

- `Dockerfile` builds a single image for `@dos/<name>-service` (default CMD) and `@dos/worker` (`CMD ["node","/app/worker/dist/main.js"]`).
- Hosting target is decided in `docs/09-infra-and-cost.md`. The runtime has no provider-specific code: the same image runs on AWS Mumbai (ECS Fargate + RDS), DigitalOcean Bangalore (Droplet/App Platform + Managed Postgres) or any Docker host in India (DPDP data residency).
- Migrations run as a one-shot job (`pnpm db:migrate`) before the new version receives traffic. Every migration must be backward compatible with the version still running.
