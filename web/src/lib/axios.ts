import Axios from 'axios'

const apiUrl = (window as unknown as { __BACKEND_API_URL__?: string }).__BACKEND_API_URL__ || '/api/v1'

const axios = Axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

// D1 Sessions bookmarks provide sequential consistency while still allowing
// read replicas. They stay in memory and are neither credentials nor persisted
// browser storage.
let d1Bookmark: string | undefined
axios.interceptors.request.use((config) => {
  if (d1Bookmark) config.headers.set('x-d1-bookmark', d1Bookmark)
  return config
})

axios.interceptors.response.use(
  (response) => {
    const nextBookmark = response.headers['x-d1-bookmark'] as string | undefined
    if (nextBookmark) d1Bookmark = nextBookmark
    return response
  },
  (error) => {
    const isAuthRoute = error.config?.url?.startsWith('/auth/')
    if (error.response?.status === 401 && !isAuthRoute) {
      window.location.href = '/'
    }
    return Promise.reject(error)
  },
)

export default axios
