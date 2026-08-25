import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, createApiClient, createSessionStore, decorateCourse, routeForSession } from '../src/index.js';

test('session store tolerates invalid persisted data', () => {
  const memory = new Map([['kexu_session', '{bad']]);
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  const store = createSessionStore(storage);
  assert.equal(store.get(), null);
  store.set({ token: 't' });
  assert.equal(store.getToken(), 't');
  store.clear();
  assert.equal(store.getToken(), '');
});

test('API client sends bearer token and unwraps data', async () => {
  let request;
  const api = createApiClient({
    baseUrl: 'https://example.com/',
    sessionStore: { getToken: () => 'token' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ code: 'OK', data: { token: 'next' } }) };
    },
  });
  assert.deepEqual(await api.login('20260108', 'secret'), { token: 'next' });
  assert.equal(request.url, 'https://example.com/api/auth/login');
  assert.equal(request.options.headers.Authorization, 'Bearer token');
  assert.equal(request.options.body, JSON.stringify({ username: '20260108', password: 'secret' }));
});

test('course and schedule view models are platform neutral', () => {
  const course = decorateCourse({ id: 1, name: '机器人', capacity: 20, active_count: 5, teachers: ['陈老师'], schedules: [{ slot_name: '周一第3节', venue_name: '创客室' }] });
  assert.equal(course.mark, '机');
  assert.equal(course.fillPercent, 25);
  const schedule = buildSchedule([{ course_id: 1, name: '机器人', teachers: ['陈老师'], schedules: [{ weekday: 1, period: 3, venue_name: '创客室' }] }]);
  assert.deepEqual(schedule.periods, [3]);
  assert.equal(schedule.rows[0][0].name, '机器人');
  assert.equal(schedule.rows[0][1], null);
});

test('session role selects the correct application area', () => {
  assert.equal(routeForSession(null), '/login');
  assert.equal(routeForSession({ must_change_password: true, user_type: 'STUDENT' }), '/change-password');
  assert.equal(routeForSession({ user_type: 'STUDENT' }), '/courses');
  assert.equal(routeForSession({ user_type: 'SUPER_ADMIN' }), '/admin');
});
