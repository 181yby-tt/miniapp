import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorState, Loading, Metric, PageHeader, StatusPill } from '../components/Common.jsx';
import CourseEditor from '../components/admin/CourseEditor.jsx';
import CourseImportPanel from '../components/admin/CourseImportPanel.jsx';
import StudentImportPanel from '../components/admin/StudentImportPanel.jsx';
import { formatDate } from '../runtime/browser.js';

const CONFIG_TEXT = {
  'student.max_active_courses': { group: '学生选课', label: '每个学生最多能选几门课？', help: '达到这个数量后，学生不能继续报名。', unit: '门' },
  'student.max_courses_per_category': { group: '学生选课', label: '同一类课程最多能选几门？', help: '例如体育类最多选 1 门；填写 0 表示不限制。', unit: '门' },
  'enrollment.allow_withdraw_after_start': { group: '退课处理', label: '课程开始后，学生还能自己退课吗？', help: '选择“不允许”后，只能由教务人员处理。' },
  'enrollment.allow_reenroll': { group: '退课处理', label: '学生退课后，还能重新报名同一门课吗？', help: '名额未满且没有时间冲突时才可重新报名。' },
  'security.password_min_length': { group: '账号安全', label: '学生密码至少多少位？', help: '建议保持 8 位或以上。', unit: '位' },
  'security.login_max_failures': { group: '账号安全', label: '连续输错几次后锁定账号？', help: '用于阻止别人反复猜密码。', unit: '次' },
  'security.lock_minutes': { group: '账号安全', label: '输错密码后锁定多久？', help: '到时间后账号会自动恢复登录。', unit: '分钟' },
};
const AUDIT_TEXT = {
  CHANGE_PASSWORD: '修改密码', IMPORT_STUDENTS: '导入学生名单', CREATE_COURSE: '新建课程', UPDATE_COURSE: '修改课程与排课',
  COURSE_OPEN: '开放课程报名', COURSE_CLOSE: '停止课程报名', COURSE_ARCHIVE: '归档课程', UPDATE_CONFIG: '修改选课规则', CREATE_BASE_DATA: '新增基础数据',
  ENROLL: '学生报名', WITHDRAW: '学生退课', STAFF_ENROLL: '教务代报名', STAFF_WITHDRAW: '教务代退课',
};
const AUDIT_TARGET_TEXT = { course: '课程', student: '学生', students: '学生名单', system: '系统规则', staff: '教师', venues: '场地', categories: '课程分类', 'time-slots': '时间段' };

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
    <PageHeader eyebrow="教务工作台" title="选课排课总览" description="先维护学生和课程，再完成排课，最后开放学生报名。" />
    <section className="metric-grid admin-metrics"><Metric value={data.students} label="学生人数" /><Metric value={data.total_courses} label="课程总数" /><Metric value={data.open_courses} label="正在报名" /><Metric value={data.conflict_courses} label="存在排课冲突" tone="accent" /></section>
    <div className="workflow-steps"><div><b>1</b><strong>导入学生</strong><span>生成学生账号和初始密码</span></div><div><b>2</b><strong>建立课程</strong><span>手动创建或 Excel 批量导入</span></div><div><b>3</b><strong>完成排课</strong><span>安排教师、时间和场地</span></div><div><b>4</b><strong>开放报名</strong><span>学生登录后自主选课</span></div></div>
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
    const labels = { open: '开放报名', close: '停止报名', archive: '归档' };
    if (!window.confirm(`确认将“${course.name}”设为${labels[action]}吗？`)) return;
    try { await api.setCourseStatus(course.id, action); toast('课程状态已更新'); refresh(); }
    catch (error) { toast(error.message, 'error'); }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={refresh} />;
  return <>
    <PageHeader eyebrow="课程资料、教师与排课" title="课程管理" description="可以手动创建和编辑课程，也可以使用 Excel 批量导入。每门课程都能安排教师、上课时间、场地和报名范围。" action={<button className="primary-action" onClick={() => setEditorCourse(null)}>新建课程</button>} />
    <CourseImportPanel api={api} courses={state.data.courses} meta={state.data.meta} toast={toast} onImported={refresh} />
    <section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程或任课教师" /></div><div className="chip-row inline">{['ALL', 'OPEN', 'DRAFT', 'CLOSED', 'FINISHED', 'ARCHIVED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部课程' : <StatusPill status={item} />}</button>)}</div></section>
    {items.length ? <div className="admin-course-grid">{items.map((course) => <article className="admin-course-card" key={course.id}><div className="admin-course-top"><div><StatusPill status={course.status} /><h2>{course.name}</h2><p>{course.teachers?.join('、') || '尚未安排教师'}</p><p>{course.schedules?.map((item) => `${item.slot_name} · ${item.venue_name}`).join('；') || '尚未排课'}</p></div><strong>{course.active_count}<small> / {course.capacity}</small></strong></div><div className="seat-track"><i style={{ width: `${course.capacity ? Math.round(course.active_count / course.capacity * 100) : 0}%` }} /></div><div className="card-actions"><button onClick={() => setEditorCourse(course)}>编辑与排课</button>{course.status !== 'OPEN' ? <button onClick={() => changeStatus(course, 'open')}>开放报名</button> : <button onClick={() => changeStatus(course, 'close')}>停止报名</button>}<button disabled={course.status === 'ARCHIVED'} onClick={() => changeStatus(course, 'archive')}>归档</button></div></article>)}</div> : <Empty title="没有符合条件的课程" />}
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
  const byCell = (weekday, period) => state.data.courses.filter((course) => course.schedules?.some((item) => Number(item.weekday) === weekday && Number(item.period) === period));
  const hasConflict = (courses, weekday, period) => courses.some((course, index) => courses.slice(index + 1).some((other) => {
    const sharedTeacher = course.teacher_ids.some((id) => other.teacher_ids.includes(id));
    const venues = course.schedules.filter((item) => Number(item.weekday) === weekday && Number(item.period) === period).map((item) => item.venue_id);
    const otherVenues = other.schedules.filter((item) => Number(item.weekday) === weekday && Number(item.period) === period).map((item) => item.venue_id);
    return sharedTeacher || venues.some((id) => otherVenues.includes(id));
  }));
  return <><PageHeader eyebrow="查看全校课表并处理冲突" title="排课管理" description="按星期和节次查看所有课程。点击课程即可调整任课教师、时间或场地。红色格表示教师或场地冲突。" /><div className="admin-schedule" style={{ gridTemplateColumns: `90px repeat(${weekdays.length}, minmax(180px, 1fr))` }}><div className="schedule-corner">节次</div>{weekdays.map((weekday) => <div className="schedule-column-head" key={weekday}>{dayNames[weekday]}</div>)}{periods.map((period) => [<div className="schedule-period" key={`p-${period}`}>第 {period} 节</div>, ...weekdays.map((weekday) => { const courses = byCell(weekday, period); return <div className={`admin-schedule-cell ${hasConflict(courses, weekday, period) ? 'busy' : ''}`} key={`${weekday}-${period}`}>{courses.map((course) => { const schedules = course.schedules.filter((item) => Number(item.weekday) === weekday && Number(item.period) === period); return <button key={course.id} onClick={() => setEditorCourse(course)}><strong>{course.name}</strong><span>{course.teachers.join('、') || '教师待定'}</span><span>{schedules.map((item) => item.venue_name).join('、')}</span></button>; })}</div>; })])}</div>{editorCourse !== undefined ? <CourseEditor api={api} course={editorCourse} meta={state.data.meta} toast={toast} onClose={() => setEditorCourse(undefined)} onSaved={() => { setEditorCourse(undefined); reload(); }} /> : null}</>;
}

