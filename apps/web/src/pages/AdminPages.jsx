import { useEffect, useMemo, useState } from 'react';
import { makeIdempotencyKey } from '@kexu/client-core';
import { Empty, ErrorState, Loading, Metric, PageHeader, StatusPill } from '../components/Common.jsx';
import CourseEditor from '../components/admin/CourseEditor.jsx';
import CourseImportPanel from '../components/admin/CourseImportPanel.jsx';
import { formatDate } from '../runtime/browser.js';
import { downloadEnrollmentRoster } from '../utils/enrollmentRosterExport.js';
import { buildEnrollmentSummarySheet, ENROLLMENT_SUMMARY_COLUMNS, localDateStamp, summarizeEnrollmentCourses } from '../utils/enrollmentSummaryExport.js';

const CONFIG_TEXT = {
  'student.max_active_courses': { group: '学生选课', label: '每个学生最多能选几门课？', help: '达到这个数量后，学生不能继续报名。', unit: '门' },
  'student.max_courses_per_category': { group: '学生选课', label: '同一类课程最多能选几门？', help: '例如体育类最多选 1 门；填写 0 表示不限制。', unit: '门' },
  'enrollment.allow_reenroll': { group: '退课处理', label: '学生退课后，还能重新报名同一门课吗？', help: '报名期间、名额未满且未达到个人选课上限时，可以重新报名。' },
  'security.password_min_length': { group: '账号安全', label: '学生密码至少多少位？', help: '建议保持 8 位或以上。', unit: '位' },
  'security.student_initial_password': { group: '账号安全', label: '学生统一初始密码是什么？', help: 'Excel 导入和手动添加都会使用它；学生首次登录必须修改。', input: 'text' },
  'security.login_max_failures': { group: '账号安全', label: '连续输错几次后锁定账号？', help: '用于阻止别人反复猜密码。', unit: '次' },
  'security.lock_minutes': { group: '账号安全', label: '输错密码后锁定多久？', help: '到时间后账号会自动恢复登录。', unit: '分钟' },
};
const AUDIT_TEXT = {
  CREATE_GRADE: '创建年级',
  DELETE_STUDENTS: '按名单删除学生',
  CHANGE_PASSWORD: '修改密码', IMPORT_STUDENTS: '导入学生名单', CREATE_COURSE: '新建课程', UPDATE_COURSE: '修改课程资料',
  COURSE_OPEN: '开放课程报名', COURSE_CLOSE: '暂停课程报名', COURSE_ARCHIVE: '移入历史课程', UPDATE_CONFIG: '修改选课规则', CREATE_BASE_DATA: '新增基础数据',
  ENROLL: '学生报名', WITHDRAW: '学生退课', STAFF_ENROLL: '教务代报名', STAFF_WITHDRAW: '教务代退课', CREATE_TEACHER_ACCOUNT: '新增教师账号', CREATE_ADMIN_ACCOUNT: '新增管理账号',
  OPEN_ENROLLMENT_GROUP: '开放教学组报名', CLOSE_ENROLLMENT_GROUP: '停止教学组报名',
  RESET_STUDENT_PASSWORD: '重置学生密码',
  CREATE_TEACHING_GROUP: '新建教学组', OPEN_PREFERENCES: '开放志愿填报', CLOSE_PREFERENCES: '停止志愿填报', SUBMIT_PREFERENCES: '提交志愿', SIMULATE_ALLOCATION: '运行模拟分配', PUBLISH_ALLOCATION: '发布分配结果',
};
const AUDIT_TARGET_TEXT = { grade: '年级', course: '体育项目', student: '学生', students: '学生名单', system: '系统规则', staff: '教师', teacher_account: '教师账号', venues: '场地', categories: '项目分类', 'time-slots': '时间段', teaching_group: '教学组' };

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
    <section className="metric-grid admin-metrics"><Metric value={data.students} label="学生人数" /><Metric value={data.enrolled_students} label="已报名学生" /><Metric value={Math.max(0, data.students - data.enrolled_students)} label="未报名学生" /><Metric value={data.remaining_seats} label="剩余名额" tone="accent" /></section>
    <div className="dashboard-grid"><section className="paper-card"><div className="card-title"><h2>报名情况</h2></div><div className="signal-grid"><div><strong>{data.open_courses}</strong><span>开放课程</span></div><div><strong>{data.full_courses}</strong><span>已满课程</span></div><div><strong>{data.active_enrollments}</strong><span>有效报名人次</span></div><div><strong>{data.grades}</strong><span>年级</span></div></div></section><section className="paper-card"><div className="card-title"><h2>教务提醒</h2></div><div className="signal-grid"><div><strong>{data.draft_courses}</strong><span>待完善课程</span></div><div><strong>{data.students_need_pwd}</strong><span>尚未修改初始密码</span></div><div><strong>{data.closed_courses}</strong><span>暂停报名课程</span></div></div></section></div>
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
      open: `确认启用“${course.name}”吗？\n\n开放后，符合范围的学生可以在规定时间内报名；`,
      close: `确认暂停报名“${course.name}”吗？\n\n暂停后，学生不能继续报名或自行退课，已有报名名单保留。`,
      archive: `确认把“${course.name}”移入历史课程吗？\n\n它将不再接受学生报名，但课程资料、学生报名记录都会保留。`,
    };
    if (!window.confirm(messages[action])) return;
    const success = { open: '报名已开放', close: '项目已暂停', archive: '已移入历史项目' };
    try { await api.setCourseStatus(course.id, action); toast(success[action]); refresh(); }
    catch (error) { toast(error.message, 'error'); }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={refresh} />;
  return <>
    <PageHeader eyebrow="教务管理" title="体育项目" action={<button className="primary-action" onClick={() => setEditorCourse(null)}>新建体育项目</button>} />
    <details className="course-status-guide"><summary>项目状态说明</summary><span><b>待完善</b>：保存为草稿，确认课程资料后开放报名；<b>开放报名</b>：在规定时间内接受报名；<b>暂停报名</b>：不再接受学生报名；<b>历史项目</b>：资料与历史结果继续保留。</span></details>
    <CourseImportPanel api={api} courses={state.data.courses} meta={state.data.meta} toast={toast} onImported={refresh} />
    <section className="toolbar-line admin-list-toolbar"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或任课教师" /></div><select className="admin-filter-select" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">全部分类</option>{state.data.meta.categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select><select className="admin-filter-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option><option value="OPEN">开放报名</option><option value="DRAFT">待完善</option><option value="CLOSED">暂停报名</option><option value="FINISHED">课程结束</option><option value="ARCHIVED">历史项目</option></select><span className="toolbar-count">{items.length} 个项目</span></section>
    {items.length ? <div className="admin-course-grid">{items.map((course) => <article className={`admin-course-card ${course.status === 'ARCHIVED' ? 'is-history' : ''}`} key={course.id}><div className="admin-course-top"><div><StatusPill status={course.status} /><h2>{course.name}</h2><p>任课教师：{course.teachers?.join('、') || '尚未安排'}</p></div><strong>{course.active_count}<small> / {course.capacity} 人</small></strong></div><div className="seat-track"><i style={{ width: `${course.capacity ? Math.round(course.active_count / course.capacity * 100) : 0}%` }} /></div><div className="card-actions"><button className="course-edit-action" onClick={() => setEditorCourse(course)}>{course.status === 'ARCHIVED' ? '查看或修改资料' : '修改课程资料'}</button>{['DRAFT', 'CLOSED'].includes(course.status) ? <button className="course-open-action" onClick={() => changeStatus(course, 'open')}>开放报名</button> : null}{course.status === 'OPEN' ? <button className="course-pause-action" onClick={() => changeStatus(course, 'close')}>暂停报名</button> : null}{['DRAFT', 'CLOSED', 'FINISHED'].includes(course.status) ? <button className="course-history-action" onClick={() => changeStatus(course, 'archive')}>移入历史项目</button> : null}{course.status === 'ARCHIVED' ? <span className="history-note">已停止学生报名</span> : null}</div></article>)}</div> : <Empty title="没有符合条件的体育项目" />}
    {editorCourse !== undefined ? <CourseEditor api={api} course={editorCourse} meta={state.data.meta} toast={toast} onClose={() => setEditorCourse(undefined)} onSaved={refresh} /> : null}
  </>;
}

