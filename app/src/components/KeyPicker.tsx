import { MAJOR_TONICS, MINOR_TONICS, keyName, parseKeyId } from '../music/keys';

/** Pick one key or several (all 12 roots in both tonalities are always available). */
export function KeyPicker({ value, onChange, multiple }: { value: string[]; onChange: (v: string[]) => void; multiple: boolean }) {
  const toggle = (id: string) => {
    if (!multiple) return onChange([id]);
    if (value.includes(id)) {
      if (value.length > 1) onChange(value.filter((v) => v !== id));
    } else onChange([...value, id]);
  };
  const row = (tonics: string[], tonality: 'major' | 'minor') => (
    <div className="chips" role="group" aria-label={`${tonality} keys`}>
      {tonics.map((t) => {
        const id = `${t}-${tonality}`;
        const on = value.includes(id);
        return (
          <button key={id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(id)}>
            {keyName(parseKeyId(id)!).replace(' major', '').replace(' minor', 'm')}
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="stack tight">
      <span className="tiny muted">Major</span>
      {row(MAJOR_TONICS, 'major')}
      <span className="tiny muted">Minor</span>
      {row(MINOR_TONICS, 'minor')}
    </div>
  );
}
