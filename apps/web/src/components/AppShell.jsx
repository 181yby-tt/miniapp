import { navigate } from '../runtime/browser.js';
import { accountNameForSession, canManageTeacherAccounts } from '../runtime/account.js';

const studentItems = [
  ['/courses', '课程', '课'], ['/enrollments', '我的课程', '选'], ['/schedule', '课表', '表'], ['/profile', '我的', '我'],
];
const adminItems = [
  ['/admin', '工作台', '首'], ['/admin/students', '学生管理', '生'], ['/admin/courses', '课程管理', '课'], ['/admin/schedule', '排课管理', '排'], ['/admin/resources', '基础数据', '基'], ['/admin/enrollments', '报名管理', '报'], ['/admin/settings', '规则与记录', '规'],
];

export default function AppShell({ session, pathname, profile, onLogout, children }) {
  const isAdmin = ['STAFF', 'SUPER_ADMIN'].includes(session.user_type);
  const items = isAdmin ? [...adminItems, ...(canManageTeacherAccounts(session) ? [['/admin/accounts', '教师账号', '管']] : [])] : studentItems;
  const accountName = accountNameForSession(session, profile);
  const isActive = (path) => path === '/admin' ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  return (
    <div className={`product-shell ${isAdmin ? 'admin-mode' : 'student-mode'}`}>
      <aside className="side-rail">
        <button className="logo-button" onClick={() => navigate(isAdmin ? '/admin' : '/courses')} aria-label="返回首页">{isAdmin ? '教' : '课'}</button>
        <div className="rail-brand"><strong>选课排课</strong><span>{isAdmin ? '教务管理后台' : '学生选课中心'}</span></div>
        <div className="role-chip">{isAdmin ? '管理端' : '学生端'}</div>
        <nav className="primary-nav" aria-label="主导航">
          {items.map(([path, label, mark]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => navigate(path)}><span>{mark}</span>{label}</button>)}
        </nav>
        <div className="rail-account">
          <span className="account-avatar">{(accountName || '我').slice(0, 1)}</span>
          <div><strong>{accountName}</strong><small>{isAdmin ? '教务管理员' : profile?.class_name || '学生'}</small></div>
          <button className="logout-icon" onClick={onLogout} title="退出登录">退出</button>
        </div>
      </aside>
      <div className="content-column"><main className="page-content">{children}</main></div>
      <nav className="mobile-nav" aria-label="移动端导航" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(64px, 1fr))` }}>
        {items.map(([path, label, mark]) => <button key={path} className={isActive(path) ? 'active' : ''} onClick={() => navigate(path)}><span>{mark}</span><small>{label}</small></button>)}
      </nav>
    </div>
  );
}
