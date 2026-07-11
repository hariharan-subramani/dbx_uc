import Icon from './Icon';

function VolumeSelector({ volumes, selectedVolume, onSelectVolume, loading, disabled }) {
  return (
    <div className="selector-section">
      <label className="selector-label">
        <Icon name="database" size={16} />
        Volume
      </label>
      <div className="selector-dropdown">
        <select
          value={selectedVolume}
          onChange={(e) => onSelectVolume(e.target.value)}
          disabled={loading || disabled || volumes.length === 0}
          className="selector-select"
        >
          <option value="">Select volume</option>
          {volumes.map((volume) => (
            <option key={volume.name} value={volume.name}>
              {volume.name}
            </option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="selector-chevron" />
      </div>
    </div>
  );
}

export default VolumeSelector;
