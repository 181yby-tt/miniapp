import { useEffect, useMemo, useState } from 'react';
import { createApiClient, createSessionStore, routeForSession } from '@kexu/client-core';
import AppShell from './components/AppShell.jsx';
import { LoginPage, ChangePasswordPage } from './pages/AuthPages.jsx';
import { CourseDetailPage, CoursesPage, EnrollmentsPage, ProfilePage, SchedulePage } from './pages/StudentPages.jsx';
import { AdminAccountsPage, AdminCoursesPage, AdminDashboardPage, AdminEnrollmentsPage, AdminResourcesPage, AdminSchedulePage, AdminSettingsPage, AdminStudentsPage } from './pages/AdminPages.jsx';
import { navigate, usePathname } from './runtime/browser.js';

const sessionStore = createSessionStore(window.localStorage);

export default function App() {
  const pathname = usePathname();
  const [session, setSession] = useState(() => sessionStore.get());
  const [profile, setProfile] = useState(null);
  const [notice, setNotice] = useState(null);
  const api = useMemo(() => createApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL || '',
    sessionStore,
    onUnauthorized: () => { sessionStore.clear(); setSession(null); setProfile(null); navigate('/login', { replace: true }); },
  }), []);
  const isAdmin = ['STAFF', 'SUPER_ADMIN'].includes(session?.user_type);

  let redirectPath = '';
  if (!session && pathname !== '/login') redirectPath = '/login';
  else if (session && pathname === '/login') redirectPath = routeForSession(session);
  else if (session?.must_change_password && pathname !== '/change-password') redirectPath = '/change-password';
  else if (session && !session.must_change_password && isAdmin && !pathname.startsWith('/admin') && pathname !== '/change-password') redirectPath = '/admin';
  else if (session && !session.must_change_password && pathname === '/admin/accounts' && session.user_type !== 'SUPER_ADMIN') redirectPath = '/admin';
  else if (session && !session.must_change_password && !isAdmin && pathname.startsWith('/admin')) redirectPath = '/courses';

  useEffect(() => {
    if (redirectPath) navigate(redirectPath, { replace: true });
  }, [redirectPath]);

  function toast(message, tone = 'success') {
    setNotice({ message, tone, id: Date.now() });
  }
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function logout() {
    if (!window.confirm('确定退出当前账号吗？')) return;
    sessionStore.clear(); setSession(null); setProfile(null); navigate('/login', { replace: true });
  }

  if (!session) {
    if (redirectPath) return null;
    return <><LoginPage api={api} sessionStore={sessionStore} onSession={(next) => { setProfile(null); setSession(next); }} />{notice ? <div className={`toast ${notice.tone}`}>{notice.message}</div> : null}</>;
  }

  if (redirectPath) return null;
  if (pathname === '/change-password') return <ChangePasswordPage api={api} session={session} sessionStore={sessionStore} onSession={setSession} toast={toast} />;

  let page;
  if (isAdmin) {
    if (pathname === '/admin/courses') page = <AdminCoursesPage api={api} toast={toast} />;
    else if (pathname === '/admin/schedule') page = <AdminSchedulePage api={api} toast={toast} />;
    else if (pathname === '/admin/students') page = <AdminStudentsPage api={api} toast={toast} />;
    else if (pathname === '/admin/resources') page = <AdminResourcesPage api={api} toast={toast} />;
    else if (pathname === '/admin/enrollments') page = <AdminEnrollmentsPage api={api} />;
    else if (pathname === '/admin/settings') page = <AdminSettingsPage api={api} toast={toast} />;
    else if (pathname === '/admin/accounts') page = <AdminAccountsPage api={api} toast={toast} />;
    else page = <AdminDashboardPage api={api} />;
  } else {
    const detailMatch = pathname.match(/^\/courses\/(\d+)$/);
    if (detailMatch) page = <CourseDetailPage api={api} courseId={detailMatch[1]} toast={toast} />;
    else if (pathname === '/enrollments') page = <EnrollmentsPage api={api} toast={toast} />;
    else if (pathname === '/schedule') page = <SchedulePage api={api} />;
    else if (pathname === '/profile') page = <ProfilePage api={api} profile={profile} setProfile={setProfile} onLogout={logout} />;
    else page = <CoursesPage api={api} toast={toast} />;
  }

  return <><AppShell session={session} pathname={pathname} profile={profile} onLogout={logout}>{page}</AppShell>{notice ? <div className={`toast ${notice.tone}`}>{notice.message}</div> : null}</>;
}
