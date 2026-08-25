import { useEffect, useMemo, useState } from 'react';
import { buildSchedule, decorateCourse, makeIdempotencyKey, WEEK_DAYS } from '@kexu/client-core';
import { CourseCard, Empty, ErrorState, Loading, Metric, PageHeader, StatusPill } from '../components/Common.jsx';
import { formatDate, navigate } from '../runtime/browser.js';

function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try { setState({ loading: false, data: await loader(), error: '' }); }
    catch (error) { setState({ loading: false, data: null, error: error.message }); }
  };
  useEffect(() => { load(); }, dependencies);
  return [state, load];
}

export function CoursesPage({ api, toast }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state] = useLoad(async () => {
    const [courses, mine] = await Promise.all([api.getCourses({ query, category }), api.getEnrollments()]);
    return { ...courses, mine };
  }, [query, category, refreshKey]);

  async function enroll(id) {
    try { await api.enroll(id, makeIdempotencyKey()); toast('报名成功'); setRefreshKey((key) => key + 1); }
    catch (error) { toast(error.message, 'error'); }
  }
  const items = (state.data?.items || []).filter((course) => !onlyAvailable || course.remaining > 0);
  return <>
    <PageHeader eyebrow="铁英中学 · 校本选修" title="课程大厅" description="报名成功后才会占用名额，余位会实时更新。" />
    <section className="metric-grid compact-metrics"><Metric value={state.data?.mine?.items?.length ?? '—'} suffix={` / ${state.data?.mine?.max_active || 2}`} label="我的课程" /><Metric value={state.data?.items?.length ?? '—'} label="开放课程" /><Metric value="实时" label="余位状态" tone="accent" /></section>
    <section className="toolbar-line"><div className="search-box"><span>搜</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程或老师" /></div><button className={`filter-toggle ${onlyAvailable ? 'active' : ''}`} onClick={() => setOnlyAvailable((value) => !value)}>仅看有余位</button></section>
    <div className="chip-row"><button className={!category ? 'active' : ''} onClick={() => setCategory('')}>全部</button>{(state.data?.categories || []).map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
    {state.loading ? <Loading label="正在整理课程" /> : state.error ? <ErrorState message={state.error} onRetry={() => setRefreshKey((key) => key + 1)} /> : items.length ? <section className="course-grid">{items.map((course) => <CourseCard key={course.id} course={course} onOpen={(id) => navigate(`/courses/${id}`)} onEnroll={enroll} />)}</section> : <Empty title="没有找到课程" description="换个关键词、分类或筛选条件试试。" />}
  </>;
}

export function CourseDetailPage({ api, courseId, toast }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state] = useLoad(async () => {
    const result = await api.getCourse(courseId);
    let eligibility = null;
    if (!result.course.enrolled && result.course.status === 'OPEN' && result.course.remaining > 0) {
      try { eligibility = await api.getEligibility(courseId); } catch { eligibility = null; }
    }
    return { course: decorateCourse(result.course), eligibility };
  }, [courseId, refreshKey]);
  if (state.loading) return <Loading label="正在读取课程详情" />;
  if (state.error) return <ErrorState message={state.error} onRetry={() => setRefreshKey((key) => key + 1)} />;
  const { course, eligibility } = state.data;
  const canEnroll = !course.enrolled && course.status === 'OPEN' && course.remaining > 0 && eligibility?.eligible !== false;
  async function enroll() { try { await api.enroll(course.id, makeIdempotencyKey()); toast('报名成功'); setRefreshKey((key) => key + 1); } catch (error) { toast(error.message, 'error'); } }
  async function withdraw() { if (!window.confirm('退课后名额会立即释放，确定要退出该课程吗？')) return; try { await api.withdraw(course.id); toast('已退课'); setRefreshKey((key) => key + 1); } catch (error) { toast(error.message, 'error'); } }
  return <>
    <button className="back-button" onClick={() => navigate('/courses')}>← 返回课程大厅</button>
    <section className={`detail-hero tone-surface-${course.tone}`}><div className={`detail-mark tone-${course.tone}`}>{course.mark}</div><div><span>{course.category}</span><h1>{course.name}</h1><StatusPill status={course.status} /></div></section>
    <div className="detail-grid"><section className="paper-card detail-facts"><h2>课程信息</h2><dl><div><dt>负责老师</dt><dd>{course.teacherText}</dd></div><div><dt>上课时间</dt><dd>{course.timeText}</dd></div><div><dt>上课场地</dt><dd>{course.venueText}</dd></div><div><dt>课程容量</dt><dd>{course.capacity} 人</dd></div><div><dt>剩余名额</dt><dd className={course.remaining ? 'good' : 'bad'}>{course.remaining} 人</dd></div></dl></section><section className="paper-card detail-description"><h2>课程简介</h2><p>{course.description || '暂无课程简介'}</p>{eligibility?.eligible === false ? <div className="inline-alert">{eligibility.reason}</div> : null}</section></div>
    <div className="detail-actions">{course.enrolled ? <button className="danger-button" onClick={withdraw}>退课</button> : <button className="primary-button" disabled={!canEnroll} onClick={enroll}>{canEnroll ? `立即报名（余 ${course.remaining}）` : eligibility?.reason || (course.remaining <= 0 ? '已满员' : '暂不可报名')}</button>}</div>
  </>;
}

