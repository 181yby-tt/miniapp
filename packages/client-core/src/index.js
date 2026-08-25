const DEFAULT_ERROR_MESSAGE = '操作没有完成，请稍后重试';

export class ApiError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 0, details = {}) {
    super(message || DEFAULT_ERROR_MESSAGE);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createSessionStore(storage, key = 'kexu_session') {
  const read = () => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  return {
    get: read,
    getToken: () => read()?.token || '',
    set(session) {
      storage.setItem(key, JSON.stringify(session));
      return session;
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, sessionStore, onUnauthorized } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');

  async function request(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const token = sessionStore?.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetchImpl(`${normalizedBase}${path}`, {
        ...options,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError('网络连接失败，请检查网络后重试', 'NETWORK_ERROR');
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('服务器返回了无法识别的内容', 'INVALID_RESPONSE', response.status);
    }

    if (!response.ok || payload.code !== 'OK') {
      if (response.status === 401) onUnauthorized?.();
      throw new ApiError(payload.message, payload.code, response.status, payload.details);
    }
    return payload.data;
  }

  return {
    request,
    login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
    changePassword: (payload) => request('/api/auth/change-password', { method: 'POST', body: payload }),
    getCourses: ({ query = '', category = '' } = {}) => {
      const params = new URLSearchParams({ open: '1' });
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      return request(`/api/courses?${params}`);
    },
    getCourse: (id) => request(`/api/courses/${id}`),
    getEligibility: (id) => request(`/api/courses/${id}/eligibility`),
    enroll: (id, idempotencyKey) => request(`/api/courses/${id}/enroll`, { method: 'POST', body: { idempotency_key: idempotencyKey } }),
    withdraw: (id) => request(`/api/courses/${id}/enrollment`, { method: 'DELETE', body: {} }),
    getEnrollments: () => request('/api/me/enrollments'),
    getSchedule: () => request('/api/me/schedule'),
    getProfile: () => request('/api/me/profile'),
    getAdminDashboard: () => request('/api/admin/dashboard'),
    getAdminMeta: () => request('/api/admin/meta'),
    getAdminCourses: () => request('/api/admin/courses'),
    setCourseStatus: (id, action) => request(`/api/admin/courses/${id}/${action}`, { method: 'POST', body: {} }),
    getAdminStudents: (query = '') => request(`/api/admin/students${query ? `?q=${encodeURIComponent(query)}` : ''}`),
    getAdminEnrollments: ({ query = '', status = 'ENROLLED' } = {}) => {
      const params = new URLSearchParams({ status });
      if (query) params.set('q', query);
      return request(`/api/admin/enrollments?${params}`);
    },
    getAdminConfigs: () => request('/api/admin/configs'),
    updateAdminConfigs: (items) => request('/api/admin/configs', { method: 'PUT', body: { items } }),
    getAdminAudit: () => request('/api/admin/audit'),
  };
}

export const COURSE_TONES = ['mint', 'blue', 'amber', 'violet', 'coral', 'navy'];
export const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五'];

export function toneForCourse(id) {
  const numeric = Number(id) || 0;
  return COURSE_TONES[Math.abs(numeric) % COURSE_TONES.length];
}

export function decorateCourse(course = {}) {
  const schedules = course.schedules || [];
  return {
    ...course,
    tone: toneForCourse(course.id),
    mark: String(course.name || '课').slice(0, 1),
    teacherText: (course.teachers || []).join('、') || '待定',
    timeText: schedules.map((item) => item.slot_name).filter(Boolean).join('、') || '待定',
    venueText: schedules.map((item) => item.venue_name).filter(Boolean).join('、') || '待定',
    fillPercent: course.capacity ? Math.min(100, Math.round((course.active_count || 0) / course.capacity * 100)) : 0,
  };
}

export function buildSchedule(items = []) {
  const periods = new Set();
  const cells = new Map();
  const list = [];
  items.forEach((course) => {
    const decorated = decorateCourse({ ...course, id: course.course_id });
    (course.schedules || []).forEach((slot) => {
      if (!slot.weekday || !slot.period) return;
      periods.add(slot.period);
      const cell = {
        ...decorated,
        course_id: course.course_id,
        weekday: slot.weekday,
        weekdayText: WEEK_DAYS[slot.weekday - 1] || `周${slot.weekday}`,
        period: slot.period,
        venue: slot.venue_name || '待定',
      };
      cells.set(`${slot.weekday}-${slot.period}`, cell);
      list.push(cell);
    });
  });
  const orderedPeriods = [...periods].sort((a, b) => a - b);
  return {
    periods: orderedPeriods,
    rows: orderedPeriods.map((period) => WEEK_DAYS.map((_, index) => cells.get(`${index + 1}-${period}`) || null)),
    list: list.sort((a, b) => (a.weekday - b.weekday) || (a.period - b.period)),
  };
}

export function makeIdempotencyKey(prefix = 'web') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function routeForSession(session) {
  if (!session) return '/login';
  if (session.must_change_password) return '/change-password';
  return ['STAFF', 'SUPER_ADMIN'].includes(session.user_type) ? '/admin' : '/courses';
}
