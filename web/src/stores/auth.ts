import { create } from 'zustand'
import { login, register, logout, me } from '@/api/endpoints/auth/auth'
import type { User } from '@/api/models/user'

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string, password_confirmation: string) => Promise<void>
  logout: () => Promise<void>
  fetchUser: () => Promise<void>
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  login: async (email, password) => {
    const data = await login({ email, password })
    set({ token: 'session', user: data.user ?? null, isLoading: false })
  },

  register: async (name, email, password, password_confirmation) => {
    const data = await register({ name, email, password, password_confirmation })
    set({ token: 'session', user: data.user ?? null, isLoading: false })
  },

  logout: async () => {
    try {
      await logout()
    } finally {
      set({ token: null, user: null })
      window.location.href = '/'
    }
  },

  fetchUser: async () => {
    try {
      const data = await me()
      set({ token: 'session', user: data, isLoading: false })
    } catch {
      set({ token: null, user: null, isLoading: false })
    }
  },

  reset: () => {
    set({ token: null, user: null, isLoading: false })
  },
}))
