import { useEffect, useState } from 'react';
import { Empty, ErrorState, Loading, PageHeader } from '../components/Common.jsx';

const emptyForm = () => ({ name: '', grade_id: '', class_ids: [] });

export default function AdminEnrollmentGroupsPage({ api, toast }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [form, setForm] = useState(emptyForm);
  const [pending, setPending] = useState(false);
  async function load() {
    try { setState({ loading: false, data: await api.getTeachingGroups(), error: '' }); }
    catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })); }
  }
  useEffect(() => { load(); }, []);
  const toggle = (key, id) => setForm((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id] }));
  async function create(event) {
    event.preventDefault(); setPending(true);
    try { await api.createTeachingGroup({ ...form, grade_id: Number(form.grade_id) }); setForm(emptyForm()); toast('教学组已创建'); await load(); }
    catch (error) { toast(error.message, 'error'); }
    finally { setPending(false); }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;
  const groups = state.data.items;
  return <>
    <PageHeader eyebrow="体育选课" title="教学组设置" description="保存常用班级，在课程报名范围中选择。" action={<button className="secondary-button" onClick={load}>刷新</button>} />
    <details className="group-create-panel"><summary><span><strong>新建教学组</strong><small>选择班级</small></span><b>展开</b></summary><form onSubmit={create}>
      <label><span>教学组名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：初一 A 组" /></label>
      <label><span>所属年级</span><select required value={form.grade_id} onChange={(event) => setForm({ ...form, grade_id: event.target.value, class_ids: [] })}><option value="">选择年级</option>{state.data.grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></label>
      <fieldset><legend>包含班级</legend><div className="group-option-grid">{state.data.classes.filter((item) => item.grade_id === Number(form.grade_id)).map((item) => <label key={item.id}><input type="checkbox" checked={form.class_ids.includes(item.id)} onChange={() => toggle('class_ids', item.id)} /><span>{item.name}</span></label>)}</div></fieldset>
      <button className="primary-button" disabled={pending || !form.class_ids.length}>创建教学组</button>
    </form></details>
    {groups.length ? <div className="teaching-group-list">{groups.map((group) => <article key={group.id} className="teaching-group-card">
      <header><div><span>{group.grade_name}</span><h2>{group.name}</h2></div></header>
      <p>班级：{group.classes.map((item) => item.name).join('、')}</p>
    </article>)}</div> : <Empty title="还没有教学组" description="也可直接在课程中选择年级或班级。" />}
  </>;
}
