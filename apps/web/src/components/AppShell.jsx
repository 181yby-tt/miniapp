import { useState } from 'react';
import { navigate } from '../runtime/browser.js';
import { accountNameForSession, canManageTeacherAccounts } from '../runtime/account.js';

const studentItems = [
  ['/courses', '填报志愿', 'courses'], ['/enrollments', '分配结果', 'check'], ['/schedule', '课表', 'calendar'], ['/profile', '我的', 'user'],
];
const adminDailyItems = [
  ['/admin', '工作台', 'dashboard'], ['/admin/students', '学生管理', 'users'], ['/admin/courses', '项目管理', 'courses'], ['/admin/groups', '教学组与分配', 'clipboard'], ['/admin/schedule', '排课管理', 'calendar'],
];
const adminSystemItems = [
  ['/admin/resources', '排课设置', 'database'], ['/admin/settings', '规则与记录', 'settings'],
];

const iconPaths = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  courses: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.4.3.7.6 1 .3.2.7.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16.5 9" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0M18 3v4M16 5h4" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
};

function NavIcon({ name }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name] || iconPaths.dashboard}</svg>;
}

export default function AppShell({ session, pathname, profile, onLogout, children }) {
  const isAdmin = ['STAFF', 'SUPER_ADMIN'].includes(session.user_type);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const systemItems = isAdmin ? [...adminSystemItems, ...(canManageTeacherAccounts(session) ? [['/admin/accounts', '账号管理', 'account']] : [])] : [];
  const items = isAdmin ? [...adminDailyItems, ...systemItems] : studentItems;
  const mobilePrimaryItems = isAdmin ? adminDailyItems.slice(0, 4) : studentItems;
  const mobileMoreItems = isAdmin ? [...adminDailyItems.slice(4), ...systemItems] : [];
  const accountName = accountNameForSession(session, profile);
  const isActive = (path) => path === '/admin' ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  const go = (path) => { setMobileMenuOpen(false); navigate(path); };
  const navButton = ([path, label, icon]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => go(path)}><span><NavIcon name={icon} /></span>{label}</button>;
  return (
    <div className={`product-shell ${isAdmin ? 'admin-mode' : 'student-mode'}`}>
      <aside className="side-rail">
        <button className="logo-button" onClick={() => navigate(isAdmin ? '/admin' : '/courses')} aria-label="返回首页">{isAdmin ? '教' : '课'}</button>
        <div className="rail-brand"><strong>选课排课</strong><span>{isAdmin ? '教务管理后台' : '学生选课中心'}</span></div>
        <div className="role-chip">{isAdmin ? '管理端' : '学生端'}</div>
        <nav className="primary-nav" aria-label="主导航">
          {isAdmin ? <><p className="nav-group-label">日常教务</p>{adminDailyItems.map(navButton)}<p className="nav-group-label">系统设置</p>{systemItems.map(navButton)}</> : items.map(navButton)}
        </nav>
        <div className="rail-account">
          <span className="account-avatar">{(accountName || '我').slice(0, 1)}</span>
          <div><strong>{accountName}</strong><small>{isAdmin ? '教务管理员' : profile?.class_name || '学生'}</small></div>
          <button className="logout-icon" onClick={onLogout} title="退出登录">退出</button>
        </div>
      </aside>
      <div className="content-column"><main className="page-content">{children}</main></div>
      <nav className="mobile-nav" aria-label="移动端导航" style={{ gridTemplateColumns: `repeat(${mobilePrimaryItems.length + (isAdmin ? 1 : 0)}, minmax(0, 1fr))` }}>
        {mobilePrimaryItems.map(([path, label, icon]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => go(path)}><span><NavIcon name={icon} /></span><small>{label}</small></button>)}
        {isAdmin ? <button className={mobileMoreItems.some(([path]) => isActive(path)) || mobileMenuOpen ? 'active' : ''} onClick={() => setMobileMenuOpen(true)}><span><NavIcon name="more" /></span><small>更多</small></button> : null}
      </nav>
      {mobileMenuOpen ? <div className="mobile-more-backdrop" role="presentation" onClick={() => setMobileMenuOpen(false)}><section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="更多管理功能" onClick={(event) => event.stopPropagation()}><header><strong>更多管理</strong><button onClick={() => setMobileMenuOpen(false)}>完成</button></header><div>{mobileMoreItems.map(([path, label, icon]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => go(path)}><span><NavIcon name={icon} /></span><strong>{label}</strong><small>›</small></button>)}</div><footer className="mobile-more-account"><span className="account-avatar">{(accountName || '我').slice(0, 1)}</span><div><strong>{accountName}</strong><small>{session.user_type === 'SUPER_ADMIN' ? '超级管理员' : '老师'}</small></div><button onClick={onLogout}>退出登录</button></footer></section></div> : null}
    </div>
  );
}
