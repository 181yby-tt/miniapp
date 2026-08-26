import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorState, Loading, Metric, PageHeader, StatusPill } from '../components/Common.jsx';
import CourseEditor from '../components/admin/CourseEditor.jsx';
import CourseImportPanel from '../components/admin/CourseImportPanel.jsx';
import StudentImportPanel from '../components/admin/StudentImportPanel.jsx';
import { formatDate } from '../runtime/browser.js';
import { buildEnrollmentSummarySheet, ENROLLMENT_SUMMARY_COLUMNS, localDateStamp, summarizeEnrollmentCourses } from '../utils/enrollmentSummaryExport.js';

const CONFIG_TEXT = {
  'student.max_active_courses': { group: '学生选课', label: '每个学生最多能选几门课？', help: '达到这个数量后，学生不能继续报名。', unit: '门' },
  'student.max_courses_per_category': { group: '学生选课', label: '同一类课程最多能选几门？', help: '例如体育类最多选 1 门；填写 0 表示不限制。', unit: '门' },
  'enrollment.allow_withdraw_after_start': { group: '退课处理', label: '课程开始后，学生还能自己退课吗？', help: '选择“不允许”后，只能由教务人员处理。' },
  'enrollment.allow_reenroll': { group: '退课处理', label: '学生退课后，还能重新报名同一门课吗？', help: '名额未满且没有时间冲突时才可重新报名。' },
  'security.password_min_length': { group: '账号安全', label: '学生密码至少多少位？', help: '建议保持 8 位或以上。', unit: '位' },
  'security.student_initial_password': { group: '账号安全', label: '学生统一初始密码是什么？', help: 'Excel 导入和手动添加都会使用它；学生首次登录必须修改。', input: 'text' },
  'security.login_max_failures': { group: '账号安全', label: '连续输错几次后锁定账号？', help: '用于阻止别人反复猜密码。', unit: '次' },
  'security.lock_minutes': { group: '账号安全', label: '输错密码后锁定多久？', help: '到时间后账号会自动恢复登录。', unit: '分钟' },
};
const AUDIT_TEXT = {
  CHANGE_PASSWORD: '修改密码', IMPORT_STUDENTS: '导入学生名单', CREATE_COURSE: '新建课程', UPDATE_COURSE: '修改课程与排课',
  COURSE_OPEN: '开放课程报名', COURSE_CLOSE: '暂停课程报名', COURSE_ARCHIVE: '移入历史课程', UPDATE_CONFIG: '修改选课规则', CREATE_BASE_DATA: '新增基础数据',
  ENROLL: '学生报名', WITHDRAW: '学生退课', STAFF_ENROLL: '教务代报名', STAFF_WITHDRAW: '教务代退课', CREATE_TEACHER_ACCOUNT: '新增教师账号', CREATE_ADMIN_ACCOUNT: '新增管理账号',
  CREATE_TEACHING_GROUP: '新建教学组', OPEN_PREFERENCES: '开放志愿填报', CLOSE_PREFERENCES: '停止志愿填报', SUBMIT_PREFERENCES: '提交志愿', SIMULATE_ALLOCATION: '运行模拟分配', PUBLISH_ALLOCATION: '发布分配结果',
};
const AUDIT_TARGET_TEXT = { course: '体育项目', student: '学生', students: '学生名单', system: '系统规则', staff: '教师', teacher_account: '教师账号', venues: '场地', categories: '项目分类', 'time-slots': '时间段', teaching_group: '教学组' };

function useAdminLoad(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try { setState({ loading: false, data: await loader(), error: '' }); }
    catch (error) { setState({ loading: false, data: null, error: error.message }); }
  };
  useEffect(() => { load(); }, dependencies);
  return [state, load];
}

