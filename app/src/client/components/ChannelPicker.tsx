import type { BufferChannel } from "@shared/types";

/** Custom-styled channel multi-select (spec 06 §2) — all pre-checked by the caller. */
export default function ChannelPicker({
  channels,
  checked,
  onChange,
}: {
  channels: BufferChannel[];
  checked: Set<string>;
  onChange: (id: string, on: boolean) => void;
}) {
  return (
    <div role="group" aria-labelledby="sendto-label" className="channel-list">
      <p className="field-label" id="sendto-label">
        send to
      </p>
      {channels.map((ch) => (
        <label key={ch.id} className="channel">
          <input
            type="checkbox"
            className="channel__input"
            checked={checked.has(ch.id)}
            onChange={(e) => onChange(ch.id, e.target.checked)}
          />
          <span className="channel__box" aria-hidden="true" />
          <span className="channel__name">{ch.name}</span>
          <span className="chip">{ch.service}</span>
        </label>
      ))}
    </div>
  );
}
