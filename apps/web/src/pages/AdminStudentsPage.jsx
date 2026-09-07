import { useEffect, useRef, useState } from 'react';
import { Empty, ErrorState, Loading, PageHeader, StatusPill } from '../components/Common.jsx';
import StudentImportPanel from '../components/admin/StudentImportPanel.jsx';

function ResetPasswordDialog({ student, pending, onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="student-reset-dialog" aria-labelledby="reset-student-title" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}>
    <h2 id="reset-student-title">重置学生密码</h2>
    <dl><div><dt>学生</dt><dd>{student.name}</dd></div><div><dt>学号 / 登录账号</dt><dd>{student.student_no}</dd></div><div><dt>班级</dt><dd>{student.grade} {student.class_name}</dd></div></dl>
    <p>密码将恢复为学校设置的统一初始密码。学生下次登录后需要重新修改，已选课程不受影响。</p>
    <footer><button type="button" autoFocus disabled={pending} onClick={onCancel}>取消</button><button type="button" className="primary-button" disabled={pending} onClick={onConfirm}>{pending ? '正在重置…' : '确认重置密码'}</button></footer>
  </dialog>;
}

export default function AdminStudentsPage({ api, toast }) {
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState('ALL');
  const [schoolClass, setSchoolClass] = useState('ALL');
  const [passwordState, setPasswordState] = useState('ALL');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(false);
  async function load() {
    try { const result = await api.getAdminStudents(); setState({ loading: false, items: result.items, error: '' }); }
    catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })); }
  }
  useEffect(() => { load(); }, [api]);
  const source = state.items;
  const grades = [...new Set(source.map((s) => s.grade).filter(Boolean))].sort();
  const classes = [...new Set(source.filter((s) => grade === 'ALL' || s.grade === grade).map((s) => s.class_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const filtered = source.filter((s) => (grade === 'ALL' || s.grade === grade) && (schoolClass === 'ALL' || s.class_name === schoolClass) && (passwordState === 'ALL' || (passwordState === 'PENDING' ? s.must_change_password === true : s.must_change_password === false)) && `${s.name} ${s.student_no}`.includes(query.trim()));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  function clearFilters() { setQuery(''); setGrade('ALL'); setSchoolClass('ALL'); setPasswordState('ALL'); setPage(1); }
  const hasFilters = query || grade !== 'ALL' || schoolClass !== 'ALL' || passwordState !== 'ALL';
  async function resetPassword() {
    if (pending) return;
    setPending(true);
    try {
      await api.resetStudentPassword(selected.id);
      setState((current) => ({ ...current, items: current.items.map((s) => s.id === selected.id ? { ...s, must_change_password: true } : s) }));
      toast(`${selected.name}的密码已恢复为统一初始密码`);
      setSelected(null);
    } catch (error) { toast(error.message, 'error'); }
    finally { setPending(false); }
  }
  return <div className="student-directory">
    <PageHeader eyebrow="教务管理" title="学生管理" />
    <StudentImportPanel api={api} toast={toast} onImported={load} />
    <section className="student-list-panel" aria-label="学生名单">
      <header className="student-list-heading"><h2>学生名单 <span>{state.loading ? '—' : source.length}</span></h2><button type="button" onClick={load}>刷新名单</button></header>
      <div className="student-filters">
        <label className="student-search"><span>姓名或学号</span><input type="search" value={query} placeholder="输入姓名或学号" onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
        <label><span>年级</span><select value={grade} onChange={(e) => { setGrade(e.target.value); setSchoolClass('ALL'); setPage(1); }}><option value="ALL">全部年级</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label><span>班级</span><select value={schoolClass} onChange={(e) => { setSchoolClass(e.target.value); setPage(1); }}><option value="ALL">全部班级</option>{classes.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label><span>密码状态</span><select value={passwordState} onChange={(e) => { setPasswordState(e.target.value); setPage(1); }}><option value="ALL">全部状态</option><option value="PENDING">待修改初始密码</option><option value="CHANGED">已修改密码</option></select></label>
      </div>
      <div className="student-result-line"><span>{hasFilters ? `找到 ${filtered.length} 名学生` : '学号即登录账号'}</span>{hasFilters ? <button type="button" onClick={clearFilters}>清除筛选</button> : null}</div>
      {state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : rows.length ? <>
        <table className="student-roster"><thead><tr><th scope="col">学生 / 学号</th><th scope="col">年级班级</th><th scope="col">报名</th><th scope="col">账号状态</th><th scope="col">密码状态</th><th scope="col">操作</th></tr></thead><tbody>{rows.map((s) => <tr key={s.id}>
          <th scope="row"><strong>{s.name}</strong><small>{s.student_no}</small></th>
          <td data-label="年级班级">{s.grade || '未填写'} · {s.class_name || '未填写'}</td>
          <td data-label="报名">{s.enrolled_count ? `已报 ${s.enrolled_count} 门` : '未报名'}</td>
          <td data-label="账号状态"><StatusPill status={s.account_status} /></td>
          <td data-label="密码状态"><span className={`student-password-state ${s.must_change_password === true ? 'is-pending' : ''}`}>{s.must_change_password === null ? '未关联账号' : s.must_change_password ? '待修改初始密码' : '已修改密码'}</span></td>
          <td className="student-row-action">{s.must_change_password !== null ? <button type="button" aria-label={`重置${s.name}（${s.student_no}）的密码`} onClick={() => setSelected(s)}>重置密码</button> : <span>暂无可用账号</span>}</td>
        </tr>)}</tbody></table>
        <nav className="student-pagination" aria-label="学生名单分页"><span>第 {currentPage} / {pages} 页 · 共 {filtered.length} 人</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></nav>
      </> : <Empty title={hasFilters ? '没有符合条件的学生' : '还没有学生'} description={hasFilters ? '试试其他姓名、学号，或清除筛选。' : '通过上方入口添加一名学生，或导入 Excel 名单。'} />}
    </section>
    {selected ? <ResetPasswordDialog student={selected} pending={pending} onCancel={() => setSelected(null)} onConfirm={resetPassword} /> : null}
  </div>;
}
