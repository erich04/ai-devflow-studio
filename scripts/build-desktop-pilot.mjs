import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDesktopArtifactManifest,
  sha256File,
  stageDesktopPilotApplication,
  writeDeterministicTarGzip,
} from './desktop-pilot-artifact.mjs'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDirectory = path.join(rootDirectory, 'apps', 'desktop')
const outputDirectory = path.join(rootDirectory, 'out', 'desktop-pilot')
const packagedAppsDirectory = path.join(outputDirectory, 'app-directory')
const requireFromDesktop = createRequire(path.join(desktopDirectory, 'package.json'))
const packager = requireFromDesktop('@electron/packager')

function safeArtifactLabel(version, platform, arch) {
  const label = `ai-devflow-studio-desktop-${version}-${platform}-${arch}`
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(label)) {
    throw new Error(`Desktop version cannot be represented in an artifact filename: ${version}`)
  }
  return label
}

async function assertBuiltDesktop() {
  const required = [
    path.join(desktopDirectory, 'dist', 'index.html'),
    path.join(desktopDirectory, 'dist-electron', 'main.js'),
    path.join(desktopDirectory, 'dist-electron', 'preload.cjs'),
  ]
  await Promise.all(required.map((filePath) => access(filePath)))

  const mainSource = await readFile(path.join(desktopDirectory, 'dist-electron', 'main.js'), 'utf8')
  if (mainSource.includes('@ai-devflow/shared') || mainSource.includes('packages/shared/src/')) {
    throw new Error('Desktop main bundle still depends on workspace source at runtime.')
  }
}

function relativeToOutput(filePath) {
  return path.relative(outputDirectory, filePath).split(path.sep).join('/')
}

await assertBuiltDesktop()

const [desktopPackage, electronPackage] = await Promise.all([
  readFile(path.join(desktopDirectory, 'package.json'), 'utf8').then(JSON.parse),
  readFile(requireFromDesktop.resolve('electron/package.json'), 'utf8').then(JSON.parse),
])
const sqlJsDirectory = path.dirname(path.dirname(requireFromDesktop.resolve('sql.js/dist/sql-wasm.js')))
const sqlJsPackage = JSON.parse(await readFile(path.join(sqlJsDirectory, 'package.json'), 'utf8'))
const platform = process.platform
const arch = process.arch
const artifactLabel = safeArtifactLabel(desktopPackage.version, platform, arch)
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'devflow-desktop-pilot-build-'))

try {
  const stagingDirectory = path.join(temporaryDirectory, 'application')
  await stageDesktopPilotApplication({
    desktopDirectory,
    stagingDirectory,
    sqlJsDirectory,
  })

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(packagedAppsDirectory, { recursive: true })
  const packagedPaths = await packager({
    dir: stagingDirectory,
    out: packagedAppsDirectory,
    name: 'AI DevFlow Studio',
    executableName: 'AI DevFlow Studio',
    appBundleId: 'studio.devflow.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    appVersion: desktopPackage.version,
    buildVersion: desktopPackage.version,
    platform,
    arch,
    electronVersion: electronPackage.version,
    asar: false,
    prune: false,
    overwrite: true,
  })

  if (packagedPaths.length !== 1) {
    throw new Error(`Expected one current-platform Desktop package, received ${packagedPaths.length}.`)
  }

  const appDirectory = path.resolve(packagedPaths[0])
  const manifestPath = path.join(outputDirectory, `${artifactLabel}.manifest.json`)
  const archivePath = path.join(outputDirectory, `${artifactLabel}.tar.gz`)
  await writeDeterministicTarGzip({
    sourceDirectory: appDirectory,
    archivePath,
    archiveRootName: artifactLabel,
  })
  const manifest = await createDesktopArtifactManifest(appDirectory, {
    productName: 'AI DevFlow Studio',
    version: desktopPackage.version,
    electronVersion: electronPackage.version,
    sqlJsVersion: sqlJsPackage.version,
    platform,
    arch,
  })
  const archiveSha256 = await sha256File(archivePath)
  const completedManifest = {
    ...manifest,
    archive: {
      path: path.basename(archivePath),
      sha256: archiveSha256,
    },
  }
  await writeFile(manifestPath, `${JSON.stringify(completedManifest, null, 2)}\n`, { mode: 0o644 })

  const artifactIndex = {
    schemaVersion: 1,
    platform,
    arch,
    appDirectory: relativeToOutput(appDirectory),
    manifest: relativeToOutput(manifestPath),
    archive: relativeToOutput(archivePath),
  }
  await writeFile(
    path.join(outputDirectory, 'artifact-index.json'),
    `${JSON.stringify(artifactIndex, null, 2)}\n`,
    { mode: 0o644 },
  )

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        outputDirectory,
        ...artifactIndex,
        archiveSha256,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
