/** The coach's long-form read of today: why this session, what changed. */
export default function Coaching({ html }: { html: string }) {
  return (
    <section>
      <div className="head">
        <h2>Coaching</h2>
      </div>
      {html.trim() ? (
        <div className="coach" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="empty">No coaching notes in today&apos;s brief.</p>
      )}
    </section>
  );
}