export function AdminDashboardPage({ api }) {
  const [state, reload] = useAdminLoad(() => api.getAdminDashboard(), []);
  const data = state.data;
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  return <>
    <PageHeader eyebrow="选课排课" title="工作台" />
    <section className="metric-grid admin-metrics"><Metric value={data.students} label="学生人数" /><Metric value={data.teaching_groups} label="教学组" /><Metric value={data.open_preference_groups} label="正在填报" /><Metric value={data.preference_submissions} label="已交志愿" tone="accent" /></section>
    <div className="dashboard-grid"><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">志愿填报</p><h2>当前进度</h2></div></div><div className="signal-grid"><div><strong>{data.open_preference_groups}</strong><span>教学组正在填报</span></div><div><strong>{data.preference_submissions}</strong><span>学生已提交</span></div><div><strong>{data.published_groups}</strong><span>教学组已发布</span></div><div><strong>{data.teaching_groups - data.published_groups}</strong><span>教学组待完成</span></div></div></section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">需要处理</p><h2>教务提醒</h2></div></div><div className="signal-grid"><div><strong>{data.draft_courses}</strong><span>待完善项目</span></div><div><strong>{data.conflict_courses}</strong><span>排课冲突</span></div><div><strong>{data.students_need_pwd}</strong><span>学生尚未修改初始密码</span></div><div><strong>{data.open_preference_groups}</strong><span>填报中的教学组</span></div></div></section></div>
  </>;
}

