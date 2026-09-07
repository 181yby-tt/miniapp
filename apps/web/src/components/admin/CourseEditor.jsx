import { useMemo, useState } from 'react';

const localInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const EMPTY_FORM = {
  name: '', category_id: '', capacity: 30, status: 'DRAFT', description: '',
  enroll_start_at: '', enroll_end_at: '',
  teacher_names: '', allowed_scope: { type: 'all' },
};

export default function CourseEditor({ api, course, meta, onClose, onSaved, toast }) {
  const [form, setForm] = useState(() => course ? {
    name: course.name,
    category_id: course.category_id || meta.categories[0]?.id || '',
    capacity: course.capacity,
    status: course.status,
    description: course.description || '',
    enroll_start_at: localInput(course.enroll_start_at), enroll_end_at: localInput(course.enroll_end_at),
    teacher_names: course.teacher_names ?? course.teachers?.join('、') ?? '',
    allowed_scope: course.allowed_scope || { type: 'all' },
  } : { ...EMPTY_FORM, category_id: meta.categories[0]?.id || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const scopeOptions = useMemo(() => form.allowed_scope.type === 'grades' ? meta.grades : form.allowed_scope.type === 'classes' ? meta.classes : form.allowed_scope.type === 'groups' ? (meta.teaching_groups || []) : [], [form.allowed_scope.type, meta]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setScopeType = (type) => setForm((current) => ({ ...current, allowed_scope: { type, [type]: [] } }));
  const toggleScope = (id) => setForm((current) => {
    const key = current.allowed_scope.type;
    const values = current.allowed_scope[key] || [];
    return { ...current, allowed_scope: { ...current.allowed_scope, [key]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id] } };
  });

  async function submit(event) {
    event.preventDefault(); setError('');
    if (!form.name.trim()) return setError('请填写课程名称');
    if (!Number.isInteger(Number(form.capacity)) || Number(form.capacity) < 1) return setError('课程容量必须是正整数');
    setSaving(true);
    try {
      const payload = { ...form, enroll_start_at: form.enroll_start_at ? new Date(form.enroll_start_at).toISOString() : null, enroll_end_at: form.enroll_end_at ? new Date(form.enroll_end_at).toISOString() : null, category_id: Number(form.category_id), capacity: Number(form.capacity) };
      if (course) await api.updateAdminCourse(course.id, payload);
      else await api.createAdminCourse(payload);
      toast(course ? '课程已更新' : '课程已创建');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
    finally { setSaving(false); }
  }

  return <div className="editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="course-editor" onSubmit={submit}>
      <header><div><p className="eyebrow ink">课程资料</p><h2>{course ? '编辑课程' : '新建课程'}</h2></div><button type="button" className="close-button" onClick={onClose}>关闭</button></header>
      <div className="form-grid">
        <label className="span-two"><span>课程名称</span><input value={form.name} onChange={update('name')} placeholder="例如：篮球基础" /></label>
        <label><span>课程分类</span><select value={form.category_id} onChange={update('category_id')}>{meta.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>课程容量</span><input type="number" min="1" value={form.capacity} onChange={update('capacity')} /></label>
        <label><span>当前状态</span><div className="readonly-status">{{ DRAFT: '待完善', OPEN: '开放报名', CLOSED: '暂停报名', FINISHED: '课程已结束', ARCHIVED: '历史项目' }[form.status] || form.status}<small>开放或暂停请在课程列表操作</small></div></label>
        <label><span>报名开始时间（选填）</span><input type="datetime-local" value={form.enroll_start_at} onChange={update('enroll_start_at')} /></label>
        <label><span>报名结束时间（选填）</span><input type="datetime-local" value={form.enroll_end_at} onChange={update('enroll_end_at')} /></label>
        <p className="helper-text span-two">不填时间时，由课程的开放、暂停按钮控制。填写后，到达截止时间将自动停止学生报名和退课。</p>
        <label className="span-two"><span>任课教师（选填）</span><input maxLength="500" value={form.teacher_names} onChange={update('teacher_names')} placeholder="直接填写姓名，多位教师用顿号分隔" /></label>
        <label className="span-two"><span>课程介绍</span><textarea rows="3" value={form.description} onChange={update('description')} placeholder="填写课程内容、适合对象和注意事项" /></label>
      </div>

      <section className="editor-section"><div className="section-heading"><div><strong>适用学生范围</strong><span>选择可报名的学生；教学组是预先配置的班级集合。</span></div></div><div className="segmented scope-tabs"><button type="button" className={form.allowed_scope.type === 'all' ? 'active' : ''} onClick={() => setScopeType('all')}>全体学生</button><button type="button" className={form.allowed_scope.type === 'grades' ? 'active' : ''} onClick={() => setScopeType('grades')}>指定年级</button><button type="button" className={form.allowed_scope.type === 'classes' ? 'active' : ''} onClick={() => setScopeType('classes')}>指定班级</button><button type="button" className={form.allowed_scope.type === 'groups' ? 'active' : ''} onClick={() => setScopeType('groups')}>指定教学组</button></div>{form.allowed_scope.type !== 'all' ? <div className="option-grid compact">{scopeOptions.map((item) => { const key = form.allowed_scope.type; return <label className="check-card" key={item.id}><input type="checkbox" checked={(form.allowed_scope[key] || []).includes(item.id)} onChange={() => toggleScope(item.id)} /><span>{item.name}</span></label>; })}</div> : null}</section>
      {error ? <div className="form-error course-save-error">{error}</div> : null}
      <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button editor-save" disabled={saving}>{saving ? '正在保存…' : '保存课程'}</button></footer>
    </form>
  </div>;
}
