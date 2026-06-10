import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as http from '@actions/http-client'
import * as fs from 'node:fs'

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
  const debug = core.getBooleanInput('debug')

  core.saveState('debug', debug ? 'true' : '')

  if (isPublicForkPR(debug)) {
    core.warning('Fork PR detected — creating empty directory instead of mounting disk')
    await fs.promises.mkdir(diskPath, {recursive: true})
    return
  }

  await core.group('Installing archil', () => ensureArchil(debug))

  const {token, identifier, args} = await core.group('Acquiring disk token', () => acquireDiskToken(disk, debug))
  core.setSecret(token)
  core.saveState('identifier', identifier)
  core.saveState('disk', disk)
  core.saveState('path', diskPath)

  await core.group('Mounting disk', async () => {
    if (debug) core.info(`Creating directory: ${diskPath}`)
    await fs.promises.mkdir(diskPath, {recursive: true})
    const cliArgs = [
      '--preserve-env=ARCHIL_MOUNT_TOKEN',
      ARCHIL_BIN,
      'mount',
      ...args,
    ]
    if (debug) core.info(`Mounting disk ${disk} to ${diskPath}`)
    await exec.exec('sudo', cliArgs, {
      env: {...process.env, ARCHIL_MOUNT_TOKEN: token},
    })
  })

  await core.group('Checking out disk', async () => {
    if (debug) core.info(`Checkout disk at ${diskPath}`)
    await exec.exec('sudo', [ARCHIL_BIN, 'checkout', diskPath, '-y'])
  })

  await core.group('Fixing permissions', async () => {
    if (debug) core.info(`Setting disk permissions to runner:runner`)
    await exec.exec('sudo', ['chown', '-R', 'runner:runner', diskPath])
  })
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

async function acquireDiskToken(disk: string, debug: boolean): Promise<DiskTokenResponse> {
  const url = `${METADATA_API}/archil/disk-token?disk=${encodeURIComponent(disk)}`
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
