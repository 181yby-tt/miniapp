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
  ENROLL: '学生报名', WITHDRAW: '学生退课', STAFF_ENROLL: '教务代报名', STAFF_WITHDRAW: '教务代退课', CREATE_TEACHER_ACCOUNT: '新增教师账号',
};
const AUDIT_TARGET_TEXT = { course: '课程', student: '学生', students: '学生名单', system: '系统规则', staff: '教师', teacher_account: '教师账号', venues: '场地', categories: '课程分类', 'time-slots': '时间段' };

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
    <section className="metric-grid admin-metrics"><Metric value={data.students} label="学生人数" /><Metric value={data.total_courses} label="课程总数" /><Metric value={data.open_courses} label="正在报名" /><Metric value={data.conflict_courses} label="存在排课冲突" tone="accent" /></section>
    <div className="dashboard-grid"><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">报名情况</p><h2>热门课程</h2></div><span>剩余 {data.remaining_seats} 个名额</span></div>{data.top_fill_courses?.length ? data.top_fill_courses.map((course) => <div className="fill-row" key={course.id}><div><strong>{course.name}</strong><span>{course.active_count}/{course.capacity}</span></div><div className="seat-track"><i style={{ width: `${course.fill}%` }} /></div></div>) : <Empty title="还没有开放报名的课程" />}</section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">需要处理</p><h2>教务提醒</h2></div></div><div className="signal-grid"><div><strong>{data.draft_courses}</strong><span>草稿课程</span></div><div><strong>{data.conflict_courses}</strong><span>排课冲突</span></div><div><strong>{data.students_need_pwd}</strong><span>学生尚未修改初始密码</span></div><div><strong>{data.full_courses}</strong><span>课程已满</span></div></div></section></div>
  </>;
}

