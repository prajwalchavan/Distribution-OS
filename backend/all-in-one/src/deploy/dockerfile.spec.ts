import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, readArtifact } from './paths.js'

/**
 * DEP-01 — the image builds and runs.
 *
 * The Dockerfile had never been built (docs/26 §5 planned it; nothing ever ran it), and reading it
 * against what `docker build` actually does turns up four faults that stop it dead. These are the
 * static half of the proof; the build-and-run half is `docker-image.proof.spec.ts`, which needs a
 * Docker daemon and is opt-in.
 */
const dockerfile = readArtifact('backend/infra/docker/Dockerfile')
const workspaceYaml = readFileSync(resolve(BACKEND_ROOT, 'pnpm-workspace.yaml'), 'utf8')

/** Every workspace package that must reach the build context with its own directory intact. */
const SERVICE_DIRS = [
  'auth-service',
  'owner-service',
  'manager-service',
  'sales-service',
  'warehouse-service',
  'delivery-service',
  'retailer-service',
  'admin-service',
]

describe('DEP-01 the image builds and runs', () => {
  it('DEP-01 copies each service into its own directory, never the `COPY *-service ./` collapse', () => {
    // `COPY *-service ./` expands to eight source directories and one destination: Docker copies the
    // CONTENTS of each into /repo, so eight package.json files land on top of each other and
    // `pnpm install --filter @dos/owner-service...` cannot find a single one of them.
    expect(dockerfile).not.toMatch(/^\s*COPY\s+\*-service\s/m)
    for (const dir of SERVICE_DIRS) {
      expect(dockerfile).toMatch(new RegExp(`^\\s*COPY\\s+${dir}\\s+\\./${dir}\\s*$`, 'm'))
    }
  })

  it('DEP-01 deploys with --legacy, which is what the hoisted linker requires', () => {
    // pnpm 10+ refuses `pnpm deploy` unless the workspace injects its packages
    // (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE). This workspace is `nodeLinker: hoisted` and does NOT
    // inject, so the flag is not optional.
    expect(workspaceYaml).not.toMatch(/injectWorkspacePackages:\s*true/)
    expect(dockerfile).toMatch(/pnpm\s+(--filter\s+\S+\s+)?deploy\b[^\n]*--legacy/)
  })

  it('DEP-01 builds argon2 from source: there is no musl prebuild for it', () => {
    // argon2 0.45.1 ships prebuilds for linux-arm64/x64 (glibc) and none for linuxmusl-*. On
    // node:24-alpine node-gyp-build falls through to compiling, which needs a toolchain in the
    // BUILD stage only — the runtime stage keeps the compiled .node and no compiler.
    const buildStage = dockerfile.slice(
      dockerfile.indexOf('AS build'),
      dockerfile.indexOf('AS runtime'),
    )
    expect(buildStage).toMatch(/apk add[^\n]*\bpython3\b/)
    expect(buildStage).toMatch(/apk add[^\n]*\bg\+\+/)
  })

  it('DEP-01 runs as a non-root user and declares a HEALTHCHECK on /health', () => {
    expect(dockerfile).toMatch(/^\s*USER\s+node\s*$/m)
    expect(dockerfile).toMatch(/^\s*HEALTHCHECK\b/m)
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]{0,400}\/health/)
  })

  it('DEP-01 pins Node 24 on alpine wherever it names a registry image', () => {
    // A `FROM base AS src` names an earlier stage, not an image; only the ones carrying a tag are
    // pulled, and those are the ones that must be pinned.
    const images = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)]
      .map((m) => m[1] ?? '')
      .filter((ref) => ref.includes(':'))
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) expect(image).toBe('node:24-alpine')
  })

  it('DEP-01 keeps the host node_modules out of the build context', () => {
    // The host tree is a macOS/arm64 install with a darwin-arm64 argon2 binding in it; copied into
    // the context it would shadow the linux install the build makes.
    const ignore = readArtifact('backend/infra/docker/Dockerfile.dockerignore')
    expect(ignore).toMatch(/^\*\*\/node_modules$/m)
    expect(ignore).toMatch(/^\.env$/m)
  })

  it('DEP-01 carries one entrypoint with the verbs the deployment needs', () => {
    const entrypoint = readArtifact('backend/infra/docker/entrypoint.sh')
    for (const verb of ['serve', 'migrate', 'bootstrap']) {
      expect(entrypoint).toMatch(new RegExp(`^\\s*${verb}\\)`, 'm'))
    }
    expect(dockerfile).toMatch(/ENTRYPOINT \["\/usr\/local\/bin\/dos"\]/)
    expect(dockerfile).toMatch(/^\s*CMD \["serve"\]\s*$/m)
  })
})