export function AdminAccountsPage({ api, toast }) {
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'STAFF' });
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
      setForm({ username: '', name: '', password: '', role: 'STAFF' });
      toast(`${form.role === 'SUPER_ADMIN' ? '超级管理员' : '教务管理员'}账号已创建`);
      reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  const accounts = (state.data?.items || []).filter((account) => (role === 'ALL' || account.role === role) && (status === 'ALL' || account.status === status) && `${account.name}${account.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageHeader eyebrow="仅超级管理员可见" title="账号管理" />
    <details className="teacher-account-tools"><summary><span><strong>新增账号</strong><small>可创建教务管理员或超级管理员</small></span><b>展开</b></summary><form className="teacher-account-form" onSubmit={create}>
      <label><span>登录账号</span><input value={form.username} onChange={update('username')} placeholder="例如：zhanglaoshi" autoComplete="off" /></label>
      <label><span>姓名</span><input value={form.name} onChange={update('name')} placeholder="例如：张老师" autoComplete="off" /></label>
      <label><span>账号角色</span><select value={form.role} onChange={update('role')}><option value="STAFF">教务管理员</option><option value="SUPER_ADMIN">超级管理员</option></select></label>
      <label><span>初始密码</span><input type="password" value={form.password} onChange={update('password')} placeholder="至少 8 位" autoComplete="new-password" /></label>
      <button className="primary-button" disabled={saving || !form.username.trim() || !form.name.trim() || form.password.length < 8}>{saving ? '正在创建…' : '创建账号'}</button>
    </form></details>
    <div className="toolbar-line admin-list-toolbar"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></div><select className="admin-filter-select" value={role} onChange={(event) => setRole(event.target.value)}><option value="ALL">全部角色</option><option value="SUPER_ADMIN">超级管理员</option><option value="STAFF">教务管理员</option></select><select className="admin-filter-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option><option value="ACTIVE">正常</option><option value="DISABLED">停用</option></select><span className="toolbar-count">{accounts.length} 个账号</span></div>
    {state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : accounts.length ? <div className="responsive-table account-table"><div className="table-row table-head"><span>姓名与账号</span><span>角色</span><span>状态</span><span>密码策略</span></div>{accounts.map((account) => <div className="table-row" key={account.id}><span><strong>{account.name}</strong><small>登录账号：{account.username}{account.current ? ' · 当前账号' : ''}</small></span><span>{account.role === 'SUPER_ADMIN' ? '超级管理员' : '教务管理员'}</span><span><StatusPill status={account.status} /></span><span>无需首次强制改密</span></div>)}</div> : <Empty title="没有符合条件的账号" />}
  </>;
}

export function AdminResourcesPage({ api, toast }) {
  const [state, reload] = useAdminLoad(() => api.getAdminMeta(), []);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  async function add(event) {
    event.preventDefault(); if (pending || !name.trim()) return;
    setPending(true);
    try { await api.createAdminMeta('categories', { name: name.trim() }); setName(''); toast('分类已添加'); reload(); }
    catch (error) { toast(error.message, 'error'); }
    finally { setPending(false); }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  const items = state.data.categories.filter((item) => item.name.includes(query.trim()));
  return <><PageHeader eyebrow="系统设置" title="课程分类" /><section className="paper-card resource-manager">
    <div className="resource-manager-head"><h2>课程分类 · {state.data.categories.length}</h2><div className="search-box"><input aria-label="搜索课程分类" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索分类" /></div></div>
    <form className="resource-create inline-create" onSubmit={add}><input aria-label="新分类名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="输入分类名称" /><button disabled={pending || !name.trim()}>添加分类</button></form>
    {items.length ? <div className="resource-list resource-list-managed">{items.map((item) => <span key={item.id}><strong>{item.name}</strong></span>)}</div> : <Empty title="没有符合条件的分类" />}
  </section></>;
}

export function AdminEnrollmentsPage({ api, toast }) {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('ALL');
  const [state, reload] = useAdminLoad(() => api.getAdminEnrollments({ query, status }), [query, status]);
  const [exporting, setExporting] = useState(false);
  async function downloadRoster() {
    setExporting(true);
    try { await downloadEnrollmentRoster(api); toast('已导出“已报名”和“未报名”两个工作表'); }
    catch (error) { toast(error.message, 'error'); }
    finally { setExporting(false); }
  }
  const [reportState, reloadReport] = useAdminLoad(() => api.getAdminCourses(), []);
  const [manual, setManual] = useState({ student_no: '', course_id: '' });
  const [changing, setChanging] = useState(false);
  async function addEnrollment(event) {
    event.preventDefault(); setChanging(true);
    try {
      const students = await api.getAdminStudents(manual.student_no.trim());
      const student = students.items.find((row) => row.student_no === manual.student_no.trim());
      if (!student) throw new Error('没有找到这个学号，请先添加学生资料');
      await api.enrollForStudent(Number(manual.course_id), student.id, makeIdempotencyKey('staff'), '教务代报名');
      toast('报名已添加'); setManual({ student_no: '', course_id: '' }); await Promise.all([reload(), reloadReport()]);
    } catch (error) { toast(error.message, 'error'); }
    finally { setChanging(false); }
  }
  async function removeEnrollment(record) {
    if (!window.confirm(`为“${record.student_name}”退出“${record.course_name}”？退课后名额会释放。`)) return;
    setChanging(true);
    try { await api.withdrawForStudent(record.enrollment_id); toast('已办理退课'); await Promise.all([reload(), reloadReport()]); }
    catch (error) { toast(error.message, 'error'); }
    finally { setChanging(false); }
  }
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
  return <><PageHeader eyebrow="学生报名和退课记录" title="报名管理" description="按学生、学号或课程查询报名结果，也可以一键生成全校课程报课人数统计表。" action={<div className="roster-export-actions"><button className="primary-action" disabled={exporting} onClick={downloadRoster}>{exporting ? '正在导出…' : '导出全校报名名单'}</button><button className="secondary-button export-action" disabled={reportState.loading || Boolean(reportState.error)} onClick={downloadReport}><span aria-hidden="true">↓</span>{reportState.loading ? '正在准备数据' : '导出报课人数表'}</button></div>} /><details className="group-create-panel"><summary><strong>为学生添加报名</strong><span>展开</span></summary><form onSubmit={addEnrollment}><label><span>学生学号</span><input required value={manual.student_no} onChange={(event) => setManual({ ...manual, student_no: event.target.value })} placeholder="输入完整学号" /></label><label><span>课程</span><select required value={manual.course_id} onChange={(event) => setManual({ ...manual, course_id: event.target.value })}><option value="">选择课程</option>{reportCourses.filter((course) => course.status === 'OPEN').map((course) => <option key={course.id} value={course.id}>{course.name}（剩余 {course.remaining}）</option>)}</select></label><button className="primary-button" disabled={changing}>{changing ? '正在处理…' : '确认添加报名'}</button></form></details>{reportState.error ? <div className="inline-alert">统计数据暂时无法读取：{reportState.error}</div> : <section className="metric-grid compact-metrics report-metrics"><Metric value={summary.courseCount} label="统计课程" /><Metric value={summary.totalEnrolled} label="已报名人次" /><Metric value={summary.remaining} label="剩余名额" tone="accent" /></section>}<section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学号、姓名或课程" /></div><div className="chip-row inline">{['ALL', 'ENROLLED', 'WITHDRAWN', 'CANCELLED'].map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'ALL' ? '全部记录' : <StatusPill status={item} />}</button>)}</div></section>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : state.data.items.length ? <div className="responsive-table enrollment-table"><div className="table-row table-head"><span>课程</span><span>学生</span><span>状态</span><span>操作来源</span><span>时间</span></div>{state.data.items.map((item) => <div className="table-row" key={item.enrollment_id}><span><strong>{item.course_name}</strong></span><span>{item.student_name}<small>{item.student_no}</small></span><span><StatusPill status={item.status} /></span><span>{item.source === 'STUDENT' ? '学生报名' : item.source === 'ALLOCATION' ? '历史志愿分配' : '教务人员操作'}</span><span>{formatDate(item.enrolled_at)}{item.status === 'ENROLLED' ? <button className="enrollment-withdraw" disabled={changing} onClick={() => removeEnrollment(item)}>办理退课</button> : null}</span></div>)}</div> : <Empty title="暂无报名记录" description="学生报名后，详细记录会显示在这里；课程人数统计表仍可直接导出。" />}</>;
}

export function AdminSettingsPage({ api, toast }) {
  const [state, reload] = useAdminLoad(async () => { const [configs, audit] = await Promise.all([api.getAdminConfigs(), api.getAdminAudit()]); return { configs: configs.items, audit: audit.items }; }, []);
  const [draft, setDraft] = useState([]);
  useEffect(() => { if (state.data?.configs) setDraft(state.data.configs); }, [state.data]);
  async function save() { try { await api.updateAdminConfigs(draft.map(({ key, value }) => ({ key, value }))); toast('选课规则已保存'); reload(); } catch (error) { toast(error.message, 'error'); } }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  const ruleGroups = ['学生选课', '退课处理', '账号安全'];
  return <><PageHeader eyebrow="系统规则" title="选课规则与操作记录" /><div className="rule-summary"><strong>自主报名</strong><span>报名成功即占用名额，满额即止。学生可以不报名；</span></div><div className="settings-grid"><section className="paper-card rules-card"><div className="card-title"><div><p className="eyebrow ink">报名与账号设置</p><h2>系统规则</h2></div><button className="primary-compact" onClick={save}>保存修改</button></div>{ruleGroups.map((group) => <section className="rule-group" key={group}><div className="config-list">{draft.map((item, index) => ({ item, index, text: CONFIG_TEXT[item.key] })).filter((entry) => entry.text?.group === group).map(({ item, index, text }) => <label key={item.key}><span><strong>{text.label}</strong><small>{text.help}</small></span><span className="rule-control">{item.type === 'bool' ? <select value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))}><option value="true">允许</option><option value="false">不允许</option></select> : <input type={text.input || 'number'} min={text.input ? undefined : '0'} value={item.value} onChange={(event) => setDraft((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, value: event.target.value } : current))} />}{text.unit ? <small>{text.unit}</small> : null}</span></label>)}</div></section>)}</section><section className="paper-card"><div className="card-title"><div><p className="eyebrow ink">谁在什么时候做了什么</p><h2>最近操作</h2></div><span>最近 100 条</span></div><div className="audit-list readable-audit">{state.data.audit.length ? state.data.audit.map((item) => <div key={item.id}><span><strong><b>{item.actor_name || '系统'}</b> · {AUDIT_TEXT[item.action] || '进行了系统操作'}</strong><small>{item.target_name ? `${AUDIT_TARGET_TEXT[item.target_type] || '对象'}：${item.target_name}` : AUDIT_TARGET_TEXT[item.target_type] || '系统记录'}</small></span><time>{formatDate(item.created_at)}</time></div>) : <Empty title="暂无操作记录" />}</div></section></div></>;
}
