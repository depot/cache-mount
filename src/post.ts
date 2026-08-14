import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as http from '@actions/http-client'

const METADATA_API = 'http://169.254.169.253:80'
const ARCHIL_BIN = '/usr/bin/archil'

const client = new http.HttpClient('depot-cache-mount-action')

async function post() {
  const identifier = core.getState('identifier')
  const disk = core.getState('disk')
  const diskPath = core.getState('path')
  const mounted = core.getState('mounted') === 'true'
  const debug = core.getState('debug') === 'true'

  if (!identifier || !disk) {
    core.info('No disk token state found, skipping cleanup')
    return
  }

  if (mounted) {
    if (!diskPath) throw new Error('Mounted disk path state is missing')
    await core.group('Unmounting disk', async () => {
      if (debug) core.info(`Unmounting disk ${disk} from ${diskPath}`)
      await exec.exec('sudo', [ARCHIL_BIN, 'unmount', diskPath])
    })
  }

  await core.group('Releasing disk token', async () => {
    const url = `${METADATA_API}/archil/disk-token?disk=${encodeURIComponent(disk)}&identifier=${encodeURIComponent(identifier)}`
    if (debug) core.info(`Requesting: DELETE ${url}`)
    const res = await client.del(url)
    await res.readBody()
    if (debug) core.info(`Delete response: status=${res.message.statusCode}`)
    if (res.message.statusCode !== 200) {
      throw new Error(`Failed to release disk token (status ${res.message.statusCode})`)
    }
    core.info(`Released disk token for identifier: ${identifier}`)
    client.dispose()
  })
}

post().catch((error) => {
  if (error instanceof Error) core.setFailed(error.message)
  else core.setFailed(`${error}`)
})