export function EnrollmentsPage({ api, toast }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state] = useLoad(() => api.getEnrollments(), [refreshKey]);
  async function withdraw(id) { if (!window.confirm('确定退课吗？')) return; try { await api.withdraw(id); toast('已退课'); setRefreshKey((key) => key + 1); } catch (error) { toast(error.message, 'error'); } }
  const items = state.data?.items || [];
  return <><PageHeader eyebrow="我的报名" title="我的课程" description="查看本学期已选课程，也可以从这里进入详情或退课。" /><section className="metric-grid compact-metrics"><Metric value={items.length} suffix={` / ${state.data?.max_active || 2}`} label="已选课程" /><Metric value={Math.max(0, (state.data?.max_active || 0) - items.length)} label="可再选" tone="accent" /></section>{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={() => setRefreshKey((key) => key + 1)} /> : items.length ? <div className="course-grid">{items.map((course) => <div className="enrollment-wrap" key={course.id}><CourseCard compact course={course} onOpen={(id) => navigate(`/courses/${id}`)} /><button className="danger-link" onClick={() => withdraw(course.id)}>退课</button></div>)}</div> : <Empty title="还没有报名课程" description="去课程大厅挑一门感兴趣的课程吧。" />}{state.data?.history?.length ? <section className="history-section"><h2>历史记录</h2>{state.data.history.map((item, index) => <div className="history-row" key={`${item.course_id}-${index}`}><strong>{item.name}</strong><StatusPill status={item.status} /><span>{formatDate(item.cancelled_at)}</span></div>)}</section> : null}</>;
}

export function SchedulePage({ api }) {
  const [view, setView] = useState('grid');
  const [state, reload] = useLoad(() => api.getSchedule(), []);
  const schedule = useMemo(() => buildSchedule(state.data?.items || []), [state.data]);
  return <><PageHeader eyebrow="本周安排" title="我的课表" description={`已选 ${state.data?.items?.length || 0} 门课程`} action={<div className="segmented"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>课表</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>列表</button></div>} />{state.loading ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : !state.data.items.length ? <Empty title="课表还是空的" description="报名课程后，上课安排会自动出现在这里。" /> : view === 'grid' ? <div className="schedule-scroll"><div className="schedule-grid" style={{ '--rows': schedule.periods.length }}><div className="schedule-head corner">节次</div>{WEEK_DAYS.map((day) => <div className="schedule-head" key={day}>{day}</div>)}{schedule.rows.map((row, rowIndex) => [<div className="period-cell" key={`p-${rowIndex}`}>第 {schedule.periods[rowIndex]} 节</div>, ...row.map((cell, colIndex) => <button className={`schedule-cell ${cell ? `tone-${cell.tone}` : ''}`} key={`${rowIndex}-${colIndex}`} disabled={!cell} onClick={() => cell && navigate(`/courses/${cell.course_id}`)}>{cell ? <><strong>{cell.name}</strong><span>{cell.venue}</span></> : null}</button>)])}</div></div> : <div className="schedule-list">{schedule.list.map((item, index) => <button key={`${item.course_id}-${index}`} onClick={() => navigate(`/courses/${item.course_id}`)}><span className={`list-day tone-${item.tone}`}>{item.weekdayText}<small>第 {item.period} 节</small></span><span><strong>{item.name}</strong><small>{item.teacherText} · {item.venue}</small></span></button>)}</div>}</>;
}

export function ProfilePage({ api, profile, setProfile, onLogout }) {
  const [state, reload] = useLoad(() => api.getProfile(), []);
  useEffect(() => { if (state.data) setProfile(state.data); }, [state.data]);
  const data = state.data || profile;
  return <><PageHeader eyebrow="个人中心" title="我的资料" description="核对学校账号中的基础信息。" />{state.loading && !data ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={reload} /> : data ? <div className="profile-layout"><section className="profile-hero"><span>{(data.name || '我').slice(0, 1)}</span><div><h2>{data.name}</h2><p>学号 {data.student_no}</p></div></section><section className="paper-card profile-facts"><dl><div><dt>年级</dt><dd>{data.grade}</dd></div><div><dt>班级</dt><dd>{data.class_name}</dd></div><div><dt>登录账号</dt><dd>{data.username}</dd></div></dl><button className="row-button" onClick={() => navigate('/change-password')}>修改密码 <span>›</span></button><button className="row-button danger" onClick={onLogout}>退出登录 <span>›</span></button></section></div> : null}</>;
}
