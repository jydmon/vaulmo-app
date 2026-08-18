# LifeHub infrastructure — portable skeleton.
#
# You chose "portable Docker, decide later", so this is intentionally provider-agnostic:
# it documents the resources each environment needs. When you pick a host (AWS, GCP,
# Render, Fly, ...), fill in the matching provider blocks — the shape stays the same.
#
# Environments are fully isolated: each has its own database, its own object-storage
# bucket, and its own secrets. Dev and staging never share data.

terraform {
  required_version = ">= 1.5"
  # backend "s3" { ... }   # store state remotely per environment
}

variable "environment" {
  description = "development | staging"
  type        = string
}

# --- What each environment provisions (pseudo-resources; swap for your provider) ---
#
# 1. Managed PostgreSQL 16          (e.g. AWS RDS / GCP Cloud SQL / Render Postgres)
#    - private networking only, TLS required, automated backups, PITR
#
# 2. Object storage bucket          (e.g. S3 / GCS / R2)  — for the file-storage driver
#    - private, versioned, encrypted at rest (SSE-KMS)
#
# 3. Secret store entries           (e.g. Secrets Manager) — JWT secrets, DB URL, S3 creds
#
# 4. Container runtime              (e.g. ECS/Fargate, Cloud Run, a VM with docker compose)
#    - api + web services on a PRIVATE network, reachable via VPN/bastion only
#
# 5. Log sink + metrics             (e.g. CloudWatch / Loki + Prometheus / Datadog)
#
# 6. Network                        - no public ingress in Phase 1; VPC + private subnets

output "notes" {
  value = "Environment ${var.environment}: provision DB, bucket, secrets, private container runtime, logging. No public ingress in Phase 1."
}
