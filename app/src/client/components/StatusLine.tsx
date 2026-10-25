/** Single aria-live line for transient notes (copy confirmations, queue notes). */
export default function StatusLine({ message }: { message: string | null }) {
  return (
    <p className="status-line" role="status" aria-live="polite">
      {message}
    </p>
  );
}
