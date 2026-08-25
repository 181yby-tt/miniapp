import { decorateCourse } from '@kexu/client-core';

export function Loading({ label = '正在加载' }) {
  return <div className="state-card"><span className="spinner" aria-hidden="true" /><span>{label}</span></div>;
}

export function Empty({ title, description }) {
  return <div className="empty-state"><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="empty-state error-state"><strong>加载失败</strong><p>{message}</p>{onRetry ? <button className="text-button" onClick={onRetry}>重新加载</button> : null}</div>;
}

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow ink">{eyebrow}</p><h1>{title}</h1>{description ? <p className="page-description">{description}</p> : null}</div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function Metric({ value, suffix, label, tone = '' }) {
  return <div className={`metric ${tone}`}><div><strong>{value}</strong>{suffix ? <span>{suffix}</span> : null}</div><p>{label}</p></div>;
}

export function CourseArtwork({ course: rawCourse, large = false }) {
  const course = decorateCourse(rawCourse);
  return <div className={`course-artwork tone-surface-${course.tone} ${large ? 'large' : ''}`} aria-label={`${course.name}课程封面`}>
    <span>{course.category || '校本课程'}</span>
  </div>;
}

export function CourseCard({ course: rawCourse, onOpen, onEnroll, compact = false, pending = false }) {
  const course = decorateCourse(rawCourse);
  const disabled = course.remaining <= 0 || course.enrolled;
  return (
    <article className={`course-card ${compact ? 'compact' : ''}`} onClick={() => onOpen?.(course.id)}>
      <CourseArtwork course={course} />
      <div className="course-card-main">
        <div className="course-card-heading">
          <h3>{course.name}</h3>
          {onEnroll ? <button className={`small-action ${course.enrolled ? 'success' : ''}`} disabled={disabled || pending} onClick={(event) => { event.stopPropagation(); onEnroll(course.id); }}>{pending ? '报名中…' : course.enrolled ? '已报名' : course.remaining > 0 ? '报名' : '已满'}</button> : null}
        </div>
        <div className="course-meta"><span>{course.teacherText}</span><span>{course.timeText}</span><span>{course.venueText}</span></div>
        {!compact && course.description ? <p className="course-description">{course.description}</p> : null}
        <div className="seat-row"><div className="seat-track"><i style={{ width: `${course.fillPercent}%` }} /></div><span>余 <b className={course.remaining <= 3 ? 'low' : ''}>{course.remaining}</b> / {course.capacity}</span></div>
      </div>
    </article>
  );
}

export function StatusPill({ status }) {
  const labels = { OPEN: '开放报名', DRAFT: '尚未开放', CLOSED: '已暂停报名', FINISHED: '课程已结束', ARCHIVED: '历史课程', ENROLLED: '已报名', WITHDRAWN: '已退课', CANCELLED: '已取消', ACTIVE: '正常', DISABLED: '停用' };
  return <span className={`status-pill status-${status}`}>{labels[status] || status || '未知'}</span>;
}
