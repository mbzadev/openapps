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

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const isAuthRoute = error.config?.url?.startsWith('/auth/')
    if (error.response?.status === 401 && !isAuthRoute) {
      window.location.href = '/'
    }
    return Promise.reject(error)
  },
)

export default axios
