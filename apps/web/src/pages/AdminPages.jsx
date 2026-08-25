import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorState, Loading, Metric, PageHeader, StatusPill } from '../components/Common.jsx';
import { formatDate } from '../runtime/browser.js';
import { parseStudentSheet } from '../utils/studentImport.js';

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
  return <><PageHeader eyebrow="教务工作台" title="运行总览" description="课程、学生、名额和风险状态集中在这里。" />{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : <><section className="metric-grid admin-metrics"><Metric value={data.students} label="学生总数" /><Metric value={data.open_courses} label="开放课程" /><Metric value={data.active_enrollments} label="有效报名" /><Metric value={`${data.fill_rate}%`} label="总体满班率" tone="accent" /></section><div className="dashboard-grid"><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">容量观察</p><h2>热门课程</h2></div><span>{data.remaining_seats} 个余位</span></div>{(data.top_fill_courses || []).map((course) => <div className="fill-row" key={course.id}><div><strong>{course.name}</strong><span>{course.active_count}/{course.capacity}</span></div><div className="seat-track"><i style={{ width: `${course.fill}%` }} /></div></div>)}</section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">待关注</p><h2>运行提醒</h2></div></div><div className="signal-grid"><div><strong>{data.near_full_courses?.length || 0}</strong><span>接近满员</span></div><div><strong>{data.conflict_courses || 0}</strong><span>冲突课程</span></div><div><strong>{data.students_need_pwd || 0}</strong><span>待改初始密码</span></div><div><strong>{data.full_courses || 0}</strong><span>已满课程</span></div></div></section><section className="paper-card span-two"><div className="card-title"><div><p className="eyebrow ink">最新动态</p><h2>最近报名</h2></div></div>{data.recent_enrollments?.length ? <div className="data-table"><div className="table-row table-head"><span>学生</span><span>课程</span><span>时间</span></div>{data.recent_enrollments.map((item, index) => <div className="table-row" key={index}><span><strong>{item.name}</strong><small>{item.student_no}</small></span><span>{item.course_name}</span><span>{formatDate(item.enrolled_at)}</span></div>)}</div> : <Empty title="暂无报名动态" />}</section></div></>}</>;
}

export function AdminCoursesPage({ api, toast }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [state] = useAdminLoad(() => api.getAdminCourses(), [refreshKey]);
  const items = useMemo(() => (state.data?.items || []).filter((course) => (status === 'ALL' || course.status === status) && `${course.name}${course.teachers?.join('')}`.toLowerCase().includes(query.toLowerCase())), [state.data, query, status]);
  async function changeStatus(course, action) {
    const labels = { open: '开放报名', close: '停止报名', archive: '归档' };
    if (!window.confirm(`确认将“${course.name}”设为${labels[action]}吗？`)) return;
    try { await api.setCourseStatus(course.id, action); toast('课程状态已更新'); setRefreshKey((key) => key + 1); }
    catch (error) { toast(error.message, 'error'); }
  }
  return <><PageHeader eyebrow="教务管理" title="课程管理" description="查看课程容量、发布状态和排课信息。" /><section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程或教师" /></div><div className="chip-row inline">{['ALL', 'OPEN', 'DRAFT', 'CLOSED', 'ARCHIVED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部' : <StatusPill status={item} />}</button>)}</div></section>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={() => setRefreshKey((key) => key + 1)} /> : items.length ? <div className="admin-course-grid">{items.map((course) => <article className="admin-course-card" key={course.id}><div className="admin-course-top"><div><StatusPill status={course.status} /><h2>{course.name}</h2><p>{course.teachers?.join('、') || '教师待定'} · {course.schedules?.map((item) => item.slot_name).join('、') || '时间待定'}</p></div><strong>{course.active_count}<small> / {course.capacity}</small></strong></div><div className="seat-track"><i style={{ width: `${course.capacity ? Math.round(course.active_count / course.capacity * 100) : 0}%` }} /></div><div className="card-actions">{course.status !== 'OPEN' ? <button onClick={() => changeStatus(course, 'open')}>开放报名</button> : <button onClick={() => changeStatus(course, 'close')}>停止报名</button>}<button disabled={course.status === 'ARCHIVED'} onClick={() => changeStatus(course, 'archive')}>归档</button></div></article>)}</div> : <Empty title="没有符合条件的课程" />}</>;
}