export function AdminCoursesPage({ api, toast }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [editorCourse, setEditorCourse] = useState(undefined);
  const [state] = useAdminLoad(async () => {
    const [courses, meta] = await Promise.all([api.getAdminCourses(), api.getAdminMeta()]);
    return { courses: courses.items, meta };
  }, [refreshKey]);
  const items = useMemo(() => (state.data?.courses || []).filter((course) => (status === 'ALL' || course.status === status) && `${course.name}${course.teachers?.join('')}`.toLowerCase().includes(query.toLowerCase())), [state.data, query, status]);
  const refresh = () => { setEditorCourse(undefined); setRefreshKey((key) => key + 1); };
  async function changeStatus(course, action) {
    const messages = {
      open: `确认开放“${course.name}”的学生报名吗？\n\n开放后，符合范围的学生可以立即看到并报名这门课。`,
      close: `确认暂停“${course.name}”的学生报名吗？\n\n学生将不能继续报名，已有报名和排课不会被删除，之后可以重新开放。`,
      archive: `确认把“${course.name}”移入历史课程吗？\n\n它将不再参与当前排课和报名，但课程资料、学生报名记录都会保留。`,
    };
    if (!window.confirm(messages[action])) return;
    const success = { open: '已开放学生报名', close: '已暂停学生报名', archive: '已移入历史课程' };
    try { await api.setCourseStatus(course.id, action); toast(success[action]); refresh(); }
    catch (error) { toast(error.message, 'error'); }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={refresh} />;
  return <>
    <PageHeader eyebrow="教务管理" title="课程" action={<button className="primary-action" onClick={() => setEditorCourse(null)}>新建课程</button>} />
    <details className="course-status-guide"><summary>课程状态说明</summary><span><b>尚未开放</b>：学生不可见；<b>开放报名</b>：学生可报名；<b>暂停报名</b>：停止新增报名；<b>历史课程</b>：退出当前排课，资料与记录保留。</span></details>
    <CourseImportPanel api={api} courses={state.data.courses} meta={state.data.meta} toast={toast} onImported={refresh} />
    <section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程或任课教师" /></div><div className="chip-row inline">{['ALL', 'OPEN', 'DRAFT', 'CLOSED', 'FINISHED', 'ARCHIVED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部课程' : <StatusPill status={item} />}</button>)}</div></section>
    {items.length ? <div className="admin-course-grid">{items.map((course) => <article className={`admin-course-card ${course.status === 'ARCHIVED' ? 'is-history' : ''}`} key={course.id}><div className="admin-course-top"><div><StatusPill status={course.status} /><h2>{course.name}</h2><p>任课教师：{course.teachers?.join('、') || '尚未安排'}</p><p>上课安排：{course.schedules?.map((item) => `${item.slot_name} · ${item.venue_name}`).join('；') || '尚未排课'}</p></div><strong>{course.active_count}<small> / {course.capacity} 人</small></strong></div><div className="seat-track"><i style={{ width: `${course.capacity ? Math.round(course.active_count / course.capacity * 100) : 0}%` }} /></div><div className="card-actions"><button className="course-edit-action" onClick={() => setEditorCourse(course)}>{course.status === 'ARCHIVED' ? '查看或修改资料' : '修改资料与排课'}</button>{['DRAFT', 'CLOSED'].includes(course.status) ? <button className="course-open-action" onClick={() => changeStatus(course, 'open')}>开放学生报名</button> : null}{course.status === 'OPEN' ? <button className="course-pause-action" onClick={() => changeStatus(course, 'close')}>暂停学生报名</button> : null}{['DRAFT', 'CLOSED', 'FINISHED'].includes(course.status) ? <button className="course-history-action" onClick={() => changeStatus(course, 'archive')}>移入历史课程</button> : null}{course.status === 'ARCHIVED' ? <span className="history-note">已退出当前排课与报名</span> : null}</div></article>)}</div> : <Empty title="没有符合条件的课程" />}
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
  const [state, reload] = useAdminLoad(() => api.getAdminStudents(), []);
  const items = (state.data?.items || []).filter((item) => `${item.student_no}${item.name}${item.grade}${item.class_name}`.includes(query));
  return <><PageHeader eyebrow="学生资料、账号与班级" title="学生管理" description="可手动添加单个学生，也可以用 Excel 批量导入。登录账号就是学号，所有新学生使用统一初始密码。" /><StudentImportPanel api={api} toast={toast} onImported={reload} /><div className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名、年级或班级" /></div><span className="toolbar-count">{items.length} 名学生</span></div>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : items.length ? <div className="responsive-table"><div className="table-row table-head"><span>姓名与登录账号</span><span>年级班级</span><span>已选课程</span><span>账号状态</span></div>{items.map((student) => <div className="table-row" key={student.id}><span><strong>{student.name}</strong><small>登录账号：{student.student_no}</small></span><span>{student.grade} · {student.class_name}</span><span>{student.enrolled_count} 门</span><span><StatusPill status={student.account_status} /></span></div>)}</div> : <Empty title="还没有学生资料" description="请手动添加学生，或上传学生 Excel 名单。" />}</>;
}

export function AdminAccountsPage({ api, toast }) {
  const [form, setForm] = useState({ username: '', name: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [state, reload] = useAdminLoad(() => api.getAdminAccounts(), []);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function create(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.createAdminAccount(form);
      setForm({ username: '', name: '', password: '' });
      toast('教师账号已创建，首次登录需要修改密码');
      reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeader eyebrow="仅超级管理员可见" title="教师账号" />
    <form className="paper-card teacher-account-form" onSubmit={create}>
      <div className="card-title"><div><h2>新增教师账号</h2><span>创建后请把账号和初始密码单独交给本人</span></div></div>
      <label><span>登录账号</span><input value={form.username} onChange={update('username')} placeholder="例如：zhanglaoshi" autoComplete="off" /></label>
      <label><span>教师姓名</span><input value={form.name} onChange={update('name')} placeholder="例如：张老师" autoComplete="off" /></label>
      <label><span>初始密码</span><input type="password" value={form.password} onChange={update('password')} placeholder="至少 8 位" autoComplete="new-password" /></label>
      <button className="primary-button" disabled={saving || !form.username.trim() || !form.name.trim() || form.password.length < 8}>{saving ? '正在创建…' : '创建教师账号'}</button>
    </form>
    {state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : <div className="responsive-table account-table"><div className="table-row table-head"><span>姓名与账号</span><span>角色</span><span>状态</span><span>首次改密</span></div>{state.data.items.map((account) => <div className="table-row" key={account.id}><span><strong>{account.name}</strong><small>登录账号：{account.username}{account.current ? ' · 当前账号' : ''}</small></span><span>{account.role === 'SUPER_ADMIN' ? '超级管理员' : '老师'}</span><span><StatusPill status={account.status} /></span><span>{account.must_change_password ? '登录后需要修改' : '已完成'}</span></div>)}</div>}
  </>;
}

export function AdminResourcesPage({ api, toast }) {
  const [state, reload] = useAdminLoad(() => api.getAdminMeta(), []);
  const [draft, setDraft] = useState({ staff: '', venues: '', categories: '', slot_name: '', weekday: 1, period: 1 });
  async function add(type, payload, clearKey) { try { await api.createAdminMeta(type, payload); toast('基础数据已添加'); setDraft((current) => ({ ...current, [clearKey]: '' })); reload(); } catch (error) { toast(error.message, 'error'); } }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  const groups = [['staff', '教师名单', state.data.staff, '输入教师姓名', () => add('staff', { name: draft.staff }, 'staff')], ['venues', '上课场地', state.data.venues, '输入教室或场地名称', () => add('venues', { name: draft.venues }, 'venues')], ['categories', '课程分类', state.data.categories, '输入课程分类名称', () => add('categories', { name: draft.categories }, 'categories')]];
  return <><PageHeader eyebrow="排课前需要维护的资料" title="基础数据" description="教师、场地、课程分类和时间段会出现在课程创建与排课下拉框中。" /><div className="resource-grid">{groups.map(([key, title, items, placeholder, action]) => <section className="paper-card" key={key}><div className="card-title"><h2>{title}</h2><span>{items.length} 项</span></div><div className="inline-create"><input value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} /><button onClick={action} disabled={!draft[key].trim()}>添加</button></div><div className="resource-list">{items.map((item) => <span key={item.id}>{item.name}<small>{item.staff_no || ''}</small></span>)}</div></section>)}</div><section className="paper-card slot-resource"><div className="card-title"><div><h2>上课时间段</h2><span>按星期和节次定义</span></div></div><div className="slot-create"><input value={draft.slot_name} onChange={(event) => setDraft((current) => ({ ...current, slot_name: event.target.value }))} placeholder="例如：周一第 9 节" /><select value={draft.weekday} onChange={(event) => setDraft((current) => ({ ...current, weekday: Number(event.target.value) }))}>{['一', '二', '三', '四', '五', '六', '日'].map((day, index) => <option key={day} value={index + 1}>周{day}</option>)}</select><input type="number" min="1" max="20" value={draft.period} onChange={(event) => setDraft((current) => ({ ...current, period: Number(event.target.value) }))} /><button onClick={() => add('time-slots', { name: draft.slot_name, weekday: draft.weekday, period: draft.period }, 'slot_name')} disabled={!draft.slot_name.trim()}>添加时间段</button></div><div className="resource-list wide">{state.data.time_slots.map((item) => <span key={item.id}>{item.name}</span>)}</div></section></>;
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
  const ruleGroups = ['学生选课', '退课处理', '账号安全'];
  const valueOf = (key, fallback) => draft.find((item) => item.key === key)?.value ?? fallback;
  const summary = `每名学生最多选 ${valueOf('student.max_active_courses', 2)} 门；同类课程${valueOf('student.max_courses_per_category', 0) === '0' ? '不限数量' : `最多 ${valueOf('student.max_courses_per_category', 0)} 门`}；开课后${valueOf('enrollment.allow_withdraw_after_start', 'false') === 'true' ? '允许学生自行退课' : '只能由教务处理退课'}。`;
  return <><PageHeader eyebrow="老师也能直接看懂和修改" title="规则与操作记录" description="这里控制学生能选几门课、能否退课以及账号安全。修改后点击保存才会生效。" /><div className="rule-summary"><strong>当前规则</strong><span>{summary}</span></div><div className="settings-grid"><section className="paper-card rules-card"><div className="card-title"><div><p className="eyebrow ink">用问答方式设置</p><h2>选课规则</h2></div><button className="primary-compact" onClick={save}>保存全部修改</button></div>{ruleGroups.map((group) => <section className="rule-group" key={group}><h3>{group}</h3><div className="config-list">{draft.map((item, index) => ({ item, index, text: CONFIG_TEXT[item.key] })).filter((entry) => entry.text?.group === group).map(({ item, index, text }) => <label key={item.key}><span><strong>{text.label}</strong><small>{text.help}</small></span><span className="rule-control">{item.type === 'bool' ? <select value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))}><option value="true">允许</option><option value="false">不允许</option></select> : <input type={text.input || 'number'} min={text.input ? undefined : '0'} value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} />}{text.unit ? <small>{text.unit}</small> : null}</span></label>)}</div></section>)}</section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">谁在什么时候做了什么</p><h2>最近操作</h2></div><span>最近 100 条</span></div><div className="audit-list readable-audit">{state.data.audit.length ? state.data.audit.map((item) => <div key={item.id}><span><strong><b>{item.actor_name || '系统'}</b> · {AUDIT_TEXT[item.action] || '进行了系统操作'}</strong><small>{item.target_name ? `${AUDIT_TARGET_TEXT[item.target_type] || '对象'}：${item.target_name}` : AUDIT_TARGET_TEXT[item.target_type] || '系统记录'}</small></span><time>{formatDate(item.created_at)}</time></div>) : <Empty title="暂无操作记录" />}</div></section></div></>;
}
