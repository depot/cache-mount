import assert from 'node:assert/strict'
import test from 'node:test'

import * as http from '@actions/http-client'

import {
  acquireDiskToken,
  CACHE_MOUNT_REPOSITORY_RESTRICTED_CODE,
  type DiskTokenResponse,
  type JsonHttpClient,
} from './disk-token.ts'

const diskToken: DiskTokenResponse = {
  token: 'token-123',
  identifier: 'disk-123',
  args: ['--disk', 'disk-123'],
}

test('returns a successful disk token response', async () => {
  const result = await acquireDiskToken(responseClient(diskToken), 'disk one', '/tmp/cache path')

  assert.deepEqual(result, diskToken)
})

test('returns undefined only for the explicit repository restriction', async () => {
  const error = new http.HttpClientError('cache mount restricted', 403)
  error.result = {code: CACHE_MOUNT_REPOSITORY_RESTRICTED_CODE}

  const result = await acquireDiskToken(errorClient(error), 'disk-one', '/tmp/cache')

  assert.equal(result, undefined)
})

test('rethrows unrelated permission denials', async () => {
  const error = new http.HttpClientError('unauthorized', 403)
  error.result = {code: 'unauthorized'}

  await assert.rejects(acquireDiskToken(errorClient(error), 'disk-one', '/tmp/cache'), (caught) => caught === error)
})

test('rethrows upstream service failures', async () => {
  const error = new http.HttpClientError('unavailable', 502)

  await assert.rejects(acquireDiskToken(errorClient(error), 'disk-one', '/tmp/cache'), (caught) => caught === error)
})

test('rejects malformed successful responses', async () => {
  await assert.rejects(
    acquireDiskToken(responseClient<DiskTokenResponse>(null), 'disk-one', '/tmp/cache'),
    /Failed to acquire disk token \(status 200\)/,
  )
})

function responseClient<TResponse>(result: TResponse | null): JsonHttpClient {
  return {
    async postJson<T>() {
      return {statusCode: 200, result: result as T | null}
    },
  }
}

function errorClient(error: Error): JsonHttpClient {
  return {
    async postJson<T>() {
      throw error
    },
  }
}
