import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSessionUser, resetSigningKeyCache } from '../sessionUser'

// Every page load asked Supabase Auth "who is this?" up to three times — the
// proxy, the app layout, the page — before any HTML went out. On the free
// instance that service is swapped out after a few idle minutes, and
// Server-Timing on production (#791) showed a single such call taking 1–3.5 s
// to come back. The access token is signed with the project's ES256 key, so its
// signature can be checked right here instead, against the public keys.

const URL_ = 'https://project.supabase.co'
const jwks = { keys: [{ kid: 'k1', kty: 'EC', alg: 'ES256' }] }

type Claims = Record<string, unknown>

function clientReturning(result: { data: { claims: Claims } | null; error: unknown }) {
  const getClaims = vi.fn().mockResolvedValue(result)
  const getUser = vi.fn()
  return { client: { auth: { getClaims, getUser } }, getClaims, getUser }
}

const verified = (claims: Claims) => clientReturning({ data: { claims }, error: null })

function stubJwksFetch(impl?: () => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation(
    impl ?? (async () => ({ ok: true, json: async () => jwks }) as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => { resetSigningKeyCache() })
afterEach(() => { vi.unstubAllGlobals() })

describe('getSessionUser', () => {
  it('reads the user from the verified token', async () => {
    stubJwksFetch()
    const { client } = verified({
      sub: 'user-1', email: 'a@example.com', user_metadata: { display_name: 'An' },
    })

    await expect(getSessionUser(client, URL_)).resolves.toEqual({
      id: 'user-1', email: 'a@example.com', displayName: 'An',
    })
  })

  it('falls back to full_name, the name an OAuth sign-up carries', async () => {
    stubJwksFetch()
    const { client } = verified({ sub: 'user-1', email: 'a@example.com', user_metadata: { full_name: 'An Nguyen' } })

    expect((await getSessionUser(client, URL_))?.displayName).toBe('An Nguyen')
  })

  it('never asks the Auth server who the user is', async () => {
    stubJwksFetch()
    const { client, getUser } = verified({ sub: 'user-1', email: 'a@example.com' })

    await getSessionUser(client, URL_)

    expect(getUser).not.toHaveBeenCalled()
  })

  it('hands the signing keys to the verifier, fetching them once for many requests', async () => {
    // The auth client is built per request and keeps its key cache on itself,
    // so left alone it would fetch the keys on every request — one network call
    // traded for another. The keys are public and rarely change; hold them here.
    const fetchMock = stubJwksFetch()
    const first = verified({ sub: 'user-1' })
    const second = verified({ sub: 'user-1' })

    await getSessionUser(first.client, URL_)
    await getSessionUser(second.client, URL_)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${URL_}/auth/v1/.well-known/jwks.json`)
    expect(second.getClaims).toHaveBeenCalledWith(undefined, { jwks })
  })

  it('still verifies when the keys cannot be fetched, leaving the verifier to find them', async () => {
    stubJwksFetch(async () => { throw new Error('network down') })
    const { client, getClaims } = verified({ sub: 'user-1' })

    await expect(getSessionUser(client, URL_)).resolves.toMatchObject({ id: 'user-1' })
    expect(getClaims).toHaveBeenCalledWith(undefined, undefined)
  })

  it('tries the keys again after a failed fetch rather than remembering the failure', async () => {
    const fetchMock = stubJwksFetch(async () => { throw new Error('network down') })
    await getSessionUser(verified({ sub: 'user-1' }).client, URL_)
    await getSessionUser(verified({ sub: 'user-1' }).client, URL_)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports no user when there is no session', async () => {
    stubJwksFetch()
    const { client } = clientReturning({ data: null, error: null })

    await expect(getSessionUser(client, URL_)).resolves.toBeNull()
  })

  it('reports no user when the token does not verify', async () => {
    stubJwksFetch()
    const { client } = clientReturning({ data: null, error: { message: 'Invalid JWT signature' } })

    await expect(getSessionUser(client, URL_)).resolves.toBeNull()
  })

  it('reports no user when verification throws', async () => {
    // A thrown error here would otherwise take the whole page down with a 500.
    stubJwksFetch()
    const client = { auth: { getClaims: vi.fn().mockRejectedValue(new Error('boom')) } }

    await expect(getSessionUser(client, URL_)).resolves.toBeNull()
  })

  it('reports no user for a token without a subject', async () => {
    stubJwksFetch()
    const { client } = verified({ email: 'a@example.com' })

    await expect(getSessionUser(client, URL_)).resolves.toBeNull()
  })
})
