import * as http from '@actions/http-client'

const METADATA_API = 'http://169.254.169.253:80'

export const CACHE_MOUNT_REPOSITORY_RESTRICTED_CODE = 'cache_mount_repository_restricted'

export interface DiskTokenResponse {
  token: string
  identifier: string
  args: string[]
}

export interface JsonHttpClient {
  postJson<T>(requestUrl: string, obj: unknown): Promise<{statusCode: number; result: T | null}>
}

export async function acquireDiskToken(
  client: JsonHttpClient,
  disk: string,
  diskPath: string,
  log?: (message: string) => void,
): Promise<DiskTokenResponse | undefined> {
  const url = `${METADATA_API}/archil/disk-token?disk=${encodeURIComponent(disk)}&disk_path=${encodeURIComponent(diskPath)}`
  log?.(`Requesting disk token: POST ${url}`)

  try {
    const res = await client.postJson<DiskTokenResponse>(url, {})
    log?.(`Disk token response: status=${res.statusCode}`)
    if (!res.result) {
      throw new Error(`Failed to acquire disk token (status ${res.statusCode})`)
    }
    return res.result
  } catch (error) {
    if (isCacheMountRepositoryRestrictedError(error)) {
      log?.(`Disk token response: status=${error.statusCode}`)
      return undefined
    }
    throw error
  }
}

function isCacheMountRepositoryRestrictedError(error: unknown): error is http.HttpClientError {
  if (!(error instanceof http.HttpClientError) || error.statusCode !== 403) return false
  if (!error.result || typeof error.result !== 'object') return false
  return 'code' in error.result && error.result.code === CACHE_MOUNT_REPOSITORY_RESTRICTED_CODE
}
