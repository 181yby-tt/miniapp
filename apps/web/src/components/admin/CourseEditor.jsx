import { useMemo, useState } from 'react';

const EMPTY_FORM = {
  name: '', category_id: '', capacity: 30, status: 'DRAFT', description: '',
  teachers: [], schedules: [], allowed_scope: { type: 'all' },
};

export default function CourseEditor({ api, course, meta, onClose, onSaved, toast }) {
  const [form, setForm] = useState(() => course ? {
    name: course.name,
    category_id: course.category_id || meta.categories[0]?.id || '',
    capacity: course.capacity,
    status: course.status,
    description: course.description || '',
    teachers: course.teacher_ids || [],
    schedules: (course.schedules || []).map((item) => ({ time_slot_id: item.time_slot_id, venue_id: item.venue_id })),
    allowed_scope: course.allowed_scope || { type: 'all' },
  } : { ...EMPTY_FORM, category_id: meta.categories[0]?.id || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const scopeOptions = useMemo(() => form.allowed_scope.type === 'grades' ? meta.grades : form.allowed_scope.type === 'classes' ? meta.classes : [], [form.allowed_scope.type, meta]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggleTeacher = (id) => setForm((current) => ({ ...current, teachers: current.teachers.includes(id) ? current.teachers.filter((value) => value !== id) : [...current.teachers, id] }));
  const changeSchedule = (index, key, value) => setForm((current) => ({ ...current, schedules: current.schedules.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: key === 'venue_id' ? Number(value) : value } : item) }));
  const removeSchedule = (index) => setForm((current) => ({ ...current, schedules: current.schedules.filter((_, itemIndex) => itemIndex !== index) }));
  const setScopeType = (type) => setForm((current) => ({ ...current, allowed_scope: { type, [type === 'grades' ? 'grades' : 'classes']: [] } }));
  const toggleScope = (id) => setForm((current) => {
    const key = current.allowed_scope.type === 'grades' ? 'grades' : 'classes';
    const values = current.allowed_scope[key] || [];
    return { ...current, allowed_scope: { ...current.allowed_scope, [key]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id] } };
  });

  async function submit(event) {
    event.preventDefault(); setError(''); setConflicts(null);
    if (!form.name.trim()) return setError('请填写课程名称');
    if (!Number.isInteger(Number(form.capacity)) || Number(form.capacity) < 1) return setError('课程容量必须是正整数');
    if (form.schedules.some((item) => !item.time_slot_id || !item.venue_id)) return setError('排课中的时间段和场地都要选择');
    setSaving(true);
    try {
      const payload = { ...form, category_id: Number(form.category_id), capacity: Number(form.capacity) };
      if (course) await api.updateAdminCourse(course.id, payload);
      else await api.createAdminCourse(payload);
      toast(course ? '课程和排课已更新' : '课程已创建');
      onSaved();
    } catch (err) {
      setError(err.code === 'HARD_CONFLICT' ? '无法保存，请先处理下面的排课冲突。' : err.message);
      if (err.code === 'HARD_CONFLICT') setConflicts(err.details || {});
    }
    finally { setSaving(false); }
  }

  return <div className="editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="course-editor" onSubmit={submit}>
      <header><div><p className="eyebrow ink">课程资料与排课</p><h2>{course ? '编辑课程' : '新建课程'}</h2></div><button type="button" className="close-button" onClick={onClose}>关闭</button></header>
      <div className="form-grid">
        <label className="span-two"><span>课程名称</span><input value={form.name} onChange={update('name')} placeholder="例如：篮球基础" /></label>
        <label><span>课程分类</span><select value={form.category_id} onChange={update('category_id')}>{meta.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>课程容量</span><input type="number" min="1" value={form.capacity} onChange={update('capacity')} /></label>
        <label><span>当前状态</span><div className="readonly-status">{{ DRAFT: '尚未开放', OPEN: '开放报名', CLOSED: '已暂停报名', FINISHED: '课程已结束', ARCHIVED: '历史课程' }[form.status] || form.status}<small>报名开关请在课程列表操作</small></div></label>
        <label className="span-two"><span>课程介绍</span><textarea rows="3" value={form.description} onChange={update('description')} placeholder="填写课程内容、适合对象和注意事项" /></label>
      </div>

      <section className="editor-section"><div className="section-heading"><div><strong>任课教师</strong><span>可以选择多位教师</span></div></div><div className="option-grid">{meta.staff.map((item) => <label className="check-card" key={item.id}><input type="checkbox" checked={form.teachers.includes(item.id)} onChange={() => toggleTeacher(item.id)} /><span>{item.name}<small>{item.staff_no}</small></span></label>)}</div></section>

      <section className="editor-section"><div className="section-heading"><div><strong>上课时间与场地</strong><span>保存时会检查教师、场地和已报名学生的课表冲突；整馆与分区也不能同时占用</span></div><button type="button" onClick={() => setForm((current) => ({ ...current, schedules: [...current.schedules, { time_slot_id: '', venue_id: '' }] }))}>继续添加上课时间</button></div>{form.schedules.length ? <div className="schedule-editor-list">{form.schedules.map((item, index) => <div key={index}><b>第 {index + 1} 节安排</b><select aria-label={`第 ${index + 1} 节上课时间`} value={item.time_slot_id} onChange={(event) => changeSchedule(index, 'time_slot_id', event.target.value)}><option value="">选择上课时间</option>{meta.time_slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}</select><select aria-label={`第 ${index + 1} 节上课场地`} value={item.venue_id} onChange={(event) => changeSchedule(index, 'venue_id', event.target.value)}><option value="">选择上课场地</option>{meta.venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select><button type="button" aria-label={`删除第 ${index + 1} 节安排`} onClick={() => removeSchedule(index)}>删除这节安排</button></div>)}</div> : <p className="helper-text">还没有排课。课程会先保存为“尚未开放”，之后可以再安排教师、时间和场地。</p>}</section>

      <section className="editor-section"><div className="section-heading"><div><strong>可报名范围</strong><span>限制哪些学生能看到并报名这门课程</span></div></div><div className="segmented scope-tabs"><button type="button" className={form.allowed_scope.type === 'all' ? 'active' : ''} onClick={() => setScopeType('all')}>全体学生</button><button type="button" className={form.allowed_scope.type === 'grades' ? 'active' : ''} onClick={() => setScopeType('grades')}>指定年级</button><button type="button" className={form.allowed_scope.type === 'classes' ? 'active' : ''} onClick={() => setScopeType('classes')}>指定班级</button></div>{form.allowed_scope.type !== 'all' ? <div className="option-grid compact">{scopeOptions.map((item) => { const key = form.allowed_scope.type === 'grades' ? 'grades' : 'classes'; return <label className="check-card" key={item.id}><input type="checkbox" checked={(form.allowed_scope[key] || []).includes(item.id)} onChange={() => toggleScope(item.id)} /><span>{item.name}</span></label>; })}</div> : null}</section>
      {error ? <div className="form-error course-save-error"><strong>{error}</strong>{conflicts ? <ul>{[...(conflicts.teacher || []), ...(conflicts.venue || [])].map((item, index) => <li key={`${item.course_id}-${index}`}>{item.reason}</li>)}{(conflicts.student?.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div> : null}
      <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button editor-save" disabled={saving}>{saving ? '正在保存…' : '保存课程和排课'}</button></footer>
    </form>
  </div>;
}