export function AdminCoursesPage({ api, toast }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [editorCourse, setEditorCourse] = useState(undefined);
  const [state] = useAdminLoad(async () => {
    const [courses, meta] = await Promise.all([api.getAdminCourses(), api.getAdminMeta()]);
    return { courses: courses.items, meta };
  }, [refreshKey]);
  const items = useMemo(() => (state.data?.courses || []).filter((course) => (status === 'ALL' || course.status === status) && (category === 'ALL' || course.category === category) && `${course.name}${course.teachers?.join('')}`.toLowerCase().includes(query.toLowerCase())), [state.data, query, status, category]);
  const refresh = () => { setEditorCourse(undefined); setRefreshKey((key) => key + 1); };
  async function changeStatus(course, action) {
    const messages = {
      open: `确认启用“${course.name}”吗？\n\n启用后，这个项目可以加入教学组供学生填报志愿。`,
      close: `确认暂停使用“${course.name}”吗？\n\n暂停后，新教学组不能开放这个项目，已有资料和排课不会删除。`,
      archive: `确认把“${course.name}”移入历史课程吗？\n\n它将不再参与当前排课和报名，但课程资料、学生报名记录都会保留。`,
    };
    if (!window.confirm(messages[action])) return;
    const success = { open: '项目已启用', close: '项目已暂停', archive: '已移入历史项目' };
    try { await api.setCourseStatus(course.id, action); toast(success[action]); refresh(); }
    catch (error) { toast(error.message, 'error'); }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={refresh} />;
  return <>
    <PageHeader eyebrow="教务管理" title="体育项目" action={<button className="primary-action" onClick={() => setEditorCourse(null)}>新建体育项目</button>} />
    <details className="course-status-guide"><summary>项目状态说明</summary><span><b>待完善</b>：继续补充老师和排课；<b>项目启用</b>：可以加入教学组；<b>暂停使用</b>：暂不用于新教学组；<b>历史项目</b>：资料与历史结果继续保留。</span></details>
    <CourseImportPanel api={api} courses={state.data.courses} meta={state.data.meta} toast={toast} onImported={refresh} />
    <section className="toolbar-line admin-list-toolbar"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或任课教师" /></div><select className="admin-filter-select" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">全部分类</option>{state.data.meta.categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select><select className="admin-filter-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option><option value="OPEN">项目启用</option><option value="DRAFT">待完善</option><option value="CLOSED">暂停使用</option><option value="FINISHED">课程结束</option><option value="ARCHIVED">历史项目</option></select><span className="toolbar-count">{items.length} 个项目</span></section>
    {items.length ? <div className="admin-course-grid">{items.map((course) => <article className={`admin-course-card ${course.status === 'ARCHIVED' ? 'is-history' : ''}`} key={course.id}><div className="admin-course-top"><div><StatusPill status={course.status} /><h2>{course.name}</h2><p>任课教师：{course.teachers?.join('、') || '尚未安排'}</p><p>上课安排：{course.schedules?.map((item) => `${item.slot_name} · ${item.venue_name}`).join('；') || '尚未排课'}</p></div><strong>{course.active_count}<small> / {course.capacity} 人</small></strong></div><div className="seat-track"><i style={{ width: `${course.capacity ? Math.round(course.active_count / course.capacity * 100) : 0}%` }} /></div><div className="card-actions"><button className="course-edit-action" onClick={() => setEditorCourse(course)}>{course.status === 'ARCHIVED' ? '查看或修改资料' : '修改资料与排课'}</button>{['DRAFT', 'CLOSED'].includes(course.status) ? <button className="course-open-action" onClick={() => changeStatus(course, 'open')}>启用项目</button> : null}{course.status === 'OPEN' ? <button className="course-pause-action" onClick={() => changeStatus(course, 'close')}>暂停使用</button> : null}{['DRAFT', 'CLOSED', 'FINISHED'].includes(course.status) ? <button className="course-history-action" onClick={() => changeStatus(course, 'archive')}>移入历史项目</button> : null}{course.status === 'ARCHIVED' ? <span className="history-note">已退出当前教学组与排课</span> : null}</div></article>)}</div> : <Empty title="没有符合条件的体育项目" />}
    {editorCourse !== undefined ? <CourseEditor api={api} course={editorCourse} meta={state.data.meta} toast={toast} onClose={() => setEditorCourse(undefined)} onSaved={refresh} /> : null}
  </>;
}

export function AdminSchedulePage({ api, toast }) {
  const [state, reload] = useAdminLoad(async () => { const [courses, meta] = await Promise.all([api.getAdminCourses(), api.getAdminMeta()]); return { courses: courses.items, meta }; }, []);
  const [editorCourse, setEditorCourse] = useState(undefined);
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const weekdays = [...new Set(state.data.meta.time_slots.map((slot) => Number(slot.weekday)))].sort((a, b) => a - b);
  const periods = [...new Set(state.data.meta.time_slots.map((slot) => slot.period))].sort((a, b) => a - b);
  const byCell = (weekday, period) => state.data.courses.filter((course) => !['ARCHIVED', 'FINISHED'].includes(course.status) && course.schedules?.some((item) => Number(item.weekday) === weekday && Number(item.period) === period));
  const venueFamily = (venueId) => {
    const family = new Set(); const queue = [Number(venueId)];
    while (queue.length) {
      const current = queue.shift();
      if (!current || family.has(current)) continue;
      family.add(current);
      const venue = state.data.meta.venues.find((item) => item.id === current);
      if (venue?.parent_id) queue.push(Number(venue.parent_id));
      state.data.meta.venues.forEach((item) => { if (Number(item.parent_id) === current) queue.push(Number(item.id)); });
    }
    return family;
  };
  const hasConflict = (courses, weekday, period) => courses.some((course, index) => courses.slice(index + 1).some((other) => {
    const sharedTeacher = course.teacher_ids.some((id) => other.teacher_ids.includes(id));
    const venues = course.schedules.filter((item) => Number(item.weekday) === weekday && Number(item.period) === period).map((item) => item.venue_id);
    const otherVenues = other.schedules.filter((item) => Number(item.weekday) === weekday && Number(item.period) === period).map((item) => item.venue_id);
    return sharedTeacher || venues.some((id) => otherVenues.some((otherId) => [...venueFamily(id)].some((familyId) => venueFamily(otherId).has(familyId))));
  }));
  const activeCourses = state.data.courses.filter((course) => !['ARCHIVED', 'FINISHED'].includes(course.status));
  const unscheduled = activeCourses.filter((course) => !course.teacher_ids.length || !course.schedules.length);
  let conflictCells = 0;
  periods.forEach((period) => weekdays.forEach((weekday) => { if (hasConflict(byCell(weekday, period), weekday, period)) conflictCells += 1; }));
  return <>
    <PageHeader eyebrow="全校课表" title="排课" />
    <section className={`schedule-summary ${conflictCells ? 'has-conflict' : ''}`}><div><strong>{activeCourses.length - unscheduled.length}</strong><span>门课程已完成排课</span></div><div><strong>{unscheduled.length}</strong><span>门课程待安排</span></div><div><strong>{conflictCells}</strong><span>{conflictCells ? '个冲突时间格，需要处理' : '个冲突，当前排课正常'}</span></div></section>
    {unscheduled.length ? <section className="unscheduled-courses"><strong>待完成排课</strong><div>{unscheduled.map((course) => <button key={course.id} onClick={() => setEditorCourse(course)}>{course.name}<span>{!course.teacher_ids.length ? '缺少任课教师' : '缺少上课时间或场地'}</span></button>)}</div></section> : null}
    <div className="schedule-legend"><span><i className="normal" />正常排课</span><span><i className="conflict" />教师或场地冲突</span><small>整馆与其分区在同一时间也会视为场地冲突</small></div>
    <div className="admin-schedule" style={{ gridTemplateColumns: `90px repeat(${weekdays.length}, minmax(180px, 1fr))` }}><div className="schedule-corner">节次</div>{weekdays.map((weekday) => <div className="schedule-column-head" key={weekday}>{dayNames[weekday]}</div>)}{periods.map((period) => [<div className="schedule-period" key={`p-${period}`}>第 {period} 节</div>, ...weekdays.map((weekday) => { const courses = byCell(weekday, period); const conflicting = hasConflict(courses, weekday, period); return <div className={`admin-schedule-cell ${conflicting ? 'busy' : ''}`} key={`${weekday}-${period}`}>{conflicting ? <span className="cell-conflict-label">排课冲突</span> : null}{courses.map((course) => { const schedules = course.schedules.filter((item) => Number(item.weekday) === weekday && Number(item.period) === period); return <button key={course.id} title="点击修改这门课程的排课" onClick={() => setEditorCourse(course)}><strong>{course.name}</strong><span>教师：{course.teachers.join('、') || '待安排'}</span><span>场地：{schedules.map((item) => item.venue_name).join('、')}</span><small>点击修改排课</small></button>; })}</div>; })])}</div>
    {editorCourse !== undefined ? <CourseEditor api={api} course={editorCourse} meta={state.data.meta} toast={toast} onClose={() => setEditorCourse(undefined)} onSaved={() => { setEditorCourse(undefined); reload(); }} /> : null}
  </>;
}

export function AdminStudentsPage({ api, toast }) {
  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState('ALL');
  const [className, setClassName] = useState('ALL');
  const [state, reload] = useAdminLoad(() => api.getAdminStudents(), []);
  const source = state.data?.items || [];
  const grades = [...new Set(source.map((item) => item.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const classes = [...new Set(source.filter((item) => grade === 'ALL' || item.grade === grade).map((item) => item.class_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const items = source.filter((item) => (grade === 'ALL' || item.grade === grade) && (className === 'ALL' || item.class_name === className) && `${item.student_no}${item.name}${item.grade}${item.class_name}`.includes(query.trim()));
  const changeGrade = (value) => { setGrade(value); setClassName('ALL'); };
  return <>
    <PageHeader eyebrow="教务管理" title="学生" />
    <StudentImportPanel api={api} toast={toast} onImported={reload} />
    <div className="toolbar-line admin-list-toolbar"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号或姓名" /></div><select className="admin-filter-select" value={grade} onChange={(event) => changeGrade(event.target.value)}><option value="ALL">全部年级</option>{grades.map((item) => <option key={item} value={item}>{item}</option>)}</select><select className="admin-filter-select" value={className} onChange={(event) => setClassName(event.target.value)}><option value="ALL">全部班级</option>{classes.map((item) => <option key={item} value={item}>{item}</option>)}</select><span className="toolbar-count">{items.length} 名学生</span></div>
    {state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : items.length ? <div className="responsive-table"><div className="table-row table-head"><span>姓名与登录账号</span><span>年级班级</span><span>已选课程</span><span>账号状态</span></div>{items.map((student) => <div className="table-row" key={student.id}><span><strong>{student.name}</strong><small>登录账号：{student.student_no}</small></span><span>{student.grade} · {student.class_name}</span><span>{student.enrolled_count} 门</span><span><StatusPill status={student.account_status} /></span></div>)}</div> : <Empty title="没有符合条件的学生" />}
  </>;
}

export function AdminAccountsPage({ api, toast }) {
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'STAFF', require_password_change: true });
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [state, reload] = useAdminLoad(() => api.getAdminAccounts(), []);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function create(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.createAdminAccount(form);
      setForm({ username: '', name: '', password: '', role: 'STAFF', require_password_change: true });
      toast(`${form.role === 'SUPER_ADMIN' ? '超级管理员' : '老师'}账号已创建`);
      reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  const accounts = (state.data?.items || []).filter((account) => (role === 'ALL' || account.role === role) && (status === 'ALL' || account.status === status) && `${account.name}${account.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageHeader eyebrow="仅超级管理员可见" title="账号管理" />
    <details className="teacher-account-tools"><summary><span><strong>新增账号</strong><small>可创建老师或超级管理员</small></span><b>展开</b></summary><form className="teacher-account-form" onSubmit={create}>
      <label><span>登录账号</span><input value={form.username} onChange={update('username')} placeholder="例如：zhanglaoshi" autoComplete="off" /></label>
      <label><span>姓名</span><input value={form.name} onChange={update('name')} placeholder="例如：张老师" autoComplete="off" /></label>
      <label><span>账号角色</span><select value={form.role} onChange={update('role')}><option value="STAFF">老师</option><option value="SUPER_ADMIN">超级管理员</option></select></label>
      <label><span>初始密码</span><input type="password" value={form.password} onChange={update('password')} placeholder="至少 8 位" autoComplete="new-password" /></label>
      <label className="account-password-option"><input type="checkbox" checked={form.require_password_change} onChange={(event) => setForm((current) => ({ ...current, require_password_change: event.target.checked }))} /><span>首次登录后要求修改密码</span></label>
      <button className="primary-button" disabled={saving || !form.username.trim() || !form.name.trim() || form.password.length < 8}>{saving ? '正在创建…' : '创建账号'}</button>
    </form></details>
    <div className="toolbar-line admin-list-toolbar"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></div><select className="admin-filter-select" value={role} onChange={(event) => setRole(event.target.value)}><option value="ALL">全部角色</option><option value="SUPER_ADMIN">超级管理员</option><option value="STAFF">老师</option></select><select className="admin-filter-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option><option value="ACTIVE">正常</option><option value="DISABLED">停用</option></select><span className="toolbar-count">{accounts.length} 个账号</span></div>
    {state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : accounts.length ? <div className="responsive-table account-table"><div className="table-row table-head"><span>姓名与账号</span><span>角色</span><span>状态</span><span>首次改密</span></div>{accounts.map((account) => <div className="table-row" key={account.id}><span><strong>{account.name}</strong><small>登录账号：{account.username}{account.current ? ' · 当前账号' : ''}</small></span><span>{account.role === 'SUPER_ADMIN' ? '超级管理员' : '老师'}</span><span><StatusPill status={account.status} /></span><span>{account.must_change_password ? '登录后需要修改' : '已完成'}</span></div>)}</div> : <Empty title="没有符合条件的账号" />}
  </>;
}

export function AdminResourcesPage({ api, toast }) {
  const [state, reload] = useAdminLoad(() => api.getAdminMeta(), []);
  const [activeType, setActiveType] = useState('staff');
  const [query, setQuery] = useState('');
  const [weekdayFilter, setWeekdayFilter] = useState('');
  const [draft, setDraft] = useState({ staff: '', venues: '', categories: '', slot_name: '', weekday: 1, period: 1 });
  async function add(type, payload, clearKey) { try { await api.createAdminMeta(type, payload); toast('基础数据已添加'); setDraft((current) => ({ ...current, [clearKey]: '' })); reload(); } catch (error) { toast(error.message, 'error'); } }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  const definitions = {
    staff: { label: '任课教师', singular: '教师', items: state.data.staff, placeholder: '输入教师姓名', add: () => add('staff', { name: draft.staff }, 'staff') },
    venues: { label: '上课场地', singular: '场地', items: state.data.venues, placeholder: '输入教室或场地名称', add: () => add('venues', { name: draft.venues }, 'venues') },
    categories: { label: '课程分类', singular: '分类', items: state.data.categories, placeholder: '输入课程分类名称', add: () => add('categories', { name: draft.categories }, 'categories') },
    time_slots: { label: '上课时间', singular: '时间段', items: state.data.time_slots },
  };
  const current = definitions[activeType];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = current.items.filter((item) => {
    if (activeType === 'time_slots' && weekdayFilter && Number(item.weekday) !== Number(weekdayFilter)) return false;
    return !normalizedQuery || `${item.name}${item.staff_no || ''}`.toLowerCase().includes(normalizedQuery);
  }).sort((a, b) => activeType === 'time_slots' ? Number(a.weekday) - Number(b.weekday) || Number(a.period) - Number(b.period) : String(a.name).localeCompare(String(b.name), 'zh-CN'));
  const switchType = (type) => { setActiveType(type); setQuery(''); setWeekdayFilter(''); };
  return <>
    <PageHeader eyebrow="系统设置" title="排课设置" />
    <nav className="resource-tabs" aria-label="排课设置分类">{Object.entries(definitions).map(([key, item]) => <button key={key} className={activeType === key ? 'active' : ''} onClick={() => switchType(key)}><strong>{item.label}</strong><span>{item.items.length}</span></button>)}</nav>
    <section className="paper-card resource-manager">
      <div className="resource-manager-head"><div><h2>{current.label}</h2><span>共 {current.items.length} 项</span></div><div className="resource-filters"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${current.singular}`} /></div>{activeType === 'time_slots' ? <select value={weekdayFilter} onChange={(event) => setWeekdayFilter(event.target.value)}><option value="">全部星期</option>{['一', '二', '三', '四', '五', '六', '日'].map((day, index) => <option key={day} value={index + 1}>周{day}</option>)}</select> : null}</div></div>
      {activeType === 'time_slots' ? <div className="resource-create slot-create"><input value={draft.slot_name} onChange={(event) => setDraft((value) => ({ ...value, slot_name: event.target.value }))} placeholder="名称，例如：周一第 9 节" /><select value={draft.weekday} onChange={(event) => setDraft((value) => ({ ...value, weekday: Number(event.target.value) }))}>{['一', '二', '三', '四', '五', '六', '日'].map((day, index) => <option key={day} value={index + 1}>周{day}</option>)}</select><label><span>第</span><input type="number" min="1" max="20" value={draft.period} onChange={(event) => setDraft((value) => ({ ...value, period: Number(event.target.value) }))} /><span>节</span></label><button onClick={() => add('time-slots', { name: draft.slot_name, weekday: draft.weekday, period: draft.period }, 'slot_name')} disabled={!draft.slot_name.trim()}>添加时间段</button></div> : <div className="resource-create inline-create"><input value={draft[activeType]} onChange={(event) => setDraft((value) => ({ ...value, [activeType]: event.target.value }))} placeholder={current.placeholder} /><button onClick={current.add} disabled={!draft[activeType].trim()}>添加{current.singular}</button></div>}
      {visibleItems.length ? <div className={`resource-list resource-list-managed ${activeType === 'time_slots' ? 'is-slots' : ''}`}>{visibleItems.map((item) => <span key={item.id}><strong>{item.name}</strong>{item.staff_no ? <small>{item.staff_no}</small> : null}{activeType === 'time_slots' ? <small>周{['一', '二', '三', '四', '五', '六', '日'][Number(item.weekday) - 1]} · 第 {item.period} 节</small> : null}</span>)}</div> : <Empty title={`没有符合条件的${current.singular}`} />}
    </section>
  </>;
}

export function AdminEnrollmentsPage({ api, toast }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('ALL');
  const [state, reload] = useAdminLoad(() => api.getAdminEnrollments({ query, status }), [query, status]);
  const [reportState] = useAdminLoad(() => api.getAdminCourses(), []);
  const reportCourses = reportState.data?.items || [];
  const summary = summarizeEnrollmentCourses(reportCourses);
  async function downloadReport() {
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser');
      await writeExcelFile(buildEnrollmentSummarySheet(reportCourses), {
        columns: ENROLLMENT_SUMMARY_COLUMNS,
        sheet: '报课人数',
        stickyRowsCount: 4,
        orientation: 'landscape',
      }).toFile(`课程报课人数统计_${localDateStamp()}.xlsx`);
      toast('报课人数表已生成');
    } catch (error) { toast(error.message || '报课人数表生成失败', 'error'); }
  }
  return <><PageHeader eyebrow="学生报名和退课记录" title="报名管理" description="按学生、学号或课程查询报名结果，也可以一键生成全校课程报课人数统计表。" action={<button className="primary-action export-action" disabled={reportState.loading || Boolean(reportState.error)} onClick={downloadReport}><span aria-hidden="true">↓</span>{reportState.loading ? '正在准备数据' : '导出报课人数表'}</button>} />{reportState.error ? <div className="inline-alert">统计数据暂时无法读取：{reportState.error}</div> : <section className="metric-grid compact-metrics report-metrics"><Metric value={summary.courseCount} label="统计课程" /><Metric value={summary.totalEnrolled} label="已报名人次" /><Metric value={summary.remaining} label="剩余名额" tone="accent" /></section>}<section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名或课程" /></div><div className="chip-row inline">{['ALL', 'ENROLLED', 'WITHDRAWN', 'CANCELLED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部记录' : <StatusPill status={item} />}</button>)}</div></section>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : state.data.items.length ? <div className="responsive-table enrollment-table"><div className="table-row table-head"><span>课程</span><span>学生</span><span>状态</span><span>操作来源</span><span>时间</span></div>{state.data.items.map((item) => <div className="table-row" key={item.enrollment_id}><span><strong>{item.course_name}</strong></span><span>{item.student_name}<small>{item.student_no}</small></span><span><StatusPill status={item.status} /></span><span>{item.source === 'STUDENT' ? '学生自行操作' : '教务人员操作'}</span><span>{formatDate(item.enrolled_at)}</span></div>)}</div> : <Empty title="暂无报名记录" description="学生报名后，详细记录会显示在这里；课程人数统计表仍可直接导出。" />}</>;
}

export function AdminSettingsPage({ api, toast }) {
  const [state, reload] = useAdminLoad(async () => { const [configs, audit] = await Promise.all([api.getAdminConfigs(), api.getAdminAudit()]); return { configs: configs.items, audit: audit.items }; }, []);
  const [draft, setDraft] = useState([]);
  useEffect(() => { if (state.data?.configs) setDraft(state.data.configs); }, [state.data]);
  async function save() { try { await api.updateAdminConfigs(draft.map(({ key, value }) => ({ key, value }))); toast('选课规则已保存'); reload(); } catch (error) { toast(error.message, 'error'); } }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  const ruleGroups = ['账号安全'];
  return <><PageHeader eyebrow="系统规则" title="账号安全与操作记录" description="志愿数量、教学组班级和是否允许调剂，都在“教学组与分配”中逐组设置。" /><div className="rule-summary"><strong>志愿分配规则</strong><span>系统按第一、第二、第三志愿依次分配；超额项目使用可复现随机抽取，发布前可以反复模拟核对。</span></div><div className="settings-grid"><section className="paper-card rules-card"><div className="card-title"><div><p className="eyebrow ink">学生登录设置</p><h2>账号安全</h2></div><button className="primary-compact" onClick={save}>保存修改</button></div>{ruleGroups.map((group) => <section className="rule-group" key={group}><div className="config-list">{draft.map((item, index) => ({ item, index, text: CONFIG_TEXT[item.key] })).filter((entry) => entry.text?.group === group).map(({ item, index, text }) => <label key={item.key}><span><strong>{text.label}</strong><small>{text.help}</small></span><span className="rule-control">{item.type === 'bool' ? <select value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))}><option value="true">允许</option><option value="false">不允许</option></select> : <input type={text.input || 'number'} min={text.input ? undefined : '0'} value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} />}{text.unit ? <small>{text.unit}</small> : null}</span></label>)}</div></section>)}</section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">谁在什么时候做了什么</p><h2>最近操作</h2></div><span>最近 100 条</span></div><div className="audit-list readable-audit">{state.data.audit.length ? state.data.audit.map((item) => <div key={item.id}><span><strong><b>{item.actor_name || '系统'}</b> · {AUDIT_TEXT[item.action] || '进行了系统操作'}</strong><small>{item.target_name ? `${AUDIT_TARGET_TEXT[item.target_type] || '对象'}：${item.target_name}` : AUDIT_TARGET_TEXT[item.target_type] || '系统记录'}</small></span><time>{formatDate(item.created_at)}</time></div>) : <Empty title="暂无操作记录" />}</div></section></div></>;
}
