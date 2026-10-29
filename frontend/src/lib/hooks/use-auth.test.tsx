import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import apiClient from '@/lib/api/client'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useAuth } from './use-auth'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/api/client', () => ({ default: { get: vi.fn() } }))
vi.unmock('@/lib/hooks/use-auth')

describe('initial authentication status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      hasHydrated: true,
      authRequired: null,
      isAuthenticated: false,
      isLoading: false,
      isCheckingAuth: false,
      token: null,
      error: null,
      lastAuthCheck: null,
    })
  })

  it('keeps the requested page loading until no-auth status is resolved', async () => {
    let resolve!: (value: { data: { auth_enabled: boolean } }) => void
    vi.mocked(apiClient.get).mockImplementation(() => new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useAuth())

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isAuthenticated).toBe(false)
    await act(async () => { resolve({ data: { auth_enabled: false } }) })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('does not get stuck loading when the status request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(apiClient.get).mockRejectedValue({ isAxiosError: true })
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.error).toContain('Unable to connect'))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isAuthenticated).toBe(false)
    expect(apiClient.get).toHaveBeenCalledTimes(1)
    vi.mocked(console.error).mockRestore()
  })

  it('still requires login when authentication is enabled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { auth_enabled: true } })
    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(false)
  })
})
