/** The coach's long-form read of today: why this session, what changed. */
export default function Coaching({ html, workoutDay }: { html: string; workoutDay: string | null }) {
  return (
    <section>
      <div className="head">
        <h2>Coaching</h2>
      </div>
      {/* The plan the reasoning is about, whichever variant gets picked. */}
      {workoutDay && (
        <p className="eyebrow">
          Workout day · <span className="plan">{workoutDay}</span>
        </p>
      )}
      {html.trim() ? (
        <div className="coach" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="empty">No coaching notes in today&apos;s brief.</p>
      )}
    </section>
  );
}
