import { useEffect, useState } from 'react';
import { Empty, ErrorState, Loading, PageHeader, StatusPill } from '../components/Common.jsx';

function usePreferenceData(api) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try { setState({ loading: false, data: await api.getCurrentPreferences(), error: '' }); }
    catch (error) { setState({ loading: false, data: null, error: error.message }); }
  };
  useEffect(() => { load(); }, []);
  return [state, load];
}

const groupStatus = {
  DRAFT: '尚未开放', OPEN: '正在填报', CLOSED: '已停止填报', ALLOCATED: '分配结果待发布', PUBLISHED: '结果已发布', ARCHIVED: '已结束',
};

export function PreferencePage({ api, toast }) {
  const [state, reload] = usePreferenceData(api);
  const [choices, setChoices] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (state.data) setChoices(state.data.submission?.choices || Array(Number(state.data.group?.preference_count || 0)).fill('')); }, [state.data]);
  if (state.loading && !state.data) return <Loading label="正在读取志愿填报信息" />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  if (!state.data?.group) return <><PageHeader eyebrow="体育选项课" title="志愿填报" /><Empty title="暂未安排教学组" description="学校完成班级分组后，你会在这里看到可以选择的体育项目。" /></>;
  const { group, projects } = state.data;
  const open = group.status === 'OPEN';
  const complete = choices.length === Number(group.preference_count) && choices.every(Boolean) && new Set(choices.map(Number)).size === choices.length;
  const updateChoice = (index, value) => setChoices((current) => current.map((item, itemIndex) => itemIndex === index ? Number(value) : item));
  async function submit(event) {
    event.preventDefault();
    if (!complete) return toast('请完整填写且不要重复选择项目', 'error');
    setSaving(true);
    try { await api.saveCurrentPreferences(choices.map(Number)); toast(state.data.submission ? '志愿已更新' : '志愿已提交'); await reload(); }
    catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeader eyebrow="体育选项课" title="志愿填报" />
    <section className="preference-hero"><div><span>{group.grade_name} · {group.classes.map((item) => item.name).join('、')}</span><h2>{group.name}</h2><p>按真实意愿依次填写。提交时间早晚不会影响录取，超额项目由系统统一随机分配。</p></div><b className={`group-state state-${group.status.toLowerCase()}`}>{groupStatus[group.status] || group.status}</b></section>
    <section className="preference-guide"><strong>填报规则</strong><ol><li>共填写 {group.preference_count} 个不重复志愿。</li><li>优先分配第一志愿；第一志愿超额时随机抽取。</li><li>{group.allow_adjustment ? '志愿均未录取时，学校可调剂到本组有剩余名额的项目。' : '志愿均未录取时暂不自动调剂，由学校另行协调。'}</li></ol></section>
    <form className="preference-form" onSubmit={submit}><div className="preference-ranks">{Array.from({ length: Number(group.preference_count) }, (_, index) => <label key={index}><span><b>{index + 1}</b><strong>第{['一', '二', '三'][index]}志愿</strong></span><select value={choices[index] || ''} disabled={!open} onChange={(event) => updateChoice(index, event.target.value)}><option value="">请选择体育项目</option>{projects.map((project) => <option key={project.id} value={project.id} disabled={choices.some((choice, choiceIndex) => choiceIndex !== index && Number(choice) === project.id)}>{project.name}（{project.capacity} 人）</option>)}</select></label>)}</div><button className="primary-button preference-submit" disabled={!open || !complete || saving}>{saving ? '正在保存…' : state.data.submission ? '更新志愿' : '确认提交志愿'}</button>{state.data.submission ? <small className="preference-saved">已提交，可在截止前修改；以最后一次保存为准。</small> : null}</form>
    <section className="project-showcase"><div className="section-heading"><div><strong>本组体育项目</strong><span>人数上限不是实时抢占名额</span></div></div><div className="preference-project-grid">{projects.map((project) => <article key={project.id}><div><StatusPill status={project.status} /><h3>{project.name}</h3><p>{project.description || '暂无项目介绍'}</p></div><dl><div><dt>任课老师</dt><dd>{project.teachers.join('、') || '待安排'}</dd></div><div><dt>上课安排</dt><dd>{project.schedules.map((item) => `${item.slot_name} · ${item.venue_name}`).join('；') || '待安排'}</dd></div><div><dt>计划人数</dt><dd>{project.capacity} 人</dd></div></dl></article>)}</div></section>
  </>;
}

export function PreferenceResultPage({ api }) {
  const [state, reload] = usePreferenceData(api);
  if (state.loading) return <Loading label="正在读取分配结果" />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  if (!state.data?.group) return <><PageHeader eyebrow="体育选项课" title="填报结果" /><Empty title="暂未安排教学组" /></>;
  const { group, projects, submission, result } = state.data;
  const projectName = (id) => projects.find((item) => item.id === Number(id))?.name || '未知项目';
  return <>
    <PageHeader eyebrow={group.name} title="填报结果" />
    {result ? <section className="allocation-result"><span>你的体育选项课</span><h2>{result.course.name}</h2><p>{result.allocation_type === 'ADJUSTED' ? '学校统一调剂' : `第 ${result.source_rank} 志愿录取`}</p><dl><div><dt>任课老师</dt><dd>{result.course.teachers.join('、') || '待安排'}</dd></div><div><dt>上课安排</dt><dd>{result.course.schedules.map((item) => `${item.slot_name} · ${item.venue_name}`).join('；') || '待安排'}</dd></div></dl></section> : <section className="allocation-pending"><span>{groupStatus[group.status]}</span><h2>{group.status === 'PUBLISHED' ? '暂未分配到项目' : '录取结果尚未发布'}</h2><p>{group.status === 'OPEN' ? '你仍可返回志愿填报页修改选择。' : '学校正在统一核对和分配，发布后会显示最终项目。'}</p></section>}
    <section className="paper-card submitted-preferences"><h2>我的志愿</h2>{submission ? <ol>{submission.choices.map((courseId, index) => <li key={courseId}><b>{index + 1}</b><span>第{['一', '二', '三'][index]}志愿</span><strong>{projectName(courseId)}</strong></li>)}</ol> : <Empty title="尚未提交志愿" />}</section>
  </>;
}
