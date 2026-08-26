import { useEffect, useState } from 'react';
import { Empty, ErrorState, Loading, PageHeader } from '../components/Common.jsx';
import { buildPreferenceAllocationSheet, PREFERENCE_ALLOCATION_COLUMNS, safeFileName } from '../utils/preferenceAllocationExport.js';

const statusText = { DRAFT: '配置中', OPEN: '正在填报', CLOSED: '等待分配', ALLOCATED: '模拟结果待确认', PUBLISHED: '结果已发布', ARCHIVED: '已结束' };

export default function AdminPreferenceGroupsPage({ api, toast }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [form, setForm] = useState({ name: '', grade_id: '', class_ids: [], course_ids: [], preference_count: 2, allow_adjustment: false });
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [allocation, setAllocation] = useState(null);
  const load = async () => { setState((current) => ({ ...current, loading: true, error: '' })); try { setState({ loading: false, data: await api.getTeachingGroups(), error: '' }); } catch (error) { setState({ loading: false, data: null, error: error.message }); } };
  useEffect(() => { load(); }, []);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const toggle = (key, value) => setForm((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const visibleClasses = (state.data?.classes || []).filter((item) => Number(item.grade_id) === Number(form.grade_id));
  async function create(event) {
    event.preventDefault(); setSaving(true);
    try { await api.createTeachingGroup({ ...form, grade_id: Number(form.grade_id), preference_count: Number(form.preference_count) }); toast('教学组已创建'); setForm({ name: '', grade_id: '', class_ids: [], course_ids: [], preference_count: 2, allow_adjustment: false }); await load(); }
    catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  async function action(group, type) {
    try {
      if (type === 'open' && !window.confirm(`确定开放“${group.name}”志愿填报吗？`)) return;
      if (type === 'close' && !window.confirm(`确定停止“${group.name}”志愿填报吗？停止后才能模拟分配。`)) return;
      await api.setTeachingGroupStatus(group.id, type); toast(type === 'open' ? '志愿填报已开放' : '志愿填报已停止'); await load();
    } catch (error) { toast(error.message, 'error'); }
  }
  async function inspect(groupId) { setSelectedId(groupId); setAllocation(null); try { setAllocation(await api.getTeachingGroupAllocation(groupId)); } catch (error) { toast(error.message, 'error'); } }
  async function exportAllocation() {
    if (!allocation) return;
    try {
      const { default: writeExcelFile } = await import('write-excel-file/browser');
      await writeExcelFile(buildPreferenceAllocationSheet(allocation), { columns: PREFERENCE_ALLOCATION_COLUMNS, sheet: '志愿分配', stickyRowsCount: 3, orientation: 'landscape' }).toFile(`${safeFileName(allocation.group.name)}_分配表.xlsx`);
      toast('体育项目分配表已生成');
    } catch (error) { toast(error.message || '分配表生成失败', 'error'); }
  }
  async function simulate(group) { if (!window.confirm('将按当前志愿和容量生成一版可复现的模拟结果，确定继续吗？')) return; try { await api.simulateTeachingGroupAllocation(group.id); toast('模拟分配已完成'); await load(); await inspect(group.id); } catch (error) { toast(error.message, 'error'); } }
  async function publish(group) {
    if (!window.confirm('发布后学生将看到最终项目，且不能再修改志愿。确定发布吗？')) return;
    try { await api.publishTeachingGroupAllocation(group.id); toast('分配结果已发布'); await load(); await inspect(group.id); }
    catch (error) {
      if (error.code === 'INCOMPLETE_ALLOCATION' && window.confirm(`${error.message}。仍要发布当前结果吗？`)) { try { await api.publishTeachingGroupAllocation(group.id, true); toast('分配结果已发布'); await load(); await inspect(group.id); } catch (nextError) { toast(nextError.message, 'error'); } }
      else toast(error.message, 'error');
    }
  }
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;
  const groups = state.data?.items || [];
  return <>
    <PageHeader eyebrow="体育选项课" title="教学组与志愿分配" />
    <section className="preference-admin-steps"><span><b>1</b>建立教学组</span><span><b>2</b>开放学生填报</span><span><b>3</b>停止并模拟分配</span><span><b>4</b>核对后发布</span></section>
    <details className="group-create-panel"><summary><span><strong>新建教学组</strong><small>建议每组 3–4 个班、约 4 个体育项目</small></span><b>展开</b></summary><form onSubmit={create}>
      <label><span>教学组名称</span><input value={form.name} onChange={update('name')} placeholder="例如：初一 A 组" /></label>
      <label><span>所属年级</span><select value={form.grade_id} onChange={(event) => setForm((current) => ({ ...current, grade_id: event.target.value, class_ids: [] }))}><option value="">选择年级</option>{state.data.grades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <fieldset><legend>行政班（选择 3–4 个）</legend><div className="group-option-grid">{visibleClasses.map((item) => <label key={item.id}><input type="checkbox" checked={form.class_ids.includes(item.id)} onChange={() => toggle('class_ids', item.id)} disabled={!form.class_ids.includes(item.id) && form.class_ids.length >= 4} /><span>{item.name}</span></label>)}</div></fieldset>
      <fieldset><legend>体育项目（至少 2 个）</legend><div className="group-option-grid project-options">{state.data.projects.map((item) => <label key={item.id}><input type="checkbox" checked={form.course_ids.includes(item.id)} onChange={() => toggle('course_ids', item.id)} /><span>{item.name}<small>{item.capacity} 人</small></span></label>)}</div></fieldset>
      <label><span>学生填写志愿数</span><select value={form.preference_count} onChange={update('preference_count')}><option value="2">2 个志愿</option><option value="3">3 个志愿</option></select></label>
      <label className="group-adjustment"><input type="checkbox" checked={form.allow_adjustment} onChange={update('allow_adjustment')} /><span><strong>允许统一调剂</strong><small>所有志愿均未录取时，调配到组内尚有名额的项目</small></span></label>
      <button className="primary-button" disabled={saving || !form.name.trim() || !form.grade_id || form.class_ids.length < 3 || form.course_ids.length < 2}>{saving ? '正在创建…' : '创建教学组'}</button>
    </form></details>
    {groups.length ? <div className="teaching-group-list">{groups.map((group) => <article key={group.id} className="teaching-group-card"><header><div><span>{group.grade_name}</span><h2>{group.name}</h2></div><b className={`group-state state-${group.status.toLowerCase()}`}>{statusText[group.status]}</b></header><div className="group-stat-row"><span><strong>{group.student_count}</strong>名学生</span><span><strong>{group.submitted_count}</strong>已提交</span><span><strong>{group.projects.length}</strong>个项目</span><span><strong>{group.total_capacity}</strong>总名额</span></div><p>班级：{group.classes.map((item) => item.name).join('、')}</p><p>项目：{group.projects.map((item) => `${item.name}（${item.capacity}）`).join('、')}</p><footer>{['DRAFT', 'CLOSED', 'ALLOCATED'].includes(group.status) ? <button onClick={() => action(group, 'open')}>{group.status === 'DRAFT' ? '开放志愿填报' : '重新开放填报'}</button> : null}{group.status === 'OPEN' ? <button className="warning" onClick={() => action(group, 'close')}>停止填报</button> : null}{['CLOSED', 'ALLOCATED'].includes(group.status) ? <button className="primary" onClick={() => simulate(group)}>{group.status === 'ALLOCATED' ? '重新模拟分配' : '模拟分配'}</button> : null}{['ALLOCATED', 'PUBLISHED'].includes(group.status) ? <button onClick={() => inspect(group.id)}>查看分配明细</button> : null}{group.status === 'ALLOCATED' ? <button className="primary" onClick={() => publish(group)}>确认并发布</button> : null}</footer></article>)}</div> : <Empty title="还没有教学组" description="先建立一个“4 个班 + 4 个项目”的试点组。" />}
    {selectedId ? <div className="allocation-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedId(null)}><section className="allocation-drawer"><header><div><span>模拟与发布结果</span><h2>{allocation?.group?.name || '正在读取'}</h2></div><div className="allocation-drawer-actions">{allocation ? <button className="primary" onClick={exportAllocation}>导出 Excel</button> : null}<button onClick={() => setSelectedId(null)}>关闭</button></div></header>{!allocation ? <Loading /> : <><div className="allocation-summary"><span><strong>{allocation.group.student_count}</strong>组内学生</span><span><strong>{allocation.group.submitted_count}</strong>已提交</span><span><strong>{allocation.results.length}</strong>已分配</span><span><strong>{allocation.group.student_count - allocation.results.length}</strong>待处理</span></div>{allocation.results.length ? <div className="allocation-table"><div className="allocation-row head"><span>学生</span><span>班级</span><span>分配项目</span><span>依据</span></div>{allocation.results.map((item) => <div className="allocation-row" key={item.id}><span><strong>{item.student?.name}</strong><small>{item.student?.student_no}</small></span><span>{allocation.students.find((student) => student.id === item.student_id)?.class_name}</span><span>{item.course.name}</span><span>{item.allocation_type === 'ADJUSTED' ? '统一调剂' : `第 ${item.source_rank} 志愿`}</span></div>)}</div> : <Empty title="还没有模拟结果" />}</>}</section></div> : null}
  </>;
}
