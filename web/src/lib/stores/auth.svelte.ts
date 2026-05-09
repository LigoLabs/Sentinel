import { api, ApiError } from '$lib/api';

function createAuth() {
  let authenticated = $state(false);
  let checked = $state(false);

  async function check() {
    try {
      const res = await api.get<{ authenticated: boolean }>('/auth/me');
      authenticated = res.authenticated;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        authenticated = false;
      }
    } finally {
      checked = true;
    }
  }

  async function login(password: string) {
    await api.post('/auth/login', { password });
    authenticated = true;
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Proceed with logout even if API call fails
    }
    authenticated = false;
  }

  check();

  return {
    get authenticated() { return authenticated; },
    get checked() { return checked; },
    login,
    logout,
    check,
  };
}

export const auth = createAuth();
