const basePath = './assets/';

export const presets = [
  { id: 's', label: 'S（最新調整版）', filename: '06_S_基本-2.svg' },
  { id: 'p', label: 'P', filename: '06_P_基本-2.svg' },
  { id: 'e1', label: 'E1', filename: '06_E1_基本-2.svg' },
  { id: 'e2', label: 'E2', filename: '06_E2_基本-2.svg' },
  { id: 'd1', label: 'D1', filename: '06_D1_基本-2.svg' },
  { id: 'a', label: 'A', filename: '06_A_基本-2.svg' },
  { id: 'd2', label: 'D2', filename: '06_D2_基本-2.svg' },
].map((preset) => ({
  ...preset,
  url: `${basePath}${preset.filename}`,
}));
