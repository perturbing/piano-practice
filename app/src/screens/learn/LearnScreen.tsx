import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LESSONS, STAGES, type Lesson } from '../../content/lessons';
import { lessonStatus, type LessonStatus } from '../../engine/evidence';
import { useAttemptsStore } from '../../state/attemptsStore';
import { DevicePill, Pill } from '../../components/StatusPill';

const STATUS_LABEL: Record<LessonStatus, string> = {
  'not-started': 'Not started',
  practising: 'Practising',
  demonstrated: 'Demonstrated',
};

export function LearnScreen() {
  const navigate = useNavigate();
  const { attempts, refresh } = useAttemptsStore();
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statuses = new Map(LESSONS.map((l) => [l.id, lessonStatus(attempts, l.id)]));
  const prereqsMet = (l: Lesson) => l.prereqs.every((p) => statuses.get(p)?.status !== 'not-started');
  // Continue: a lesson in progress, else the first unstarted lesson whose prerequisites were tried.
  const next =
    LESSONS.find((l) => statuses.get(l.id)?.status === 'practising') ??
    LESSONS.find((l) => statuses.get(l.id)?.status === 'not-started' && prereqsMet(l)) ??
    LESSONS[0];

  return (
    <main className="screen stack">
      <div className="topbar">
        <h1>Learn</h1>
        <DevicePill />
      </div>
      <div className="card stack">
        <span className="eyebrow">Continue learning</span>
        <h2 style={{ margin: 0 }}>{next.title}</h2>
        <p className="muted">{next.summary}</p>
        <div className="row">
          <button className="primary big" onClick={() => navigate(`/learn/${next.id}`)}>
            {statuses.get(next.id)?.status === 'not-started' ? 'Start lesson' : 'Continue lesson'}
          </button>
          <button onClick={() => navigate('/daily')}>Open daily practice</button>
          <button onClick={() => navigate('/practise')}>Browse practice</button>
        </div>
      </div>

      {STAGES.slice(1).map((stage, i) => {
        const lessons = LESSONS.filter((l) => l.stage === i + 1);
        if (!lessons.length) return null;
        return (
          <section key={stage} className="stack">
            <h2>
              {i + 1} · {stage}
            </h2>
            <div className="list">
              {lessons.map((l) => {
                const st = statuses.get(l.id)!;
                return (
                  <Link key={l.id} to={`/learn/${l.id}`} className={`list-item ${l.id === next.id ? 'current' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="grow">
                      <strong>{l.title}</strong>
                      <div className="small muted">
                        {l.summary} · about {l.minutes} min
                        {l.prereqs.length && !prereqsMet(l) ? ' · suggested after earlier lessons' : ''}
                      </div>
                    </div>
                    <Pill kind={st.status === 'demonstrated' ? 'ok' : st.status === 'practising' ? 'accent' : undefined}>
                      {STATUS_LABEL[st.status]}
                    </Pill>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="tiny muted">
        The lesson sequence is a draft for review with a piano educator. “Demonstrated” means at least 90% first-try, unassisted answers in checks on
        two different days — evidence, not proof of lasting mastery.
      </p>
    </main>
  );
}
