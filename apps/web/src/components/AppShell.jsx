import { navigate } from '../runtime/browser.js';

const studentItems = [
  ['/courses', '课程', '课'], ['/enrollments', '我的课程', '选'], ['/schedule', '课表', '表'], ['/profile', '我的', '我'],
];
const adminItems = [
  ['/admin', '总览', '览'], ['/admin/courses', '课程管理', '课'], ['/admin/students', '学生', '生'], ['/admin/enrollments', '报名记录', '录'], ['/admin/settings', '规则与日志', '规'],
];

export default function AppShell({ session, pathname, profile, onLogout, children }) {
  const isAdmin = ['STAFF', 'SUPER_ADMIN'].includes(session.user_type);
  const items = isAdmin ? adminItems : studentItems;
  const isActive = (path) => path === '/admin' ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  return (
    <div className={`product-shell ${isAdmin ? 'admin-mode' : ''}`}>
      <aside className="side-rail">
        <button className="logo-button" onClick={() => navigate(isAdmin ? '/admin' : '/courses')} aria-label="返回首页">课</button>
        <div className="rail-brand"><strong>课序</strong><span>{isAdmin ? '教务管理端' : '校本选课平台'}</span></div>
        <nav className="primary-nav" aria-label="主导航">
          {items.map(([path, label, mark]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => navigate(path)}><span>{mark}</span>{label}</button>)}
        </nav>
        <div className="rail-account">
          <span className="account-avatar">{(profile?.name || session.username || '我').slice(0, 1)}</span>
          <div><strong>{profile?.name || session.username}</strong><small>{isAdmin ? '教务管理员' : profile?.class_name || '学生'}</small></div>
          <button className="logout-icon" onClick={onLogout} title="退出登录">退出</button>
        </div>
      </aside>
      <div className="content-column"><main className="page-content">{children}</main></div>
      <nav className="mobile-nav" aria-label="移动端导航">
        {items.slice(0, 5).map(([path, label, mark]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => navigate(path)}><span>{mark}</span><small>{label}</small></button>)}
      </nav>
    </div>
  );
}
