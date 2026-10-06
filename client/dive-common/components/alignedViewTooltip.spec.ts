import alignedViewTooltipText from './alignedViewTooltip';

describe('alignedViewTooltipText', () => {
  it('returns the base label for single-camera datasets', () => {
    expect(alignedViewTooltipText({
      isMultiCamera: false,
      enabled: false,
      sourceIsMixed: false,
      progress: null,
    })).toBe('Align View');
  });

  it('describes the enabled aligned view', () => {
    expect(alignedViewTooltipText({
      isMultiCamera: true,
      enabled: true,
      sourceIsMixed: false,
      progress: { registered: 2, total: 2 },
    })).toBe('Align View on (draw/edit on any camera)');
  });

  it('shows registration progress when the rig is incomplete', () => {
    expect(alignedViewTooltipText({
      isMultiCamera: true,
      enabled: false,
      sourceIsMixed: false,
      progress: { registered: 1, total: 3 },
    })).toBe('Align View — 1/3 cameras ready');
  });

  it('appends a mixed-calibration warning', () => {
    expect(alignedViewTooltipText({
      isMultiCamera: true,
      enabled: false,
      sourceIsMixed: true,
      progress: { registered: 2, total: 2 },
    })).toBe('Align View — warning: mixed calibration file generations');
  });

  it('combines the enabled state with a mixed-calibration warning', () => {
    expect(alignedViewTooltipText({
      isMultiCamera: true,
      enabled: true,
      sourceIsMixed: true,
      progress: { registered: 2, total: 2 },
    })).toBe('Align View on (draw/edit on any camera) — warning: mixed calibration file generations');
  });
});