export function AdminStudentsPage({ api, toast }) {
  const [query, setQuery] = useState('');
  const [state, reload] = useAdminLoad(() => api.getAdminStudents(), []);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [defaultPassword, setDefaultPassword] = useState('12345678');
  const [resetExisting, setResetExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const items = (state.data?.items || []).filter((item) => `${item.student_no}${item.name}${item.grade}${item.class_name}`.includes(query));
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('Excel 文件不能超过 10MB', 'error');
    try {
      const { readSheet } = await import('read-excel-file/browser');
      const parsed = parseStudentSheet(await readSheet(file));
      setFileName(file.name); setPreview(parsed);
    } catch (error) {
      setFileName(''); setPreview(null); toast(error.message || '无法读取 Excel 文件', 'error');
    }
  }
  async function runImport() {
    if (!preview?.rows.length) return;
    if (defaultPassword.length < 8) return toast('统一初始密码至少 8 位', 'error');
    setImporting(true);
    try {
      const result = await api.importAdminStudents({ rows: preview.rows, default_password: defaultPassword, reset_existing_password: resetExisting });
      toast(`导入完成：新增 ${result.created} 名，更新 ${result.updated} 名`);
      setPreview(null); setFileName(''); reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setImporting(false); }
  }
  return <><PageHeader eyebrow="名单与账号" title="学生" description="按学号、姓名、年级或班级查询学生。" /><section className="student-import-card"><div><p className="eyebrow ink">批量建档</p><h2>从 Excel 导入学生</h2><p>支持 .xlsx，识别学号、姓名、年级、班级和初始密码。只含“学号”列也可以导入。</p></div><label className="upload-button">选择 Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} /></label>{preview ? <div className="import-preview"><div className="import-summary"><strong>{fileName}</strong><span>{preview.rows.length} 行可导入 · {preview.errors.length} 行需修正</span></div><label><span>统一初始密码</span><input type="text" value={defaultPassword} onChange={(event) => setDefaultPassword(event.target.value)} /><small>Excel 中未填写初始密码时使用；首次登录必须修改。</small></label><label className="check-line"><input type="checkbox" checked={resetExisting} onChange={(event) => setResetExisting(event.target.checked)} /><span>同时重置已存在学生的密码</span></label>{preview.errors.length ? <div className="import-errors"><strong>未导入的行</strong>{preview.errors.slice(0, 8).map((error) => <span key={`${error.row_number}-${error.message}`}>第 {error.row_number} 行：{error.message}</span>)}{preview.errors.length > 8 ? <span>另有 {preview.errors.length - 8} 行错误</span> : null}</div> : null}<div className="import-sample"><span>预览</span>{preview.rows.slice(0, 5).map((student) => <span key={student.student_no}><strong>{student.student_no}</strong>{student.name} · {student.grade} · {student.class_name}</span>)}</div><button className="primary-compact" disabled={importing || !preview.rows.length} onClick={runImport}>{importing ? '正在导入…' : `确认导入 ${preview.rows.length} 名学生`}</button></div> : null}</section><div className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名或班级" /></div><span className="toolbar-count">{items.length} 名学生</span></div>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : items.length ? <div className="responsive-table"><div className="table-row table-head"><span>学生</span><span>年级班级</span><span>已选课程</span><span>账号状态</span></div>{items.map((student) => <div className="table-row" key={student.id}><span><strong>{student.name}</strong><small>{student.student_no}</small></span><span>{student.grade} · {student.class_name}</span><span>{student.enrolled_count} 门</span><span><StatusPill status={student.account_status} /></span></div>)}</div> : <Empty title="没有找到学生" />}</>;
}

export function AdminEnrollmentsPage({ api }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [state, reload] = useAdminLoad(() => api.getAdminEnrollments({ query, status }), [query, status]);
  return <><PageHeader eyebrow="报名流水" title="报名记录" description="追踪学生自助报名和管理员操作记录。" /><section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名或课程" /></div><div className="chip-row inline">{['ALL', 'ENROLLED', 'WITHDRAWN', 'CANCELLED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部' : <StatusPill status={item} />}</button>)}</div></section>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : state.data.items.length ? <div className="responsive-table enrollment-table"><div className="table-row table-head"><span>课程</span><span>学生</span><span>状态</span><span>来源</span><span>时间</span></div>{state.data.items.map((item) => <div className="table-row" key={item.enrollment_id}><span><strong>{item.course_name}</strong></span><span>{item.student_name}<small>{item.student_no}</small></span><span><StatusPill status={item.status} /></span><span>{item.source === 'STUDENT' ? '学生自助' : '管理员代报'}</span><span>{formatDate(item.enrolled_at)}</span></div>)}</div> : <Empty title="暂无报名记录" />}</>;
}

export function AdminSettingsPage({ api, toast }) {
  const [state, reload] = useAdminLoad(async () => {
    const [configs, audit] = await Promise.all([api.getAdminConfigs(), api.getAdminAudit()]);
    return { configs: configs.items, audit: audit.items };
  }, []);
  const [draft, setDraft] = useState([]);
  useEffect(() => { if (state.data?.configs) setDraft(state.data.configs); }, [state.data]);
  async function save() { try { await api.updateAdminConfigs(draft.map(({ key, value }) => ({ key, value }))); toast('规则配置已保存'); reload(); } catch (error) { toast(error.message, 'error'); } }
  return <><PageHeader eyebrow="系统治理" title="规则与日志" description="集中管理选课规则并审阅关键操作。" />{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : <div className="settings-grid"><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">运行规则</p><h2>业务配置</h2></div><button className="primary-compact" onClick={save}>保存配置</button></div><div className="config-list">{draft.map((item, index) => <label key={item.key}><span><strong>{item.key}</strong><small>{item.type}</small></span><input value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} /></label>)}</div></section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">最近 50 条</p><h2>操作审计</h2></div></div><div className="audit-list">{state.data.audit.length ? state.data.audit.map((item) => <div key={item.id}><span><strong>{item.action}</strong><small>{item.target_type} #{item.target_id}</small></span><time>{formatDate(item.created_at)}</time></div>) : <Empty title="暂无日志" />}</div></section></div>}</>;
}
