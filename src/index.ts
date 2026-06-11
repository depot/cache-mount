import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as http from '@actions/http-client'
import * as fs from 'node:fs'
import * as path from 'node:path'

const METADATA_API = 'http://169.254.169.253:80'
const ARCHIL_BIN = '/usr/bin/archil'

const client = new http.HttpClient('depot-cache-mount-action')

interface DiskTokenResponse {
  token: string
  identifier: string
  args: string[]
}

async function run() {
  const diskPath = core.getInput('path', {required: true})
  const disk = core.getInput('name', {required: true})
  const writeLocks = core.getMultilineInput('write-lock', {required: false})
  const debug = core.getBooleanInput('debug')

  // Locking the disk root covers everything, so ignore any other paths in that case.
  const lockWholeDisk = writeLocks.includes(diskPath)
  const resources = lockWholeDisk ? [diskPath] : writeLocks

  core.saveState('debug', debug ? 'true' : '')

  if (isPublicForkPR(debug)) {
    core.warning('Fork PR detected — creating empty directory instead of mounting disk')
    await fs.promises.mkdir(diskPath, {recursive: true})
    return
  }

  await core.group('Installing archil', () => ensureArchil(debug))

  const {token, identifier, args} = await core.group('Acquiring disk token', () =>
    acquireDiskToken(disk, diskPath, debug),
  )
  core.setSecret(token)
  core.saveState('identifier', identifier)
  core.saveState('disk', disk)
  core.saveState('path', diskPath)
  core.saveState('write-lock', resources)

  await core.group('Mounting disk', async () => {
    if (debug) core.info(`Creating directory: ${diskPath}`)
    await exec.exec('sudo', ['mkdir', '-p', diskPath])
    const cliArgs = ['--preserve-env=ARCHIL_MOUNT_TOKEN', ARCHIL_BIN, 'mount', ...args]
    if (debug) core.info(`Mounting disk ${disk} to ${diskPath}`)
    await exec.exec('sudo', cliArgs, {
      env: {...process.env, ARCHIL_MOUNT_TOKEN: token},
    })
  })

  if (lockWholeDisk) {
    await core.group('Locking disk', async () => {
      if (debug) core.info(`Locking ${diskPath} for write`)
      await exec.exec(ARCHIL_BIN, ['checkout', '-f', diskPath, '-y'])
    })

    await core.group('Fixing permissions', async () => {
      if (debug) core.info(`Setting disk permissions to runner:runner`)
      await exec.exec('sudo', ['chown', '-R', 'runner:runner', diskPath])
    })
  } else if (resources.length > 0) {
    const missing = resources.filter((resource) => !fs.existsSync(resource))

    if (missing.length > 0) {
      // Resources can only be created while holding the whole-disk lock.
      await core.group('Preparing resources', async () => {
        if (debug) core.info(`Locking ${diskPath} to create missing resources`)
        await exec.exec(ARCHIL_BIN, ['checkout', '-f', diskPath, '-y'])

        try {
          if (debug) core.info(`Setting disk permissions to runner:runner`)
          await exec.exec('sudo', ['chown', '-R', 'runner:runner', diskPath])

          for (const resource of missing) {
            if (path.extname(resource)) {
              if (debug) core.info(`Creating file ${resource}`)
              await fs.promises.mkdir(path.dirname(resource), {recursive: true})
              await fs.promises.writeFile(resource, '')
            } else {
              if (debug) core.info(`Creating directory ${resource}`)
              await fs.promises.mkdir(resource, {recursive: true})
              await exec.exec('sudo', ['chown', '-R', 'runner:runner', resource])
            }
          }
        } finally {
          if (debug) core.info(`Unlocking ${diskPath}`)
          await exec.exec(ARCHIL_BIN, ['checkin', diskPath])
        }
      })
    }

    await core.group('Locking resources', async () => {
      for (const resource of resources) {
        if (debug) core.info(`Locking ${resource} for write`)
        await exec.exec(ARCHIL_BIN, ['checkout', resource, '-y'])
      }
    })
  }
}

function isPublicForkPR(debug: boolean): boolean {
  const eventName = process.env.GITHUB_EVENT_NAME
  const visibility = process.env.GITHUB_REPOSITORY_VISIBILITY
  let baseFullName = process.env.GITHUB_PR_BASE_FULL_NAME ?? ''
  let headFullName = process.env.GITHUB_PR_HEAD_FULL_NAME ?? ''

  if (eventName !== 'pull_request') return false
  if (visibility !== 'public') return false
  if (baseFullName && baseFullName === headFullName) return false

  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath) {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
      baseFullName = event.pull_request?.base?.repo?.full_name ?? ''
      headFullName = event.pull_request?.head?.repo?.full_name ?? ''
      if (baseFullName && baseFullName === headFullName) return false
    } catch {
      // ignore parse errors
    }
  }

  if (debug) core.info(`Public fork PR detected: base=${baseFullName}, head=${headFullName}`)
  return true
}

async function ensureArchil(debug: boolean) {
  if (fs.existsSync(ARCHIL_BIN)) {
    core.info('archil already installed')
    return
  }
  core.info('Installing archil...')
  await exec.exec('bash', ['-c', 'curl -fsSL https://archil.com/install | sh'])
}

async function acquireDiskToken(disk: string, diskPath: string, debug: boolean): Promise<DiskTokenResponse> {
  const url = `${METADATA_API}/archil/disk-token?disk=${encodeURIComponent(disk)}&disk_path=${encodeURIComponent(diskPath)}`
  if (debug) core.info(`Requesting disk token: POST ${url}`)
  const res = await client.postJson<DiskTokenResponse>(url, {})
  if (debug) core.info(`Disk token response: status=${res.statusCode}`)
  if (!res.result) {
    throw new Error(`Failed to acquire disk token (status ${res.statusCode})`)
  }
  core.info(`Acquired disk token for identifier: ${res.result.identifier}`)
  return res.result
}

run().catch((error) => {
  if (error instanceof Error) core.setFailed(error.message)
  else core.setFailed(`${error}`)
})
