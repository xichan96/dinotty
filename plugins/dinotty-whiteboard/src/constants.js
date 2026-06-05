export const DEFAULTS = {
  strokeColor: '#333333',
  strokeWidth: 2,
  fillColor: null,
  opacity: 1,
  fontSize: 16,
  fontFamily: 'sans-serif',
  cornerRadius: 0,
  smoothing: 0.5,
  eraserRadius: 10,
  markerWidth: 12,
  highlighterWidth: 20,
  highlighterOpacity: 0.3,
  markerOpacity: 0.4,
};

export const LIMITS = {
  zoom: { min: 0.1, max: 5.0 },
  history: 50,
  gridSize: 20,
};

export const COLORS = [
  '#e0e0e0', '#ffffff', '#ff0000', '#ff6b00', '#ffd700',
  '#00cc00', '#0099ff', '#9966ff', '#ff66cc', '#00cccc',
  '#ff4444', '#44ff44', '#4444ff', '#888888', '#444444',
];

export const FILL_COLORS = [
  null, '#ff000030', '#ff6b0030', '#ffd70030', '#00cc0030',
  '#0099ff30', '#9966ff30', '#ff66cc30', '#00cccc30',
  '#ffffff20', '#00000020',
];

export const STROKE_WIDTHS = [1, 2, 3, 5, 8];

export const FONT_SIZES = [12, 14, 16, 20, 24, 32, 48];