export function AdminStudentsPage({ api, toast }) {
  const [query, setQuery] = useState('');
  const [state, reload] = useAdminLoad(() => api.getAdminStudents(), []);
  const items = (state.data?.items || []).filter((item) => `${item.student_no}${item.name}${item.grade}${item.class_name}`.includes(query));
  return <><PageHeader eyebrow="学生资料、账号与班级" title="学生管理" description="先导入学生资料，系统会自动生成登录账号和初始密码。导入完成后，学生会进入下方名单。" /><StudentImportPanel api={api} toast={toast} onImported={reload} /><div className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名、年级或班级" /></div><span className="toolbar-count">{items.length} 名学生</span></div>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : items.length ? <div className="responsive-table"><div className="table-row table-head"><span>姓名与登录账号</span><span>年级班级</span><span>已选课程</span><span>账号状态</span></div>{items.map((student) => <div className="table-row" key={student.id}><span><strong>{student.name}</strong><small>登录账号：{student.student_no}</small></span><span>{student.grade} · {student.class_name}</span><span>{student.enrolled_count} 门</span><span><StatusPill status={student.account_status} /></span></div>)}</div> : <Empty title="还没有学生资料" description="请先上传学生 Excel 名单。" />}</>;
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

export function AdminEnrollmentsPage({ api }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('ALL');
  const [state, reload] = useAdminLoad(() => api.getAdminEnrollments({ query, status }), [query, status]);
  return <><PageHeader eyebrow="学生报名和退课记录" title="报名管理" description="按学生、学号或课程查询报名结果。" /><section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名或课程" /></div><div className="chip-row inline">{['ALL', 'ENROLLED', 'WITHDRAWN', 'CANCELLED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部记录' : <StatusPill status={item} />}</button>)}</div></section>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : state.data.items.length ? <div className="responsive-table enrollment-table"><div className="table-row table-head"><span>课程</span><span>学生</span><span>状态</span><span>操作来源</span><span>时间</span></div>{state.data.items.map((item) => <div className="table-row" key={item.enrollment_id}><span><strong>{item.course_name}</strong></span><span>{item.student_name}<small>{item.student_no}</small></span><span><StatusPill status={item.status} /></span><span>{item.source === 'STUDENT' ? '学生自行操作' : '教务人员操作'}</span><span>{formatDate(item.enrolled_at)}</span></div>)}</div> : <Empty title="暂无报名记录" />}</>;
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
  return <><PageHeader eyebrow="老师也能直接看懂和修改" title="规则与操作记录" description="这里控制学生能选几门课、能否退课以及账号安全。修改后点击保存才会生效。" /><div className="rule-summary"><strong>当前规则</strong><span>{summary}</span></div><div className="settings-grid"><section className="paper-card rules-card"><div className="card-title"><div><p className="eyebrow ink">用问答方式设置</p><h2>选课规则</h2></div><button className="primary-compact" onClick={save}>保存全部修改</button></div>{ruleGroups.map((group) => <section className="rule-group" key={group}><h3>{group}</h3><div className="config-list">{draft.map((item, index) => ({ item, index, text: CONFIG_TEXT[item.key] })).filter((entry) => entry.text?.group === group).map(({ item, index, text }) => <label key={item.key}><span><strong>{text.label}</strong><small>{text.help}</small></span><span className="rule-control">{item.type === 'bool' ? <select value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))}><option value="true">允许</option><option value="false">不允许</option></select> : <input type="number" min="0" value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} />}{text.unit ? <small>{text.unit}</small> : null}</span></label>)}</div></section>)}</section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">谁在什么时候做了什么</p><h2>最近操作</h2></div><span>最近 100 条</span></div><div className="audit-list readable-audit">{state.data.audit.length ? state.data.audit.map((item) => <div key={item.id}><span><strong><b>{item.actor_name || '系统'}</b> · {AUDIT_TEXT[item.action] || '进行了系统操作'}</strong><small>{item.target_name ? `${AUDIT_TARGET_TEXT[item.target_type] || '对象'}：${item.target_name}` : AUDIT_TARGET_TEXT[item.target_type] || '系统记录'}</small></span><time>{formatDate(item.created_at)}</time></div>) : <Empty title="暂无操作记录" />}</div></section></div></>;
}
