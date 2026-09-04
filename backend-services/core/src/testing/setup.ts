import { loadDotenv } from '@dos/db'

// Runs before every spec file: the repo-root .env supplies DATABASE_URL so `describeDb` suites run locally.
loadDotenv()
