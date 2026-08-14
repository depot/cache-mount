import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as http from '@actions/http-client'
import * as fs from 'node:fs'

import {acquireDiskToken} from './disk-token'

const ARCHIL_BIN = '/usr/bin/archil'

const client = new http.HttpClient('depot-cache-mount-action')

async function run() {
  const diskPath = core.getInput('path', {required: true})
  const disk = core.getInput('name', {required: true})
  const debug = core.getBooleanInput('debug')

  core.saveState('debug', debug ? 'true' : '')

  if (isPublicForkPR(debug)) {
    core.warning('Fork PR detected — creating empty directory instead of mounting disk')
    await createEmptyDirectory(diskPath)
    return
  }

  const diskToken = await core.group('Acquiring disk token', () =>
    acquireDiskToken(client, disk, diskPath, debug ? core.info : undefined),
  )
  if (!diskToken) {
    core.warning('Cache mounts are restricted for this repository — creating empty directory instead of mounting disk')
    await createEmptyDirectory(diskPath)
    return
  }

  const {token, identifier, args} = diskToken
  core.info(`Acquired disk token for identifier: ${identifier}`)
  core.setSecret(token)
  core.saveState('identifier', identifier)
  core.saveState('disk', disk)
  core.saveState('path', diskPath)

  await core.group('Installing archil', () => ensureArchil(debug))

  await core.group('Mounting disk', async () => {
    if (debug) core.info(`Creating directory: ${diskPath}`)
    await exec.exec('sudo', ['mkdir', '-p', diskPath])
    // The API still returns --shared for older action versions that use checkout/checkin.
    // This action uses conditional mode instead, so ensure exactly one mount mode is passed.
    const mountArgs = args.filter((arg) => arg !== '--shared' && arg !== '--conditional')
    const cliArgs = ['--preserve-env=ARCHIL_MOUNT_TOKEN', ARCHIL_BIN, 'mount', '--conditional', ...mountArgs]
    if (debug) core.info(`Mounting disk ${disk} to ${diskPath}`)
    await exec.exec('sudo', cliArgs, {
      env: {...process.env, ARCHIL_MOUNT_TOKEN: token},
    })
    core.saveState('mounted', 'true')

    if (!process.getuid || !process.getgid) throw new Error('Unable to determine the runner user')
    const uid = process.getuid()
    const gid = process.getgid()
    if (debug) core.info(`Setting disk ownership to ${uid}:${gid}`)
    await exec.exec('sudo', ['chown', `${uid}:${gid}`, diskPath])
  })
}

async function createEmptyDirectory(diskPath: string) {
  await exec.exec('sudo', ['mkdir', '-p', diskPath])
  await exec.exec('sudo', ['chown', '-R', 'runner:runner', diskPath])
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

run().catch((error) => {
  if (error instanceof Error) core.setFailed(error.message)
  else core.setFailed(`${error}`)
})
