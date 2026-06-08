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
  orgID: string
}

async function run() {
  const diskPath = core.getInput('path', {required: true})
  const disk = core.getInput('name', {required: true})
  const debug = core.getBooleanInput('debug')

  core.saveState('debug', debug ? 'true' : '')

  await core.group('Installing archil', () => ensureArchil(debug))

  const {token, identifier, orgID} = await core.group('Acquiring disk token', () => acquireDiskToken(disk, debug))
  core.setSecret(token)
  core.saveState('identifier', identifier)
  core.saveState('disk', disk)
  core.saveState('path', diskPath)
  core.saveState('orgID', orgID)

  await core.group('Mounting disk', async () => {
    if (debug) core.info(`Creating directory: ${diskPath}`)
    await fs.promises.mkdir(diskPath, {recursive: true})
    const args = [
      '--preserve-env=ARCHIL_MOUNT_TOKEN',
      ARCHIL_BIN,
      'mount',
      `depot/${orgID}-${disk}`,
      diskPath,
      '--shared',
    ]
    if (debug) core.info(`Mounting disk ${disk} to ${diskPath}`)
    await exec.exec('sudo', args, {
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
  if (debug) core.info(`Requesting disk token: GET ${url}`)
  const res = await client.getJson<DiskTokenResponse>(url)
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
