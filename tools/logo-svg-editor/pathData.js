const TOKEN_PATTERN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const PARAMETER_COUNTS = { M: 2, L: 2, C: 6, Z: 0 };

export function parsePathData(pathData) {
  const tokens = String(pathData || '').match(TOKEN_PATTERN) || [];
  const commands = [];
  let cursor = 0;
  let command = null;

  while (cursor < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[cursor])) {
      command = tokens[cursor++];
    }
    if (!command) {
      throw new Error('パスコマンドが見つかりません。');
    }
    const count = PARAMETER_COUNTS[command];
    if (count === undefined || tokens.slice(cursor, cursor + count).length !== count || tokens.slice(cursor, cursor + count).some((token) => /^[a-zA-Z]$/.test(token))) {
      throw new Error(`未対応または不完全な ${command} コマンドです。`);
    }
    if (command === 'Z') {
      commands.push({ type: 'Z' });
      command = null;
      continue;
    }
    const values = tokens.slice(cursor, cursor + count).map(Number);
    if (values.some(Number.isNaN)) {
      throw new Error('数値として解釈できない座標があります。');
    }
    cursor += count;
    if (command === 'M') {
      commands.push({ type: 'M', x: values[0], y: values[1] });
      command = 'L';
    } else if (command === 'L') {
      commands.push({ type: 'L', x: values[0], y: values[1] });
    } else {
      commands.push({ type: 'C', x1: values[0], y1: values[1], x2: values[2], y2: values[3], x: values[4], y: values[5] });
    }
  }
  return commands;
}

export function serializePathData(commands) {
  const number = (value) => Number(value.toFixed(3)).toString();
  return commands.map((command) => {
    if (command.type === 'Z') return 'Z';
    if (command.type === 'C') return `C ${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)}`;
    return `${command.type} ${number(command.x)} ${number(command.y)}`;
  }).join(' ');
}

export function splitSubpaths(commands) {
  const subpaths = [];
  let current = null;
  commands.forEach((command, index) => {
    if (command.type === 'M') {
      current = { start: index, end: index, commands: [command] };
      subpaths.push(current);
    } else if (current) {
      current.end = index;
      current.commands.push(command);
    }
  });
  return subpaths;
}

export function commandStart(commands, index) {
  for (let position = index - 1; position >= 0; position -= 1) {
    const command = commands[position];
    if (command.type === 'M' || command.type === 'L' || command.type === 'C') {
      return { x: command.x, y: command.y };
    }
  }
  return null;
}

export function getEditablePoints(command) {
  if (command.type === 'C') {
    return [
      { key: 'c1', label: '制御点 1', x: command.x1, y: command.y1 },
      { key: 'c2', label: '制御点 2', x: command.x2, y: command.y2 },
      { key: 'anchor', label: 'アンカー', x: command.x, y: command.y },
    ];
  }
  if (command.type === 'M' || command.type === 'L') {
    return [{ key: 'anchor', label: 'アンカー', x: command.x, y: command.y }];
  }
  return [];
}

export function movePoint(command, pointKey, x, y) {
  if (pointKey === 'c1') {
    command.x1 = x;
    command.y1 = y;
  } else if (pointKey === 'c2') {
    command.x2 = x;
    command.y2 = y;
  } else {
    command.x = x;
    command.y = y;
  }
}
